import { api, ApiError, type Person, type Via } from './api.ts';

const POLL_MS = 30_000;
/** Am Tablet: angemeldete Person nach dieser Zeit ohne Bedienung wieder abmelden. */
const TABLET_IDLE_MS = 2 * 60_000;

class AppState {
	ready = $state(false);
	via = $state<Via>('lan');
	me = $state<Person | null>(null);
	persons = $state<Person[]>([]);
	setupNeeded = $state(false);
	/** Keine Personen-Session und öffentlicher Zugang: Login nötig, bevor etwas sichtbar ist. */
	needsLogin = $derived(this.via === 'public' && !this.me);
	isParent = $derived(this.me?.role === 'parent');
	live = $state<'sse' | 'polling' | 'offline'>('offline');

	#source: EventSource | null = null;
	#poll: ReturnType<typeof setInterval> | null = null;
	#idle: ReturnType<typeof setTimeout> | null = null;

	async init() {
		const [setup, session] = await Promise.all([
			api<{ needed: boolean }>('/setup'),
			api<{ via: Via; person: Person | null }>('/session')
		]);
		this.setupNeeded = setup.needed;
		this.via = session.via;
		this.me = session.person;
		if (!this.needsLogin && !this.setupNeeded) await this.loadPersons();
		this.ready = true;
		this.connect();
		if (this.via === 'lan') this.#watchIdle();
	}

	async loadPersons() {
		try {
			this.persons = (await api<{ persons: Person[] }>('/persons')).persons;
		} catch (err) {
			if (err instanceof ApiError && err.status === 401) this.me = null;
			else throw err;
		}
	}

	async login(personId: number, pin: string) {
		const { person } = await api<{ person: Person }>('/session', {
			method: 'POST',
			json: { personId, pin }
		});
		this.me = person;
		await this.loadPersons();
		this.connect();
		this.#bumpIdle();
	}

	async logout() {
		await api('/session', { method: 'DELETE' });
		this.me = null;
		if (this.via === 'public') {
			this.persons = [];
			this.#source?.close();
			this.#source = null;
			this.#stopPolling();
			this.live = 'offline';
		}
	}

	/** Server-Sent Events; bei Abbruch versucht EventSource selbst neu, bis dahin wird gepollt. */
	connect() {
		if (this.needsLogin || this.#source) return;
		if (typeof EventSource === 'undefined') return this.#startPolling();
		const es = new EventSource('/api/v1/events/stream');
		this.#source = es;
		es.onopen = () => {
			this.live = 'sse';
			this.#stopPolling();
			// Was während der Unterbrechung passiert ist, nachladen
			void this.loadPersons();
		};
		es.onerror = () => {
			if (es.readyState === EventSource.CLOSED) {
				this.#source = null;
				setTimeout(() => this.connect(), 5000);
			}
			this.#startPolling();
		};
		es.addEventListener('persons.changed', () => void this.loadPersons());
	}

	#startPolling() {
		if (this.#poll) return;
		this.live = 'polling';
		this.#poll = setInterval(() => void this.loadPersons(), POLL_MS);
	}

	#stopPolling() {
		if (this.#poll) clearInterval(this.#poll);
		this.#poll = null;
	}

	#watchIdle() {
		for (const ev of ['pointerdown', 'keydown']) {
			addEventListener(ev, () => this.#bumpIdle(), { passive: true });
		}
	}

	#bumpIdle() {
		if (this.via !== 'lan') return;
		if (this.#idle) clearTimeout(this.#idle);
		this.#idle = setTimeout(() => {
			if (this.me) void this.logout();
		}, TABLET_IDLE_MS);
	}
}

export const app = new AppState();

export const PALETTE = [
	'#e11d48',
	'#ea580c',
	'#d97706',
	'#16a34a',
	'#0d9488',
	'#2563eb',
	'#7c3aed',
	'#db2777'
];
