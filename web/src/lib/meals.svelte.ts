import { api, ApiError, type MealEntry, type Recipe, type ShoppingItem } from './api.ts';
import { app } from './app.svelte.ts';

/** off = Mealie nicht eingerichtet, error = gerade nicht erreichbar */
export type MealieStatus = 'loading' | 'ok' | 'off' | 'error';

const status = (err: unknown): MealieStatus =>
	err instanceof ApiError && err.status === 503 ? 'off' : 'error';

class MealState {
	shopping = $state<ShoppingItem[]>([]);
	shoppingStatus = $state<MealieStatus>('loading');
	/** Montag der angezeigten Woche (YYYY-MM-DD), null = aktuelle Woche */
	week = $state<string | null>(null);
	weekStart = $state('');
	today = $state('');
	entries = $state<MealEntry[]>([]);
	mealsStatus = $state<MealieStatus>('loading');
	notice = $state('');
	#started = false;
	#noticeTimer: ReturnType<typeof setTimeout> | null = null;

	start() {
		if (this.#started) return;
		this.#started = true;
		app.on('shopping.changed', () => void this.loadShopping());
		app.on('meals.changed', () => void this.loadWeek());
		void this.loadShopping();
	}

	async loadShopping() {
		try {
			this.shopping = (await api<{ items: ShoppingItem[] }>('/shopping')).items;
			this.shoppingStatus = 'ok';
		} catch (err) {
			this.shoppingStatus = status(err);
		}
	}

	async showWeek(week: string | null) {
		this.week = week;
		await this.loadWeek();
	}

	async loadWeek() {
		const week = this.week;
		try {
			const r = await api<{ start: string; today: string; entries: MealEntry[] }>(
				`/meals${week ? `?week=${week}` : ''}`
			);
			if (this.week !== week) return;
			this.weekStart = r.start;
			this.today = r.today;
			this.entries = r.entries;
			this.mealsStatus = 'ok';
		} catch (err) {
			this.mealsStatus = status(err);
		}
	}

	recipe(slug: string) {
		return api<{ recipe: Recipe }>(`/recipes/${encodeURIComponent(slug)}`).then((r) => r.recipe);
	}

	#say(msg: string) {
		if (this.#noticeTimer) clearTimeout(this.#noticeTimer);
		this.notice = msg;
		this.#noticeTimer = setTimeout(() => (this.notice = ''), 4000);
	}

	/** Führt eine Änderung aus und lädt neu; bei Fehler kurze Meldung statt Ausnahme. */
	async #run(fn: () => Promise<unknown>) {
		try {
			await fn();
		} catch {
			this.#say('Das hat nicht geklappt.');
		}
		await this.loadShopping();
	}

	add(text: string) {
		return this.#run(() => api('/shopping/items', { method: 'POST', json: { text } }));
	}

	/** Abhaken sofort anzeigen, damit es am Tablet nicht hakt */
	toggle(item: ShoppingItem) {
		item.done = !item.done;
		return this.#run(() =>
			api(`/shopping/items/${item.id}`, { method: 'PATCH', json: { done: item.done } })
		);
	}

	edit(id: string, text: string) {
		return this.#run(() => api(`/shopping/items/${id}`, { method: 'PATCH', json: { text } }));
	}

	remove(id: string) {
		return this.#run(() => api(`/shopping/items/${id}`, { method: 'DELETE' }));
	}

	clearDone() {
		return this.#run(() => api('/shopping/clear-done', { method: 'POST' }));
	}

	/** Zutaten aller Rezepte der angezeigten Woche auf die Einkaufsliste */
	async addWeekToShopping() {
		try {
			const { recipes } = await api<{ recipes: number }>('/meals/shopping', {
				method: 'POST',
				json: { week: this.weekStart }
			});
			this.#say(
				recipes
					? `Zutaten von ${recipes} ${recipes === 1 ? 'Rezept' : 'Rezepten'} stehen auf der Einkaufsliste.`
					: 'In dieser Woche sind keine Rezepte geplant.'
			);
		} catch {
			this.#say('Das hat nicht geklappt.');
		}
	}
}

export const meals = new MealState();
