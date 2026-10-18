import type { CalendarApi, GCalendar, GEvent, GEventInput } from '../src/google/calendar-api.ts';
import { GoogleError } from '../src/google/errors.ts';

type Stored = GEvent & { _v: number };

/**
 * In-Memory-Nachbau der Calendar-API mit den Eigenschaften, auf die sich der Sync verlässt:
 * syncToken (nur Änderungen inkl. gelöschter), ETag-Prüfung (412), abgelaufene Tokens (410),
 * Serien (Master + Einzeltermine; Master-Änderungen verschieben die Einzeltermine).
 */
export function fakeGoogle() {
	const calendars: GCalendar[] = [];
	const events = new Map<string, Map<string, Stored>>();
	let version = 0;
	let nextId = 1;
	let expireTokens = false;
	const calls: { op: string; calendarId: string; eventId?: string; body?: GEventInput }[] = [];

	const cal = (id: string) => {
		let m = events.get(id);
		if (!m) events.set(id, (m = new Map()));
		return m;
	};
	const touch = (e: GEvent): Stored => ({
		...e,
		etag: `"e${++version}"`,
		_v: version,
		updated: new Date().toISOString()
	});
	const strip = ({ _v: _, ...e }: Stored): GEvent => e;
	const startOf = (e: GEvent) => e.start?.dateTime ?? `${e.start?.date}T00:00:00Z`;
	const endOf = (e: GEvent) => e.end?.dateTime ?? `${e.end?.date}T00:00:00Z`;
	const shiftTime = (t: GEvent['start'], ms: number) =>
		t?.dateTime ? { ...t, dateTime: new Date(Date.parse(t.dateTime) + ms).toISOString() } : t;

	function get(calendarId: string, eventId: string): Stored {
		const e = cal(calendarId).get(eventId);
		if (!e || e.status === 'cancelled') throw new GoogleError(404, 'notFound');
		return e;
	}

	const api: CalendarApi = {
		async listCalendars() {
			return calendars;
		},
		async listEvents(calendarId, q) {
			calls.push({ op: 'list', calendarId });
			const all = [...cal(calendarId).values()].filter((e) => !e.recurrence);
			if (q.syncToken) {
				if (expireTokens) throw new GoogleError(410, 'fullSyncRequired');
				const since = Number(q.syncToken.slice(1));
				return { items: all.filter((e) => e._v > since).map(strip), nextSyncToken: `v${version}` };
			}
			const items = all.filter(
				(e) =>
					e.status !== 'cancelled' &&
					(!q.timeMax || startOf(e) < q.timeMax) &&
					(!q.timeMin || endOf(e) > q.timeMin)
			);
			return { items: items.map(strip), nextSyncToken: `v${version}` };
		},
		async getEvent(calendarId, eventId) {
			return strip(get(calendarId, eventId));
		},
		async insertEvent(calendarId, body) {
			calls.push({ op: 'insert', calendarId, body });
			const e = touch({ id: `ev${nextId++}`, etag: '', status: 'confirmed', ...body });
			cal(calendarId).set(e.id, e);
			return strip(e);
		},
		async patchEvent(calendarId, eventId, body, etag) {
			calls.push({ op: 'patch', calendarId, eventId, body });
			const prev = get(calendarId, eventId);
			if (prev.etag !== etag) throw new GoogleError(412, 'conditionNotMet');
			const next = touch({ ...prev, ...body });
			cal(calendarId).set(eventId, next);
			if (prev.recurrence) {
				const delta = Date.parse(startOf(next)) - Date.parse(startOf(prev));
				for (const [id, inst] of cal(calendarId)) {
					if (inst.recurringEventId !== eventId) continue;
					cal(calendarId).set(
						id,
						touch({
							...inst,
							summary: next.summary,
							start: shiftTime(inst.start, delta),
							end: shiftTime(inst.end, delta)
						})
					);
				}
			}
			return strip(next);
		},
		async deleteEvent(calendarId, eventId, etag) {
			calls.push({ op: 'delete', calendarId, eventId });
			const prev = get(calendarId, eventId);
			if (prev.etag !== etag) throw new GoogleError(412, 'conditionNotMet');
			cal(calendarId).set(eventId, touch({ ...prev, status: 'cancelled' }));
			for (const [id, inst] of cal(calendarId))
				if (inst.recurringEventId === eventId)
					cal(calendarId).set(id, touch({ ...inst, status: 'cancelled' }));
		}
	};

	return {
		api,
		calls,
		calendars,
		/** Termin direkt „in Google“ anlegen/ändern (wie ein anderer Client) */
		put(calendarId: string, e: Omit<GEvent, 'etag'>): GEvent {
			const s = touch({ status: 'confirmed', ...e, etag: '' });
			cal(calendarId).set(s.id, s);
			return strip(s);
		},
		remove(calendarId: string, eventId: string) {
			const prev = get(calendarId, eventId);
			cal(calendarId).set(eventId, touch({ ...prev, status: 'cancelled' }));
		},
		find(calendarId: string, eventId: string): GEvent | undefined {
			const e = cal(calendarId).get(eventId);
			return e && strip(e);
		},
		expireSyncTokens(v = true) {
			expireTokens = v;
		}
	};
}

export type FakeGoogle = ReturnType<typeof fakeGoogle>;
