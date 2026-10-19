import {
	api,
	ApiError,
	type Approval,
	type PlannedTask,
	type Redemption,
	type Reward,
	type Routine,
	type Task
} from './api.ts';
import { app } from './app.svelte.ts';

class TaskState {
	tasks = $state<Task[]>([]);
	today = $state('');
	/** Anderer Tag in der Heute-Ansicht (YYYY-MM-DD), null = heute */
	day = $state<string | null>(null);
	dayTasks = $state<Task[]>([]);
	approvals = $state<Approval[]>([]);
	routines = $state<Routine[]>([]);
	balances = $state<Record<number, number>>({});
	rewards = $state<Reward[]>([]);
	requests = $state<Redemption[]>([]);
	/** Wartet auf PIN der Person, bevor abgehakt wird (Tablet) */
	pendingLogin = $state<{ task: Task; personId: number } | null>(null);
	notice = $state('');
	/** Auf diesem Gerät schon weggeklickte Fälligkeits-Hinweise (Aufgaben-IDs, nur für `today`) */
	seenDue = $state<number[]>([]);
	#started = false;
	#checkedDay = '';
	#noticeTimer: ReturnType<typeof setTimeout> | null = null;

	start() {
		if (this.#started) return;
		this.#started = true;
		app.on('tasks.changed', () => void this.loadTasks());
		app.on('points.changed', () => void this.loadBalances());
		app.on('rewards.changed', () => void this.loadRewards());
		void Promise.all([this.loadTasks(), this.loadBalances(), this.loadRewards()]);
	}

	async loadTasks() {
		const [t, a] = await Promise.all([
			api<{ tasks: Task[]; today: string }>('/tasks'),
			api<{ approvals: Approval[] }>('/tasks/approvals')
		]);
		this.tasks = t.tasks;
		this.today = t.today;
		this.#checkedDay = t.today;
		this.seenDue = readSeen(t.today);
		this.approvals = a.approvals;
		if (this.day) await this.#loadDay(this.day);
	}

	/** Aufgaben eines Tages für die Heute-Ansicht laden (heute: die normale Liste). */
	async showDay(date: string | null) {
		this.day = date === this.today ? null : date;
		if (this.day) await this.#loadDay(this.day);
	}

	async #loadDay(date: string) {
		const r = await api<{ tasks: Task[]; planned: PlannedTask[] }>(`/tasks?date=${date}`);
		if (this.day !== date) return;
		const planned = r.planned.map((p): Task => ({
			id: -p.routineId,
			title: p.title,
			icon: p.icon,
			dueDate: p.dueDate,
			availableFrom: null,
			timeSlot: p.timeSlot,
			points: p.points,
			requiresApproval: p.requiresApproval,
			routineId: p.routineId,
			overdue: false,
			dueToday: false,
			assignees: p.assignees.map((personId) => ({ personId, status: 'open', doneAt: null })),
			plannedFor: date
		}));
		const order = { morning: 1, afternoon: 2, evening: 3 };
		this.dayTasks = [...r.tasks, ...planned].sort(
			(a, b) => (a.timeSlot ? order[a.timeSlot] : 4) - (b.timeSlot ? order[b.timeSlot] : 4)
		);
	}

