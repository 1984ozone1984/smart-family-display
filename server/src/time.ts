const DAY_MS = 86_400_000;

/** Abstand der Zeitzone `tz` zu UTC zum Zeitpunkt `utcMs`, in ms. */
function offsetMs(utcMs: number, tz: string): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: tz,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	}).formatToParts(new Date(utcMs));
	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
	const local = Date.UTC(
		get('year'),
		get('month') - 1,
		get('day'),
		get('hour'),
		get('minute'),
		get('second')
	);
	return local - Math.floor(utcMs / 1000) * 1000;
}

/** UTC-Zeitpunkt (ISO) für 00:00 Uhr am Kalendertag `date` (YYYY-MM-DD) in `tz`. */
export function localMidnightUtc(date: string, tz: string): string {
	const [y, m, d] = date.split('-').map(Number) as [number, number, number];
	const guess = Date.UTC(y, m - 1, d);
	let t = guess - offsetMs(guess, tz);
	// Bei Sommerzeitwechsel liegt der Offset am Ziel ggf. anders
	t = guess - offsetMs(t, tz);
	return new Date(t).toISOString();
}

/** Kalendertag (YYYY-MM-DD) plus `days`. */
export function addDays(date: string, days: number): string {
	const [y, m, d] = date.split('-').map(Number) as [number, number, number];
	return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Ganze Tage zwischen zwei Kalendertagen (b − a). */
export function daysBetween(a: string, b: string): number {
	return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/** Heutiger Kalendertag (YYYY-MM-DD) in `tz`. */
export function todayIn(tz: string, now = new Date()): string {
	// en-CA formatiert als YYYY-MM-DD
	return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
}

/** ISO-Wochentag: 1 = Montag … 7 = Sonntag */
export function isoWeekday(date: string): number {
	const d = new Date(`${date}T00:00:00Z`).getUTCDay();
	return d === 0 ? 7 : d;
}

/** Montag der Woche, in der `date` liegt */
export function weekStart(date: string): string {
	return addDays(date, 1 - isoWeekday(date));
}
