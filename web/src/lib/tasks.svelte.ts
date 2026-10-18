import {
	api,
	ApiError,
	type Approval,
	type Redemption,
	type Reward,
	type Routine,
	type Task
} from './api.ts';
import { app } from './app.svelte.ts';

class TaskState {
	tasks = $state<Task[]>([]);
	today = $state('');
	approvals = $state<Approval[]>([]);
	routines = $state<Routine[]>([]);
	balances = $state<Record<number, number>>({});
	rewards = $state<Reward[]>([]);
	requests = $state<Redemption[]>([]);
	/** Wartet auf PIN der Person, bevor abgehakt wird (Tablet) */
	pendingLogin = $state<{ task: Task; personId: number } | null>(null);
	notice = $state('');
	#started = false;
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
		this.approvals = a.approvals;
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

	forPerson(personId: number): Task[] {
		return this.tasks.filter((t) => t.assignees.some((a) => a.personId === personId));
	}

	status(t: Task, personId: number) {
		return t.assignees.find((a) => a.personId === personId)?.status ?? 'open';
	}

	progress(personId: number): { done: number; total: number } {
		const mine = this.forPerson(personId);
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
			await api(`/tasks/${t.id}/done`, { method: 'POST', json: { personId, done } });
			await this.loadTasks();
			return null;
		} catch (err) {
			if (err instanceof ApiError && err.body.error === 'approved')
				return 'Schon bestätigt – zurücknehmen können nur Eltern.';
			if (err instanceof ApiError && err.body.error === 'expired')
				return 'Diese Aufgabe ist abgelaufen.';
			if (err instanceof ApiError && (err.status === 403 || err.status === 401))
				return 'Abhaken darf nur die Person selbst.';
			return 'Das hat nicht geklappt.';
		}
	}
}

export const tasks = new TaskState();
