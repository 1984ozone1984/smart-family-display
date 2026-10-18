import type { SessionPerson } from '../auth/session.ts';
import type { Db } from '../db/index.ts';
import type { EventBus } from '../events/bus.ts';
import type { CalendarApi, GEvent, GEventInput } from '../google/calendar-api.ts';
import { GoogleError } from '../google/errors.ts';
import { addDays, daysBetween } from '../time.ts';
import { fromGoogle, toGoogleTimes, type EventTimes } from './map.ts';
import {
	deleteEventByRemote,
	getEvent,
	getEventByRemote,
	getSource,
	upsertEvent,
	type EventRow,
	type SourceRow
} from './store.ts';
import type { Sync } from './sync.ts';

export class CalendarError extends Error {
	status: 403 | 404 | 409 | 422 | 502;
	code: string;
	constructor(status: CalendarError['status'], code: string) {
		super(code);
		this.status = status;
		this.code = code;
	}
}

export type EventInput = {
	title: string;
	location?: string | null;
	description?: string | null;
} & EventTimes;

/** In diesen Kalender darf die Person schreiben: Eltern überall, Kinder nur in ihren eigenen. */
export function canWriteSource(p: SessionPerson, s: SourceRow): boolean {
	return s.enabled && s.writable && (p.role === 'parent' || s.person_id === p.id);
}

/** Kinder ändern nur Termine, die sie selbst in der App angelegt haben (Bearbeitungsschutz). */
export function canModifyEvent(p: SessionPerson, e: EventRow, s: SourceRow): boolean {
	return canWriteSource(p, s) && (p.role === 'parent' || e.created_by === p.id);
}

