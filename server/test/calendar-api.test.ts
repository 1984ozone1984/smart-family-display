import { describe, expect, it } from 'vitest';
import { listAccounts, listSources } from '../src/calendar/store.ts';
import { fakeGoogle } from './fake-google.ts';
import { cookieOf, LAN_IP, makeApp, PUBLIC_HOST, TUNNEL_IP } from './helpers.ts';

const lan = { remoteAddress: LAN_IP };

async function world() {
	const google = fakeGoogle();
	google.calendars.push(
		{ id: 'mama@example.com', summary: 'Mama', primary: true, accessRole: 'owner' },
		{ id: 'familie@group', summary: 'Familie', accessRole: 'writer' },
		{ id: 'kind@group', summary: 'Kind', accessRole: 'writer' }
	);
	const { app, db, sign } = await makeApp({ google });

	const setup = await app.inject({
		method: 'POST',
		url: '/api/v1/setup',
		...lan,
		payload: { name: 'Mama', color: '#e11d48', pin: '1111' }
	});
	const parent = { id: setup.json().person.id as number, cookie: cookieOf(setup) };
	const childRes = await app.inject({
		method: 'POST',
		url: '/api/v1/persons',
		...lan,
		headers: { cookie: parent.cookie },
		payload: { name: 'Kind', color: '#2563eb', role: 'child', pin: '2222' }
	});
	const childId = childRes.json().person.id as number;
	const childLogin = await app.inject({
		method: 'POST',
		url: '/api/v1/session',
		...lan,
		payload: { personId: childId, pin: '2222' }
	});
	const child = { id: childId, cookie: cookieOf(childLogin) };

	const jwt = await sign();
	const pub = {
		remoteAddress: TUNNEL_IP,
		headers: { host: PUBLIC_HOST, 'cf-access-jwt-assertion': jwt }
	};
	const pubLogin = await app.inject({
		method: 'POST',
		url: '/api/v1/session',
		...pub,
		payload: { personId: parent.id, pin: '1111' }
	});
	const parentPublic = {
		headers: { ...pub.headers, cookie: cookieOf(pubLogin) },
		remoteAddress: TUNNEL_IP
	};

	const as = (who: { cookie: string }) => ({ ...lan, headers: { cookie: who.cookie } });
	return { app, db, google, parent, child, parentPublic, as };
}

/** Konto verbinden wie im Browser: connect → Google → callback */
async function connect(w: Awaited<ReturnType<typeof world>>) {
	const res = await w.app.inject({ url: '/api/v1/google/connect', ...w.parentPublic });
	expect(res.statusCode).toBe(302);
	const state = new URL(res.headers.location as string).searchParams.get('state')!;
	const cb = await w.app.inject({
		url: `/api/v1/google/callback?code=abc&state=${state}`,
		...w.parentPublic
	});
	await w.app.sync.syncAll();
	return cb;
}

async function enableAll(w: Awaited<ReturnType<typeof world>>) {
	const sources = listSources(w.db);
	const assign: Record<string, number | null> = {
		'mama@example.com': w.parent.id,
		'familie@group': null,
		'kind@group': w.child.id
	};
	for (const s of sources) {
		const r = await w.app.inject({
			method: 'PATCH',
			url: `/api/v1/calendars/${s.id}`,
			...w.as(w.parent),
			payload: { enabled: true, personId: assign[s.remote_id] }
		});
		expect(r.statusCode).toBe(200);
	}
	await w.app.sync.syncAll();
	return Object.fromEntries(listSources(w.db).map((s) => [s.remote_id, s.id]));
}

const range = '/api/v1/events?from=2026-01-01T00:00:00Z&to=2026-12-31T00:00:00Z';
const timed = (start: string, end: string) => ({ allDay: false, start, end });

