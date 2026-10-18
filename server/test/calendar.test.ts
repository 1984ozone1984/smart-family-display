import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fromGoogle, toGoogleTimes } from '../src/calendar/map.ts';
import {
	discoverSources,
	eventsInRange,
	listSources,
	updateSource,
	upsertAccount
} from '../src/calendar/store.ts';
import { createSync } from '../src/calendar/sync.ts';
import { createCrypto } from '../src/crypto.ts';
import { migrate, openDb } from '../src/db/index.ts';
import { createEventBus } from '../src/events/bus.ts';
import { localMidnightUtc } from '../src/time.ts';
import { fakeGoogle } from './fake-google.ts';

const TZ = 'Europe/Berlin';
const NOW = new Date('2026-10-15T10:00:00Z');

function setup() {
	const db = openDb(':memory:');
	migrate(db);
	db.prepare(
		"INSERT INTO person (id, name, color, role, pin_hash) VALUES (1, 'Mama', '#000000', 'parent', 'x'), (2, 'Kind', '#000000', 'child', 'x')"
	).run();
	const google = fakeGoogle();
	const bus = createEventBus();
	const published: string[] = [];
	const orig = bus.publish;
	bus.publish = (e) => {
		published.push(e.type);
		orig(e);
	};
	let now = NOW;
	const sync = createSync({ db, bus, tz: TZ, apiFor: () => google.api, now: () => now });
	const acc = upsertAccount(db, { personId: 1, email: 'mama@example.com', refreshTokenEnc: 'x' });
	google.calendars.push({
		id: 'mama@example.com',
		summary: 'Mama',
		primary: true,
		accessRole: 'owner'
	});
	discoverSources(db, acc.id, 1, google.calendars);
	const source = listSources(db)[0]!;
	return {
		db,
		google,
		sync,
		source,
		published,
		setNow: (d: Date) => (now = d),
		events: () => eventsInRange(db, '2026-01-01T00:00:00Z', '2027-12-31T00:00:00Z')
	};
}

describe('Verschlüsselung', () => {
	it('verschlüsselt, entschlüsselt und erkennt Manipulation', () => {
		const c = createCrypto(randomBytes(32).toString('base64'));
		const enc = c.encrypt('geheimer-token');
		expect(enc).not.toContain('geheimer');
		expect(c.decrypt(enc)).toBe('geheimer-token');
		const tampered = enc.slice(0, -4) + (enc.endsWith('AAAA') ? 'BBBB' : 'AAAA');
		expect(() => c.decrypt(tampered)).toThrow();
		expect(() => createCrypto(randomBytes(32).toString('base64')).decrypt(enc)).toThrow();
		expect(() => createCrypto('zu-kurz')).toThrow(/32 Byte/);
	});
});

describe('Zeit', () => {
	it('Mitternacht in der Zeitzone, auch rund um die Zeitumstellung', () => {
		expect(localMidnightUtc('2026-07-01', TZ)).toBe('2026-06-30T22:00:00.000Z');
		expect(localMidnightUtc('2026-01-15', TZ)).toBe('2026-01-14T23:00:00.000Z');
		expect(localMidnightUtc('2026-03-29', TZ)).toBe('2026-03-28T23:00:00.000Z');
		expect(localMidnightUtc('2026-03-30', TZ)).toBe('2026-03-29T22:00:00.000Z');
	});

	it('Ganztägig: Ende im Formular inklusiv, bei Google exklusiv', () => {
		expect(
			toGoogleTimes({ allDay: true, startDate: '2026-10-20', endDate: '2026-10-21' }, TZ)
		).toEqual({
			start: { date: '2026-10-20' },
			end: { date: '2026-10-22' }
		});
		const local = fromGoogle(
			{ id: 'a', etag: 'e', start: { date: '2026-10-20' }, end: { date: '2026-10-21' } },
			TZ
		)!;
		expect(local).toMatchObject({ all_day: true, start: '2026-10-20', title: '(ohne Titel)' });
		expect(local.range_start).toBe('2026-10-19T22:00:00.000Z');
	});
});

