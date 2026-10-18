import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireParent, requireReader, type Ctx } from '../app.ts';
import {
	discoverSources,
	getAccount,
	getSource,
	listAccounts,
	listSources,
	updateSource,
	type SourceRow
} from '../calendar/store.ts';
import { getPerson } from '../persons.ts';
import { parse } from './validate.ts';

const idParam = z.object({ id: z.coerce.number().int().positive() });
const patchSchema = z.object({
	personId: z.number().int().positive().nullable().optional(),
	enabled: z.boolean().optional()
});

export async function calendarRoutes(app: FastifyInstance, ctx: Ctx) {
	const { db, bus, sync, google } = ctx;

	const dto = (s: SourceRow) => ({
		id: s.id,
		summary: s.summary,
		color: s.color,
		personId: s.person_id,
		enabled: s.enabled,
		writable: s.writable,
		account: getAccount(db, s.account_id)?.email ?? null,
		lastSyncedAt: s.last_synced_at,
		lastError: s.last_error
	});
	const changed = () => {
		bus.publish({ type: 'calendars.changed' });
		bus.publish({ type: 'events.changed', data: { sourceIds: [] } });
	};

	app.get('/calendars', { preHandler: requireReader }, async () => ({
		calendars: listSources(db).map(dto)
	}));

	app.patch('/calendars/:id', { preHandler: requireParent }, async (req, reply) => {
		const params = parse(idParam, req.params, reply);
		const body = params && parse(patchSchema, req.body, reply);
		if (!params || !body) return;
		if (!getSource(db, params.id)) return reply.code(404).send({ error: 'not found' });
		if (body.personId && !getPerson(db, body.personId))
			return reply.code(400).send({ error: 'unknown person' });
		updateSource(db, params.id, body);
		changed();
		if (body.enabled) void sync.syncAll();
		return { calendar: dto(getSource(db, params.id)!) };
	});

	// Manueller Abgleich (SPEC §5.1); auch am Tablet ohne Login
	app.post('/calendars/sync', { preHandler: requireReader }, async () => ({
		changed: await sync.syncAll()
	}));

	// Kalenderlisten neu einlesen, z. B. nachdem ein Kalender neu geteilt wurde
	app.post('/calendars/discover', { preHandler: requireParent }, async (req, reply) => {
		if (!google) return reply.code(503).send({ error: 'google not configured' });
		for (const acc of listAccounts(db)) {
			if (acc.status !== 'ok') continue;
			try {
				const cals = await google.accounts.apiFor(acc.id).listCalendars();
				discoverSources(db, acc.id, acc.person_id, cals);
			} catch (err) {
				req.log.warn({ account: acc.id, err: String(err) }, 'Kalenderliste nicht abrufbar');
			}
		}
		changed();
		return { calendars: listSources(db).map(dto) };
	});
}