describe('Google verbinden', () => {
	it('nur über die öffentliche Adresse; State wird geprüft; Token verschlüsselt', async () => {
		const w = await world();
		const viaLan = await w.app.inject({ url: '/api/v1/google/connect', ...w.as(w.parent) });
		expect(viaLan.statusCode).toBe(409);

		const forged = await w.app.inject({
			url: '/api/v1/google/callback?code=abc&state=gefälscht',
			...w.parentPublic
		});
		expect(forged.headers.location).toBe('/einstellungen?google=error');

		const ok = await connect(w);
		expect(ok.headers.location).toBe('/einstellungen?google=ok');

		const [acc] = listAccounts(w.db);
		expect(acc).toMatchObject({ email: 'mama@example.com', person_id: w.parent.id, status: 'ok' });
		expect(acc!.refresh_token_enc).not.toContain('rt-abc');

		const cals = (await w.app.inject({ url: '/api/v1/calendars', ...lan })).json().calendars;
		expect(cals.map((c: { summary: string; enabled: boolean }) => [c.summary, c.enabled])).toEqual([
			['Familie', false],
			['Kind', false],
			['Mama', true]
		]);
	});

	it('State ist nur einmal gültig', async () => {
		const w = await world();
		const res = await w.app.inject({ url: '/api/v1/google/connect', ...w.parentPublic });
		const state = new URL(res.headers.location as string).searchParams.get('state')!;
		const url = `/api/v1/google/callback?code=abc&state=${state}`;
		expect((await w.app.inject({ url, ...w.parentPublic })).headers.location).toContain('ok');
		expect((await w.app.inject({ url, ...w.parentPublic })).headers.location).toContain('error');
	});

	it('Kind darf Kalender nicht zuordnen', async () => {
		const w = await world();
		await connect(w);
		const s = listSources(w.db)[0]!;
		const r = await w.app.inject({
			method: 'PATCH',
			url: `/api/v1/calendars/${s.id}`,
			...w.as(w.child),
			payload: { enabled: true }
		});
		expect(r.statusCode).toBe(403);
	});
});

