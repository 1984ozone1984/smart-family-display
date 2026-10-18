import { api, type Calendar, type CalEvent, type Person } from './api.ts';
import { app } from './app.svelte.ts';

const FAMILY_COLOR = '#475569';

class CalendarState {
	calendars = $state<Calendar[]>([]);
	events = $state<CalEvent[]>([]);
	googleConfigured = $state(false);
	connectHere = $state(false);
	#range: { from: Date; to: Date } | null = null;
	#started = false;

	/** Einmalig nach dem App-Start: Daten laden und auf Server-Ereignisse hören. */
	start() {
		if (this.#started) return;
		this.#started = true;
		app.on('events.changed', () => void this.reload());
		app.on('calendars.changed', () => void this.loadCalendars());
		void this.loadCalendars();
	}

	async loadCalendars() {
		const [cals, status] = await Promise.all([
			api<{ calendars: Calendar[] }>('/calendars'),
			api<{ configured: boolean; connectHere: boolean }>('/google/status')
		]);
		this.calendars = cals.calendars;
		this.googleConfigured = status.configured;
		this.connectHere = status.connectHere;
	}

	/** Die aktuelle Ansicht legt fest, welcher Zeitraum geladen wird. */
	async show(from: Date, to: Date) {
		this.#range = { from, to };
		await this.reload();
	}

	async reload() {
		const r = this.#range;
		if (!r) return;
		const q = new URLSearchParams({ from: r.from.toISOString(), to: r.to.toISOString() });
		const { events } = await api<{ events: CalEvent[] }>(`/events?${q}`);
		// Antwort auf eine veraltete Anfrage nicht übernehmen
		if (this.#range === r) this.events = events;
	}

	async syncNow() {
		await api('/calendars/sync', { method: 'POST' });
		await this.reload();
	}

	colorOf(e: CalEvent): string {
		if (e.personId === null) return FAMILY_COLOR;
		return app.persons.find((p) => p.id === e.personId)?.color ?? FAMILY_COLOR;
	}

	/** Kalender, in die `me` schreiben darf (wie serverseitig geprüft) */
	writableFor(me: Person | null): Calendar[] {
		if (!me) return [];
		return this.calendars.filter(
			(c) => c.enabled && c.writable && (me.role === 'parent' || c.personId === me.id)
		);
	}

	canEdit(e: CalEvent, me: Person | null): boolean {
		if (!me) return false;
		const c = this.calendars.find((x) => x.id === e.sourceId);
		if (!c || !c.enabled || !c.writable) return false;
		return me.role === 'parent' || (c.personId === me.id && e.createdBy === me.id);
	}
}

export const cal = new CalendarState();
export { FAMILY_COLOR };
