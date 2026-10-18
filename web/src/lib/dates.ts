import type { CalEvent } from './api.ts';

const DAY_MS = 86_400_000;
const LOCALE = 'de-DE';

/** Lokales Datum als YYYY-MM-DD */
export function isoDate(d: Date): string {
	const m = String(d.getMonth() + 1).padStart(2, '0');
	return `${d.getFullYear()}-${m}-${String(d.getDate()).padStart(2, '0')}`;
}

/** YYYY-MM-DD → lokale Mitternacht */
export function fromIsoDate(s: string): Date {
	const [y, m, d] = s.split('-').map(Number) as [number, number, number];
	return new Date(y, m - 1, d);
}

export function startOfDay(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Montag der Woche */
export function startOfWeek(d: Date): Date {
	const day = (d.getDay() + 6) % 7;
	return addDays(startOfDay(d), -day);
}

export function sameDay(a: Date, b: Date): boolean {
	return isoDate(a) === isoDate(b);
}

/** Beginn/Ende eines Termins als lokale Zeitpunkte (ganztägig: Mitternacht, Ende exklusiv) */
export function bounds(e: CalEvent): { start: Date; end: Date } {
	return e.allDay
		? { start: fromIsoDate(e.start), end: fromIsoDate(e.end) }
		: { start: new Date(e.start), end: new Date(e.end) };
}

export function onDay(e: CalEvent, day: Date): boolean {
	const { start, end } = bounds(e);
	const from = startOfDay(day);
	const to = addDays(from, 1);
	return start < to && end > from;
}

export function eventsOnDay(events: CalEvent[], day: Date): CalEvent[] {
	return events
		.filter((e) => onDay(e, day))
		.sort(
			(a, b) =>
				Number(b.allDay) - Number(a.allDay) || bounds(a).start.getTime() - bounds(b).start.getTime()
		);
}

export const fmtTime = (d: Date) =>
	d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
export const fmtDay = (d: Date) =>
	d.toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });
export const fmtDayShort = (d: Date) =>
	d.toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'numeric' });

/** „09:00–10:30“ oder „ganztägig“; mehrtägig je nach Tag „ab 18:00“ / „bis 10:00“ */
export function fmtRange(e: CalEvent, day?: Date): string {
	const { start, end } = bounds(e);
	if (e.allDay) {
		const days = Math.round((end.getTime() - start.getTime()) / DAY_MS);
		return days > 1 ? `${fmtDayShort(start)} – ${fmtDayShort(addDays(end, -1))}` : 'ganztägig';
	}
	if (!day || sameDay(start, end)) return `${fmtTime(start)}–${fmtTime(end)}`;
	if (sameDay(start, day)) return `ab ${fmtTime(start)}`;
	if (sameDay(end, day)) return `bis ${fmtTime(end)}`;
	return 'ganztägig';
}
