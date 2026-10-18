import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../app.ts';
import { hashPin } from '../auth/pin.ts';
import { countPersons, insertPerson, toDto } from '../persons.ts';
import { startSession } from './session.ts';
import { colorSchema, emailSchema, nameSchema, parse, pinSchema } from './validate.ts';

const setupSchema = z.object({
	name: nameSchema,
	color: colorSchema,
	pin: pinSchema,
	email: emailSchema.optional()
});

/** Ersteinrichtung: erster Elternteil, nur solange die DB leer ist und nur aus dem LAN. */
export async function setupRoutes(app: FastifyInstance, ctx: Ctx) {
	const { db, bus } = ctx;

	app.get('/setup', async () => ({ needed: countPersons(db) === 0 }));

	app.post('/setup', async (req, reply) => {
		if (req.via !== 'lan') return reply.code(403).send({ error: 'setup only via LAN' });
		const body = parse(setupSchema, req.body, reply);
		if (!body) return;
		const pinHash = await hashPin(body.pin);
		// Prüfen und Einfügen ohne await dazwischen, damit zwei parallele Setups nicht beide durchkommen.
		if (countPersons(db) > 0) return reply.code(409).send({ error: 'already set up' });
		const person = insertPerson(db, {
			name: body.name,
			color: body.color,
			role: 'parent',
			pinHash,
			email: body.email ?? null
		});
		startSession(ctx, reply, person.id, req.via);
		bus.publish({ type: 'persons.changed', data: { id: person.id } });
		return reply.code(201).send({ person: toDto(person, true) });
	});
}
