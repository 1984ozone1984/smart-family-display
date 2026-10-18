import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requirePerson, requireReader, type Ctx } from '../app.ts';
import { CalendarError } from '../calendar/service.ts';
import { eventsInRange, listSources } from '../calendar/store.ts';
import { parse } from './validate.ts';

const MAX_RANGE_MS = 400 * 86_400_000;

const rangeQuery = z
	.object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) })
	.refine((q) => Date.parse(q.to) > Date.parse(q.from), 'to muss nach from liegen')
	.refine((q) => Date.parse(q.to) - Date.parse(q.from) <= MAX_RANGE_MS, 'Zeitraum zu groß');

const text = {
	title: z.string().trim().min(1).max(200),
	location: z.string().trim().max(200).nullable().optional(),
	description: z.string().max(4000).nullable().optional()
};
const times = z.union([
	z
		.object({
			allDay: z.literal(false),
			start: z.iso.datetime({ offset: true }),
			end: z.iso.datetime({ offset: true })
		})
		.refine((t) => Date.parse(t.end) > Date.parse(t.start), {
			message: 'Ende muss nach Beginn liegen',
			path: ['end']
		}),
	z
		.object({ allDay: z.literal(true), startDate: z.iso.date(), endDate: z.iso.date() })
		.refine((t) => t.endDate >= t.startDate, {
			message: 'Ende muss nach Beginn liegen',
			path: ['endDate']
		})
]);
const createSchema = z.object({ sourceId: z.number().int().positive(), ...text }).and(times);
const patchText = z.object({
	title: text.title.optional(),
	location: text.location,
	description: text.description
});
const idParam = z.object({ id: z.coerce.number().int().positive() });

function fail(reply: FastifyReply, err: unknown) {
	if (err instanceof CalendarError) return reply.code(err.status).send({ error: err.code });
	throw err;
}

export async function eventRoutes(app: FastifyInstance, ctx: Ctx) {
	const { db, calendars } = ctx;

	app.get('/events', { preHandler: requireReader }, async (req, reply) => {
		const q = parse(rangeQuery, req.query, reply);
		if (!q) return;
		const sources = new Map(listSources(db).map((s) => [s.id, s]));
		return {
			events: eventsInRange(db, new Date(q.from).toISOString(), new Date(q.to).toISOString()).map(
				(e) => {
					const s = sources.get(e.source_id)!;
					return {
						id: e.id,
						sourceId: e.source_id,
						personId: s.person_id,
						title: e.title,
						start: e.start,
						end: e.end,
						allDay: e.all_day,
						location: e.location,
						description: e.description,
						recurring: e.recurring_id !== null,
						createdBy: e.created_by,
						writable: s.writable
					};
				}
			)
		};
	});

	// Anlegen geht am Tablet (LAN) auch ohne PIN; Ändern und Löschen nicht
	app.post('/events', { preHandler: requireReader }, async (req, reply) => {
		const body = parse(createSchema, req.body, reply);
		if (!body) return;
		try {
			const { sourceId, ...input } = body;
			const ev = await calendars.create(req.person, sourceId, input);
			return reply.code(201).send({ id: ev.id });
		} catch (err) {
			return fail(reply, err);
		}
	});

	app.patch('/events/:id', { preHandler: requirePerson }, async (req, reply) => {
		const params = parse(idParam, req.params, reply);
		const t = params && parse(patchText, req.body, reply);
		if (!params || !t) return;
		// Zeiten nur vollständig ändern (allDay + Beginn + Ende)
		const hasTimes = typeof req.body === 'object' && req.body !== null && 'allDay' in req.body;
		const tm = hasTimes ? parse(times, req.body, reply) : undefined;
		if (tm === null) return;
		try {
			await calendars.update(req.person!, params.id, { ...t, ...tm });
			return reply.code(204).send();
		} catch (err) {
			return fail(reply, err);
		}
	});

	app.delete('/events/:id', { preHandler: requirePerson }, async (req, reply) => {
		const params = parse(idParam, req.params, reply);
		if (!params) return;
		try {
			await calendars.remove(req.person!, params.id);
			return reply.code(204).send();
		} catch (err) {
			return fail(reply, err);
		}
	});
}
