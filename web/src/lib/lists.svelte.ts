import { api, type FamilyList, type ListItem } from './api.ts';
import { app } from './app.svelte.ts';

class ListState {
	lists = $state<FamilyList[]>([]);
	notice = $state('');
	#started = false;

	start() {
		if (this.#started) return;
		this.#started = true;
		app.on('lists.changed', () => void this.load());
		void this.load();
	}

	async load() {
		this.lists = (await api<{ lists: FamilyList[] }>('/lists')).lists;
	}

	/** Führt eine Änderung aus und lädt neu; bei Fehler kurze Meldung statt Ausnahme. */
	async #run(fn: () => Promise<unknown>) {
		try {
			await fn();
		} catch {
			this.notice = 'Das hat nicht geklappt.';
			setTimeout(() => (this.notice = ''), 4000);
		}
		await this.load().catch(() => {});
	}

	add(listId: number, text: string) {
		return this.#run(() => api(`/lists/${listId}/items`, { method: 'POST', json: { text } }));
	}

	/** Abhaken sofort anzeigen, damit es am Tablet nicht hakt */
	toggle(listId: number, item: ListItem) {
		item.done = !item.done;
		return this.#run(() =>
			api(`/lists/${listId}/items/${item.id}`, { method: 'PATCH', json: { done: item.done } })
		);
	}

	edit(listId: number, itemId: number, text: string) {
		return this.#run(() =>
			api(`/lists/${listId}/items/${itemId}`, { method: 'PATCH', json: { text } })
		);
	}

	move(listId: number, itemId: number, position: number) {
		return this.#run(() =>
			api(`/lists/${listId}/items/${itemId}`, { method: 'PATCH', json: { position } })
		);
	}

	remove(listId: number, itemId: number) {
		return this.#run(() => api(`/lists/${listId}/items/${itemId}`, { method: 'DELETE' }));
	}

	clearDone(listId: number) {
		return this.#run(() => api(`/lists/${listId}/clear-done`, { method: 'POST' }));
	}

	moveList(listId: number, position: number) {
		return this.#run(() => api(`/lists/${listId}`, { method: 'PATCH', json: { position } }));
	}
}

export const lists = new ListState();
