import type { GEvent, GEventInput } from '../google/calendar-api.ts';
import { addDays, localMidnightUtc } from '../time.ts';
import type { LocalEvent } from './store.ts';

/** Google-Termin → lokaler Cache-Eintrag. Ganztägig: Datumsangaben, Ende exklusiv wie bei Google. */
export function fromGoogle(g: GEvent, tz: string): LocalEvent | null {
	if (!g.start || !g.end) return null;
	const allDay = Boolean(g.start.date);
	const start = allDay ? g.start.date! : new Date(g.start.dateTime!).toISOString();
	const end = allDay ? g.end.date! : new Date(g.end.dateTime!).toISOString();
	return {
		remote_id: g.id,
		recurring_id: g.recurringEventId ?? null,
		etag: g.etag,
		title: g.summary?.trim() || '(ohne Titel)',
		description: g.description ?? null,
		location: g.location ?? null,
		start,
		end,
		all_day: allDay,
		range_start: allDay ? localMidnightUtc(start, tz) : start,
		range_end: allDay ? localMidnightUtc(end, tz) : end,
		updated_at: g.updated ?? new Date().toISOString()
	};
}

export type EventTimes =
	| { allDay: true; startDate: string; endDate: string }
	| { allDay: false; start: string; end: string };

/** Zeiten für die Google-API; `endDate` bei ganztägig ist inklusiv (wie im Formular). */
export function toGoogleTimes(t: EventTimes, tz: string): Pick<GEventInput, 'start' | 'end'> {
	if (t.allDay) return { start: { date: t.startDate }, end: { date: addDays(t.endDate, 1) } };
	return {
		start: { dateTime: new Date(t.start).toISOString(), timeZone: tz },
		end: { dateTime: new Date(t.end).toISOString(), timeZone: tz }
	};
}