export function createCalendarService(deps: {
	db: Db;
	bus: EventBus;
	tz: string;
	apiFor: (accountId: number) => CalendarApi;
	sync: Sync;
}) {
	const { db, bus, tz } = deps;
	const changed = (sourceId: number) =>
		bus.publish({ type: 'events.changed', data: { sourceIds: [sourceId] } });

	function load(p: SessionPerson, eventId: number) {
		const ev = getEvent(db, eventId);
		const src = ev && getSource(db, ev.source_id);
		if (!ev || !src) throw new CalendarError(404, 'not found');
		if (!canModifyEvent(p, ev, src)) throw new CalendarError(403, 'not allowed');
		return { ev, src, api: deps.apiFor(src.account_id) };
	}

	/** Google-Fehler übersetzen; bei 412 (ETag) gilt die Quelle: neu laden und Konflikt melden. */
	async function guard<T>(src: SourceRow, fn: () => Promise<T>): Promise<T> {
		try {
			return await fn();
		} catch (err) {
			if (err instanceof GoogleError && err.status === 412) {
				await deps.sync.syncSource(getSource(db, src.id)!).catch(() => {});
				changed(src.id);
				throw new CalendarError(409, 'conflict');
			}
			if (err instanceof GoogleError) throw new CalendarError(502, `google: ${err.reason}`);
			throw err;
		}
	}

	/** Nach Schreiben: eigenen Stand übernehmen und (für Serien) die Einzeltermine nachziehen. */
	async function settle(src: SourceRow, g: GEvent | null, createdBy?: number) {
		if (g && !g.recurrence) {
			const local = fromGoogle(g, tz);
			if (local) upsertEvent(db, src.id, local, createdBy);
		}
		await deps.sync.syncSource(getSource(db, src.id)!).catch(() => {});
		changed(src.id);
	}

	function body(input: Partial<EventInput>): GEventInput {
		const b: GEventInput = {};
		if (input.title !== undefined) b.summary = input.title;
		if (input.location !== undefined) b.location = input.location ?? '';
		if (input.description !== undefined) b.description = input.description ?? '';
		return b;
	}

	/** Verschiebt eine Serie um denselben Abstand, um den der gewählte Einzeltermin verschoben wurde. */
	function shiftSeries(
		master: GEvent,
		ev: EventRow,
		t: EventTimes
	): Pick<GEventInput, 'start' | 'end'> {
		if (t.allDay !== ev.all_day || Boolean(master.start?.date) !== ev.all_day)
			throw new CalendarError(422, 'series all-day change');
		if (t.allDay) {
			const shift = daysBetween(ev.start, t.startDate);
			const length = daysBetween(t.startDate, addDays(t.endDate, 1));
			const start = addDays(master.start!.date!, shift);
			return { start: { date: start }, end: { date: addDays(start, length) } };
		}
		const shift = Date.parse(t.start) - Date.parse(ev.start);
		const length = Date.parse(t.end) - Date.parse(t.start);
		const start = Date.parse(master.start!.dateTime!) + shift;
		const zone = master.start!.timeZone ?? tz;
		return {
			start: { dateTime: new Date(start).toISOString(), timeZone: zone },
			end: {
				dateTime: new Date(start + length).toISOString(),
				timeZone: master.end?.timeZone ?? zone
			}
		};
	}

	return {
		/**
		 * `p === null`: am Tablet ohne Anmeldung – jeder beschreibbare Kalender; der Termin gilt
		 * als von der Kalender-Person angelegt (beim Familienkalender von niemandem).
		 */
		async create(p: SessionPerson | null, sourceId: number, input: EventInput): Promise<EventRow> {
			const src = getSource(db, sourceId);
			if (!src) throw new CalendarError(404, 'calendar not found');
			const allowed = p ? canWriteSource(p, src) : src.enabled && src.writable;
			if (!allowed) throw new CalendarError(403, 'not allowed');
			const api = deps.apiFor(src.account_id);
			const g = await guard(src, () =>
				api.insertEvent(src.remote_id, { ...body(input), ...toGoogleTimes(input, tz) })
			);
			await settle(src, g, p?.id ?? src.person_id ?? undefined);
			return getEventByRemote(db, src.id, g.id)!;
		},

		/** Änderung an einem Serientermin betrifft in v1 immer die ganze Serie. */
		async update(p: SessionPerson, eventId: number, input: Partial<EventInput>): Promise<void> {
			const { ev, src, api } = load(p, eventId);
			const times = 'allDay' in input && input.allDay !== undefined ? (input as EventTimes) : null;
			if (ev.recurring_id) {
				const masterId = ev.recurring_id;
				const master = await guard(src, () => api.getEvent(src.remote_id, masterId));
				const patch = { ...body(input), ...(times ? shiftSeries(master, ev, times) : {}) };
				await guard(src, () => api.patchEvent(src.remote_id, masterId, patch, master.etag));
				await settle(src, null);
				return;
			}
			const patch = { ...body(input), ...(times ? toGoogleTimes(times, tz) : {}) };
			const g = await guard(src, () => api.patchEvent(src.remote_id, ev.remote_id, patch, ev.etag));
			await settle(src, g);
		},

		/** Löschen eines Serientermins löscht die ganze Serie. */
		async remove(p: SessionPerson, eventId: number): Promise<void> {
			const { ev, src, api } = load(p, eventId);
			const targetId = ev.recurring_id ?? ev.remote_id;
			try {
				const etag = ev.recurring_id ? (await api.getEvent(src.remote_id, targetId)).etag : ev.etag;
				await guard(src, () => api.deleteEvent(src.remote_id, targetId, etag));
			} catch (err) {
				// Schon weg (404/410): lokal nachziehen
				const gone =
					(err instanceof GoogleError && (err.status === 404 || err.status === 410)) ||
					(err instanceof CalendarError && /google: (notFound|deleted)/.test(err.code));
				if (!gone) throw err;
			}
			if (!ev.recurring_id) deleteEventByRemote(db, src.id, ev.remote_id);
			await settle(src, null);
		}
	};
}

export type CalendarService = ReturnType<typeof createCalendarService>;