describe('Kalenderquellen', () => {
	it('Hauptkalender aktiv, geteilter Familienkalender nur einmal, Schreibrecht gewinnt', () => {
		const { db, google } = setup();
		google.calendars.push({ id: 'familie@group', summary: 'Familie', accessRole: 'reader' });
		discoverSources(db, 1, 1, google.calendars);

		const papa = upsertAccount(db, {
			personId: 1,
			email: 'papa@example.com',
			refreshTokenEnc: 'x'
		});
		discoverSources(db, papa.id, 1, [
			{ id: 'papa@example.com', summary: 'Papa', primary: true, accessRole: 'owner' },
			{ id: 'familie@group', summary: 'Familie', accessRole: 'writer' }
		]);

		const sources = listSources(db);
		expect(sources.filter((s) => s.remote_id === 'familie@group')).toHaveLength(1);
		const familie = sources.find((s) => s.remote_id === 'familie@group')!;
		expect(familie).toMatchObject({
			account_id: papa.id,
			writable: true,
			enabled: false,
			person_id: null
		});
		expect(sources.find((s) => s.remote_id === 'mama@example.com')).toMatchObject({
			enabled: true,
			person_id: 1
		});
	});
});

describe('Sync', () => {
	const timed = (id: string, start: string, end: string, summary = id) => ({
		id,
		summary,
		start: { dateTime: start },
		end: { dateTime: end }
	});

	it('Vollabgleich, dann inkrementell: Änderung, Löschung, außerhalb des Zeitraums', async () => {
		const { google, sync, source, events, published } = setup();
		google.put('mama@example.com', timed('a', '2026-10-16T08:00:00Z', '2026-10-16T09:00:00Z'));
		google.put('mama@example.com', timed('b', '2026-10-17T08:00:00Z', '2026-10-17T09:00:00Z'));
		google.put('mama@example.com', timed('alt', '2025-01-01T08:00:00Z', '2025-01-01T09:00:00Z'));

		expect(await sync.syncAll()).toEqual([source.id]);
		expect(events().map((e) => e.remote_id)).toEqual(['a', 'b']);
		expect(published).toContain('events.changed');

		google.put(
			'mama@example.com',
			timed('a', '2026-10-16T10:00:00Z', '2026-10-16T11:00:00Z', 'Neu')
		);
		google.remove('mama@example.com', 'b');
		google.put('mama@example.com', timed('weit', '2028-01-01T08:00:00Z', '2028-01-01T09:00:00Z'));
		await sync.syncAll();

		expect(google.calls.filter((c) => c.op === 'list')).toHaveLength(2);
		expect(events().map((e) => [e.remote_id, e.title])).toEqual([['a', 'Neu']]);
		// Ohne Änderung: kein Event
		published.length = 0;
		expect(await sync.syncAll()).toEqual([]);
		expect(published).not.toContain('events.changed');
	});

	it('abgelaufener syncToken (410) führt zu Vollabgleich', async () => {
		const { google, sync, events } = setup();
		google.put('mama@example.com', timed('a', '2026-10-16T08:00:00Z', '2026-10-16T09:00:00Z'));
		await sync.syncAll();
		google.expireSyncTokens();
		google.remove('mama@example.com', 'a');
		google.put('mama@example.com', timed('c', '2026-10-18T08:00:00Z', '2026-10-18T09:00:00Z'));
		await sync.syncAll();
		expect(events().map((e) => e.remote_id)).toEqual(['c']);
	});

	it('nach 24 h wieder Vollabgleich, damit neue Tage nachrücken', async () => {
		const { google, sync, setNow, events } = setup();
		// Existiert schon, liegt aber erst ab morgen im Fenster (+180 Tage) und ändert sich nicht
		google.put('mama@example.com', timed('spät', '2027-04-14T05:00:00Z', '2027-04-14T06:00:00Z'));
		await sync.syncAll();
		expect(events()).toEqual([]);
		setNow(new Date('2026-10-15T20:00:00Z'));
		await sync.syncAll();
		expect(events()).toEqual([]);
		setNow(new Date('2026-10-16T11:00:00Z'));
		await sync.syncAll();
		expect(events().map((e) => e.remote_id)).toEqual(['spät']);
	});

	it('Fehler einer Quelle stoppt die anderen nicht und wird gespeichert', async () => {
		const { db, google, sync, source } = setup();
		google.api.listEvents = async () => {
			throw new Error('kaputt');
		};
		await sync.syncAll();
		expect(listSources(db).find((s) => s.id === source.id)?.last_error).toBe('kaputt');
	});

	it('Ausschalten löscht den Cache, Einschalten gleicht neu ab', async () => {
		const { db, google, sync, source, events } = setup();
		google.put('mama@example.com', timed('a', '2026-10-16T08:00:00Z', '2026-10-16T09:00:00Z'));
		await sync.syncAll();
		updateSource(db, source.id, { enabled: false });
		expect(events()).toEqual([]);
		updateSource(db, source.id, { enabled: true });
		await sync.syncAll();
		expect(events()).toHaveLength(1);
	});
});