	/** Tablet läuft durch: nach Mitternacht einmal neu laden, damit „heute“ stimmt. */
	dayChanged(localToday: string) {
		if (!this.#checkedDay || localToday === this.#checkedDay) return;
		this.#checkedDay = localToday;
		void this.loadTasks();
	}

	/**
	 * Heute fällige einmalige Aufgaben, die noch jemand erledigen muss. Am Tablet (LAN) alle,
	 * sonst nur die der angemeldeten Person. Weggeklickte erscheinen auf dem Gerät nicht wieder.
	 */
	get dueNotice(): Task[] {
		const me = app.me;
		return this.tasks.filter(
			(t) =>
				t.dueToday &&
				!this.seenDue.includes(t.id) &&
				t.assignees.some((a) => a.status === 'open' && (app.via === 'lan' || a.personId === me?.id))
		);
	}

	dismissDue() {
		this.seenDue = [...this.seenDue, ...this.dueNotice.map((t) => t.id)];
		try {
			localStorage.setItem(SEEN_KEY, JSON.stringify({ day: this.today, ids: this.seenDue }));
		} catch {
			// ohne Speicher erscheint der Hinweis nach dem Neuladen eben noch einmal
		}
	}

	async loadRoutines() {
		this.routines = (await api<{ routines: Routine[] }>('/routines')).routines;
	}

	async loadBalances() {
		const { balances } = await api<{ balances: { personId: number; balance: number }[] }>(
			'/points'
		);
		this.balances = Object.fromEntries(balances.map((b) => [b.personId, b.balance]));
	}

	async loadRewards() {
		const [r, q] = await Promise.all([
			api<{ rewards: Reward[] }>('/rewards'),
			api<{ redemptions: Redemption[] }>('/redemptions?status=requested')
		]);
		this.rewards = r.rewards;
		this.requests = q.redemptions;
	}

	/** `day`: Aufgaben des in der Heute-Ansicht gewählten Tages statt der heutigen */
	forPerson(personId: number, day = false): Task[] {
		const list = day && this.day ? this.dayTasks : this.tasks;
		return list.filter((t) => t.assignees.some((a) => a.personId === personId));
	}

	status(t: Task, personId: number) {
		return t.assignees.find((a) => a.personId === personId)?.status ?? 'open';
	}

	progress(personId: number, day = false): { done: number; total: number } {
		const mine = this.forPerson(personId, day);
		return {
			done: mine.filter((t) => this.status(t, personId) !== 'open').length,
			total: mine.length
		};
	}

	/**
	 * Antippen einer Aufgabe: Ist die Person selbst (oder ein Elternteil) angemeldet, sofort
	 * umschalten; sonst zuerst die PIN dieser Person abfragen (siehe Layout).
	 */
	tap(t: Task, personId: number) {
		const me = app.me;
		if (me && (me.id === personId || me.role === 'parent')) void this.#run(t, personId);
		else this.pendingLogin = { task: t, personId };
	}

	/** Nach erfolgreicher PIN-Eingabe */
	resumeAfterLogin() {
		const p = this.pendingLogin;
		this.pendingLogin = null;
		if (p) void this.#run(p.task, p.personId);
	}

	async #run(t: Task, personId: number) {
		const msg = await this.toggle(t, personId);
		if (this.#noticeTimer) clearTimeout(this.#noticeTimer);
		this.notice = msg ?? '';
		if (msg) this.#noticeTimer = setTimeout(() => (this.notice = ''), 4000);
	}

	/** Abhaken bzw. zurücknehmen. Liefert eine Meldung, wenn es nicht ging. */
	async toggle(t: Task, personId: number): Promise<string | null> {
		const done = this.status(t, personId) === 'open';
		try {
			if (t.plannedFor)
				await api(`/routines/${t.routineId}/done`, {
					method: 'POST',
					json: { personId, date: t.plannedFor }
				});
			else await api(`/tasks/${t.id}/done`, { method: 'POST', json: { personId, done } });
			await this.loadTasks();
			return null;
		} catch (err) {
			if (err instanceof ApiError && err.body.error === 'approved')
				return 'Schon bestätigt – zurücknehmen können nur Eltern.';
			if (err instanceof ApiError && err.body.error === 'too early')
				return 'So weit im Voraus geht Abhaken noch nicht (höchstens 7 Tage).';
			if (err instanceof ApiError && err.body.error === 'expired')
				return 'Diese Aufgabe ist abgelaufen.';
			if (err instanceof ApiError && (err.status === 403 || err.status === 401))
				return 'Abhaken darf nur die Person selbst.';
			return 'Das hat nicht geklappt.';
		}
	}
}

const SEEN_KEY = 'due-seen';

function readSeen(day: string): number[] {
	try {
		const v = JSON.parse(localStorage.getItem(SEEN_KEY) ?? 'null') as {
			day: string;
			ids: number[];
		} | null;
		return v?.day === day ? v.ids : [];
	} catch {
		return [];
	}
}

export const tasks = new TaskState();
