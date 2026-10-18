import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../app.ts';
import type { Via } from '../auth/access.ts';
import { verifyPin } from '../auth/pin.ts';
import { createSession, deleteSession, SESSION_COOKIE } from '../auth/session.ts';
import { getPerson, toDto } from '../persons.ts';
import { parse, pinSchema } from './validate.ts';

const loginSchema = z.object({ personId: z.number().int().positive(), pin: pinSchema });

/** Session-Cookie setzen; LAN-Sessions (Tablet) laufen kurz ab, öffentliche (Handy) lang. */
export function startSession(ctx: Ctx, reply: FastifyReply, personId: number, via: Via) {
	const ttlMs =
		via === 'lan'
			? ctx.config.SESSION_TTL_LAN_MIN * 60_000
			: ctx.config.SESSION_TTL_PUBLIC_DAYS * 86_400_000;
	const { token, expiresAt } = createSession(ctx.db, personId, via, ttlMs);
	reply.setCookie(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: via === 'public',
		expires: expiresAt
	});
	return expiresAt;
}

export async function sessionRoutes(app: FastifyInstance, ctx: Ctx) {
	const { db, lockout } = ctx;

	app.get('/session', async (req) => {
		const p = req.person ? getPerson(db, req.person.id) : null;
		return { via: req.via, person: p ? toDto(p, p.role === 'parent') : null };
	});

	app.post('/session', async (req, reply) => {
		const body = parse(loginSchema, req.body, reply);
		if (!body) return;
		const keys = [`person:${body.personId}`, `ip:${req.ip}`];
		const locked = lockout.lockedFor(keys);
		if (locked > 0) {
			return reply
				.code(429)
				.header('Retry-After', Math.ceil(locked / 1000))
				.send({ error: 'locked', retryAfterSec: Math.ceil(locked / 1000) });
		}
		const person = getPerson(db, body.personId);
		if (!person || !(await verifyPin(person.pin_hash, body.pin))) {
			lockout.fail(keys);
			return reply.code(401).send({ error: 'wrong pin' });
		}
		lockout.succeed(keys);
		const expiresAt = startSession(ctx, reply, person.id, req.via);
		return {
			person: toDto(person, person.role === 'parent'),
			expiresAt: expiresAt.toISOString()
		};
	});

	app.delete('/session', async (req, reply) => {
		const token = req.cookies[SESSION_COOKIE];
		if (token) deleteSession(db, token);
		reply.clearCookie(SESSION_COOKIE, { path: '/' });
		return reply.code(204).send();
	});
}
