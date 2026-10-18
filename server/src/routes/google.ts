import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePerson, type Ctx } from '../app.ts';
import {
	deleteAccount,
	discoverSources,
	getAccount,
	listAccounts,
	upsertAccount,
	type AccountRow
} from '../calendar/store.ts';
import { parse } from './validate.ts';

const STATE_TTL_MS = 10 * 60_000;
const idParam = z.object({ id: z.coerce.number().int().positive() });
const callbackQuery = z.object({
	code: z.string().optional(),
	state: z.string().optional(),
	error: z.string().optional()
});

const dto = (a: AccountRow) => ({
	id: a.id,
	email: a.email,
	personId: a.person_id,
	status: a.status
});

export async function googleRoutes(app: FastifyInstance, ctx: Ctx) {
	const { db, bus, google, sync } = ctx;
	// OAuth-State → Person; einmalig verwendbar, 10 min gültig
	const states = new Map<string, { personId: number; expires: number }>();

	app.get('/google/status', async (req) => ({
		configured: google !== null,
		// Google leitet nur auf die öffentliche HTTPS-Adresse zurück
		connectHere: req.via === 'public'
	}));

	app.get('/google/accounts', { preHandler: requirePerson }, async (req) => {
		const me = req.person!;
		return {
			accounts: listAccounts(db)
				.filter((a) => me.role === 'parent' || a.person_id === me.id)
				.map(dto)
		};
	});

	app.get('/google/connect', { preHandler: requirePerson }, async (req, reply) => {
		if (!google) return reply.code(503).send({ error: 'google not configured' });
		if (req.via !== 'public') return reply.code(409).send({ error: 'use public url' });
		const now = Date.now();
		for (const [k, v] of states) if (v.expires < now) states.delete(k);
		const state = randomBytes(16).toString('hex');
		states.set(state, { personId: req.person!.id, expires: now + STATE_TTL_MS });
		return reply.redirect(google.oauth.authUrl(state));
	});

	app.get('/google/callback', async (req, reply) => {
		const back = (result: string) => reply.redirect(`/einstellungen?google=${result}`);
		const q = callbackQuery.safeParse(req.query);
		const st = q.success && q.data.state ? states.get(q.data.state) : undefined;
		if (q.success && q.data.state) states.delete(q.data.state);
		if (!google || !q.success || !st || st.expires < Date.now()) return back('error');
		if (q.data.error || !q.data.code) return back('denied');
		try {
			const t = await google.oauth.exchange(q.data.code);
			const cals = await google.accounts.apiWithToken(t.accessToken).listCalendars();
			// Die ID des Hauptkalenders ist die E-Mail-Adresse des Kontos
			const email = cals.find((c) => c.primary)?.id;
			if (!email) throw new Error('kein Hauptkalender');
			const acc = upsertAccount(db, {
				personId: st.personId,
				email,
				refreshTokenEnc: google.crypto.encrypt(t.refreshToken)
			});
			google.accounts.remember(acc.id, t);
			discoverSources(db, acc.id, st.personId, cals);
			bus.publish({ type: 'calendars.changed' });
			void sync.syncAll();
			return back('ok');
		} catch (err) {
			req.log.error({ err: String(err) }, 'Google-Verbindung fehlgeschlagen');
			return back('error');
		}
	});

	app.delete('/google/accounts/:id', { preHandler: requirePerson }, async (req, reply) => {
		const params = parse(idParam, req.params, reply);
		if (!params) return;
		const acc = getAccount(db, params.id);
		if (!acc) return reply.code(404).send({ error: 'not found' });
		if (req.person!.role !== 'parent' && acc.person_id !== req.person!.id)
			return reply.code(403).send({ error: 'not allowed' });
		if (google) {
			await google.oauth
				.revoke(google.crypto.decrypt(acc.refresh_token_enc))
				.catch((err: unknown) =>
					req.log.warn({ err: String(err) }, 'Widerruf bei Google fehlgeschlagen')
				);
			google.accounts.forget(acc.id);
		}
		deleteAccount(db, acc.id);
		bus.publish({ type: 'calendars.changed' });
		bus.publish({ type: 'events.changed', data: { sourceIds: [] } });
		return reply.code(204).send();
	});
}