describe('Termine schreiben', () => {
	it('Eltern legen im Familienkalender an: landet in Google und lokal als „Alle“', async () => {
		const w = await world();
		await connect(w);
		const ids = await enableAll(w);
		const res = await w.app.inject({
			method: 'POST',
			url: '/api/v1/events',
			...w.as(w.parent),
			payload: {
				sourceId: ids['familie@group'],
				title: 'Elternabend',
				...timed('2026-10-20T19:00:00+02:00', '2026-10-20T20:30:00+02:00')
			}
		});
		expect(res.statusCode).toBe(201);
		const insert = w.google.calls.find((c) => c.op === 'insert')!;
		expect(insert).toMatchObject({
			calendarId: 'familie@group',
			body: {
				summary: 'Elternabend',
				start: { dateTime: '2026-10-20T17:00:00.000Z', timeZone: 'Europe/Berlin' }
			}
		});
		const events = (await w.app.inject({ url: range, ...lan })).json().events;
		expect(events).toEqual([
			expect.objectContaining({
				title: 'Elternabend',
				personId: null,
				createdBy: w.parent.id,
				allDay: false
			})
		]);
	});

	it('ganztägig mehrtägig: Ende inklusiv im Formular', async () => {
		const w = await world();
		await connect(w);
		const ids = await enableAll(w);
		await w.app.inject({
			method: 'POST',
			url: '/api/v1/events',
			...w.as(w.parent),
			payload: {
				sourceId: ids['familie@group'],
				title: 'Urlaub',
				allDay: true,
				startDate: '2026-10-26',
				endDate: '2026-10-30'
			}
		});
		const e = (await w.app.inject({ url: range, ...lan })).json().events[0];
		expect(e).toMatchObject({ allDay: true, start: '2026-10-26', end: '2026-10-31' });
	});

	it('Kind: nur im eigenen Kalender, nur eigene Termine ändern', async () => {
		const w = await world();
		await connect(w);
		const ids = await enableAll(w);
		const create = (who: { cookie: string }, sourceId: number, title: string) =>
			w.app.inject({
				method: 'POST',
				url: '/api/v1/events',
				...w.as(who),
				payload: {
					sourceId,
					title,
					...timed('2026-10-21T15:00:00+02:00', '2026-10-21T16:00:00+02:00')
				}
			});

		expect((await create(w.child, ids['mama@example.com']!, 'X')).statusCode).toBe(403);
		expect((await create(w.child, ids['familie@group']!, 'X')).statusCode).toBe(403);
		const own = await create(w.child, ids['kind@group']!, 'Training');
		expect(own.statusCode).toBe(201);
		const byParent = await create(w.parent, ids['kind@group']!, 'Zahnarzt');

		const patch = (id: number) =>
			w.app.inject({
				method: 'PATCH',
				url: `/api/v1/events/${id}`,
				...w.as(w.child),
				payload: { title: 'Geändert' }
			});
		expect((await patch(byParent.json().id)).statusCode).toBe(403);
		expect((await patch(own.json().id)).statusCode).toBe(204);
		const del = await w.app.inject({
			method: 'DELETE',
			url: `/api/v1/events/${byParent.json().id}`,
			...w.as(w.child)
		});
		expect(del.statusCode).toBe(403);
	});

	it('Konflikt: in Google zwischenzeitlich geändert → 409, Google-Stand gewinnt', async () => {
		const w = await world();
		await connect(w);
		const ids = await enableAll(w);
		w.google.put('familie@group', {
			id: 'g1',
			summary: 'Original',
			start: { dateTime: '2026-10-22T08:00:00Z' },
			end: { dateTime: '2026-10-22T09:00:00Z' }
		});
		await w.app.sync.syncAll();
		const local = (await w.app.inject({ url: range, ...lan })).json().events[0];
		expect(local.title).toBe('Original');

		// Jemand ändert den Termin direkt in Google; lokal noch alter ETag
		w.google.put('familie@group', {
			id: 'g1',
			summary: 'In Google geändert',
			start: { dateTime: '2026-10-22T08:00:00Z' },
			end: { dateTime: '2026-10-22T09:00:00Z' }
		});
		const res = await w.app.inject({
			method: 'PATCH',
			url: `/api/v1/events/${local.id}`,
			...w.as(w.parent),
			payload: { title: 'Meine Änderung' }
		});
		expect(res.statusCode).toBe(409);
		expect(res.json().error).toBe('conflict');
		expect(w.google.find('familie@group', 'g1')?.summary).toBe('In Google geändert');
		const after = (await w.app.inject({ url: range, ...lan })).json().events[0];
		expect(after.title).toBe('In Google geändert');
		expect(ids).toBeDefined();
	});

	it('Serie: Verschieben eines Termins verschiebt die ganze Serie, Löschen löscht sie', async () => {
		const w = await world();
		await connect(w);
		await enableAll(w);
		w.google.put('familie@group', {
			id: 'serie',
			summary: 'Schwimmen',
			recurrence: ['RRULE:FREQ=WEEKLY'],
			start: { dateTime: '2026-10-19T15:00:00Z', timeZone: 'Europe/Berlin' },
			end: { dateTime: '2026-10-19T16:00:00Z', timeZone: 'Europe/Berlin' }
		});
		for (const [id, day] of [
			['serie_1', '19'],
			['serie_2', '26']
		] as const) {
			w.google.put('familie@group', {
				id,
				summary: 'Schwimmen',
				recurringEventId: 'serie',
				start: { dateTime: `2026-10-${day}T15:00:00Z` },
				end: { dateTime: `2026-10-${day}T16:00:00Z` }
			});
		}
		await w.app.sync.syncAll();
		const [first] = (await w.app.inject({ url: range, ...lan })).json().events;
		expect(first).toMatchObject({ title: 'Schwimmen', recurring: true });

		const moved = await w.app.inject({
			method: 'PATCH',
			url: `/api/v1/events/${first.id}`,
			...w.as(w.parent),
			payload: { ...timed('2026-10-19T16:00:00Z', '2026-10-19T17:30:00Z') }
		});
		expect(moved.statusCode).toBe(204);
		const masterPatch = w.google.calls.find((c) => c.op === 'patch')!;
		expect(masterPatch.eventId).toBe('serie');
		expect(masterPatch.body?.start?.dateTime).toBe('2026-10-19T16:00:00.000Z');
		expect(masterPatch.body?.end?.dateTime).toBe('2026-10-19T17:30:00.000Z');
		const starts = (await w.app.inject({ url: range, ...lan }))
			.json()
			.events.map((e: { start: string }) => e.start);
		expect(starts).toEqual(['2026-10-19T16:00:00.000Z', '2026-10-26T16:00:00.000Z']);

		const del = await w.app.inject({
			method: 'DELETE',
			url: `/api/v1/events/${first.id}`,
			...w.as(w.parent)
		});
		expect(del.statusCode).toBe(204);
		expect(w.google.find('familie@group', 'serie')?.status).toBe('cancelled');
		expect((await w.app.inject({ url: range, ...lan })).json().events).toEqual([]);
	});

	it('ungültige Zeiten und Zeiträume ergeben 400', async () => {
		const w = await world();
		await connect(w);
		const ids = await enableAll(w);
		const res = await w.app.inject({
			method: 'POST',
			url: '/api/v1/events',
			...w.as(w.parent),
			payload: {
				sourceId: ids['familie@group'],
				title: 'X',
				...timed('2026-10-20T10:00:00Z', '2026-10-20T09:00:00Z')
			}
		});
		expect(res.statusCode).toBe(400);
		const big = await w.app.inject({
			url: '/api/v1/events?from=2020-01-01T00:00:00Z&to=2030-01-01T00:00:00Z',
			...lan
		});
		expect(big.statusCode).toBe(400);
	});
});
