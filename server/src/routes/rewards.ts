import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireParent, requireReader, type Ctx } from '../app.ts';
import { mayActFor } from '../auth/actor.ts';
import { AppError } from '../errors.ts';
import { balance, balances, book, history } from '../points/ledger.ts';
import {
	cancelRedemption,
	decideRedemption,
	getRedemption,
	getReward,
	insertReward,
	listRedemptions,
	listRewards,
	requestReward,
	updateReward,
	type RewardRow
} from '../points/rewards.ts';
import { getPerson } from '../persons.ts';
import { todayIn } from '../time.ts';
import { handle, iconSchema, parse } from './validate.ts';

const idParam = z.object({ id: z.coerce.number().int().positive() });
const personParam = z.object({ person: z.coerce.number().int().positive() });
const rewardFields = {
	title: z.string().trim().min(1).max(100),
	icon: iconSchema,
	cost: z.number().int().min(1).max(100_000),
	weeklyLimit: z.number().int().min(1).max(100).nullable(),
	active: z.boolean()
};
const rewardBody = z.object({
	...rewardFields,
	icon: rewardFields.icon.default(null),
	weeklyLimit: rewardFields.weeklyLimit.default(null),
	active: rewardFields.active.default(true)
});
// Ohne Standardwerte: PATCH übernimmt nur, was gesendet wurde
const rewardPatch = z.object(rewardFields).partial();
const redeemBody = z.object({ personId: z.number().int().positive() });
const decideBody = z.object({ approve: z.boolean() });
const statusQuery = z.object({
	status: z.enum(['requested', 'approved', 'rejected', 'cancelled']).optional()
});
const pointsBody = z.object({
	personId: z.number().int().positive(),
	delta: z
		.number()
		.int()
		.min(-10_000)
		.max(10_000)
		.refine((d) => d !== 0, 'darf nicht 0 sein'),
	reason: z.string().trim().min(1).max(200)
});

export async function rewardRoutes(app: FastifyInstance, { db, bus, config }: Ctx) {
	const changed = (points = false) => {
		bus.publish({ type: 'rewards.changed' });
		if (points) bus.publish({ type: 'points.changed' });
	};
	const rewardDto = (r: RewardRow) => ({
		id: r.id,
		title: r.title,
		icon: r.icon,
		cost: r.cost,
		weeklyLimit: r.weekly_limit,
		active: r.active
	});

	// --- Punkte ---

	app.get('/points', { preHandler: requireReader }, async () => ({
		balances: [...balances(db)].map(([personId, b]) => ({ personId, balance: b }))
	}));

	app.get('/points/:person', { preHandler: requireReader }, async (req, reply) => {
		const p = parse(personParam, req.params, reply);
		if (!p) return;
		if (!getPerson(db, p.person)) return reply.code(404).send({ error: 'not found' });
		return { balance: balance(db, p.person), history: history(db, p.person) };
	});

	// Bonus/Abzug: nur Eltern, immer mit Grund
	app.post('/points', { preHandler: requireParent }, async (req, reply) => {
		const b = parse(pointsBody, req.body, reply);
		if (!b) return;
		if (!getPerson(db, b.personId)) return reply.code(400).send({ error: 'unknown person' });
		book(db, {
			personId: b.personId,
			delta: b.delta,
			reason: b.reason,
			refType: 'bonus',
			createdBy: req.person!.id
		});
		bus.publish({ type: 'points.changed' });
		return reply.code(201).send({ balance: balance(db, b.personId) });
	});

	// --- Belohnungen ---

	app.get('/rewards', { preHandler: requireReader }, async () => ({
		rewards: listRewards(db).map(rewardDto)
	}));

	app.post('/rewards', { preHandler: requireParent }, async (req, reply) => {
		const b = parse(rewardBody, req.body, reply);
		if (!b) return;
		const r = insertReward(db, b);
		changed();
		return reply.code(201).send({ reward: rewardDto(r) });
	});

	app.patch('/rewards/:id', { preHandler: requireParent }, async (req, reply) => {
		const p = parse(idParam, req.params, reply);
		const b = p && parse(rewardPatch, req.body, reply);
		if (!p || !b) return;
		if (!getReward(db, p.id)) return reply.code(404).send({ error: 'not found' });
		updateReward(db, p.id, b);
		changed();
		return { reward: rewardDto(getReward(db, p.id)!) };
	});

	app.post('/rewards/:id/redeem', { preHandler: requireReader }, async (req, reply) => {
		const p = parse(idParam, req.params, reply);
		const b = p && parse(redeemBody, req.body, reply);
		if (!p || !b) return;
		if (!mayActFor(req, b.personId)) return reply.code(403).send({ error: 'not allowed' });
		return handle(reply, () => {
			if (!getPerson(db, b.personId)) throw new AppError(400, 'unknown person');
			const d = requestReward(db, {
				rewardId: p.id,
				personId: b.personId,
				today: todayIn(config.TZ),
				tz: config.TZ
			});
			changed();
			return reply.code(201).send({ id: d.id });
		});
	});

	app.get('/redemptions', { preHandler: requireReader }, async (req, reply) => {
		const q = parse(statusQuery, req.query, reply);
		if (!q) return;
		const rewards = new Map(listRewards(db).map((r) => [r.id, r]));
		return {
			redemptions: listRedemptions(db, q.status).map((d) => ({
				id: d.id,
				rewardId: d.reward_id,
				title: rewards.get(d.reward_id)?.title ?? '',
				icon: rewards.get(d.reward_id)?.icon ?? null,
				cost: rewards.get(d.reward_id)?.cost ?? 0,
				personId: d.person_id,
				status: d.status,
				requestedAt: d.requested_at,
				decidedAt: d.decided_at
			}))
		};
	});

	app.post('/redemptions/:id/decide', { preHandler: requireParent }, async (req, reply) => {
		const p = parse(idParam, req.params, reply);
		const b = p && parse(decideBody, req.body, reply);
		if (!p || !b) return;
		return handle(reply, () => {
			decideRedemption(db, { id: p.id, approve: b.approve, by: req.person!.id });
			changed(true);
		});
	});

	app.post('/redemptions/:id/cancel', { preHandler: requireReader }, async (req, reply) => {
		const p = parse(idParam, req.params, reply);
		if (!p) return;
		const d = getRedemption(db, p.id);
		if (!d) return reply.code(404).send({ error: 'not found' });
		if (!mayActFor(req, d.person_id)) return reply.code(403).send({ error: 'not allowed' });
		return handle(reply, () => {
			cancelRedemption(db, p.id);
			changed();
		});
	});
}
