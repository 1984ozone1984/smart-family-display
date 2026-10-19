/** Fehler beim Aufruf der Mealie-API; status 0 = nicht erreichbar/Timeout. */
export class MealieError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(`Mealie ${status}: ${message}`);
		this.status = status;
	}
}

// Nur die Felder, die wir lesen (Mealie liefert camelCase)
export type MRecipeRef = { id: string; slug: string; name: string | null; image?: unknown };
export type MPlanEntry = {
	id: number;
	date: string;
	entryType: string;
	title: string;
	text: string;
	recipeId: string | null;
	recipe: MRecipeRef | null;
};
export type MIngredient = {
	title?: string | null;
	note?: string | null;
	display?: string;
	originalText?: string | null;
};
export type MStep = { title?: string | null; summary?: string | null; text: string };
export type MRecipe = MRecipeRef & {
	description?: string | null;
	recipeYield?: string | null;
	totalTime?: string | null;
	prepTime?: string | null;
	recipeIngredient?: MIngredient[];
	recipeInstructions?: MStep[] | null;
};
/** Eintrag der Einkaufsliste; beim Ändern wird das ganze Objekt zurückgeschickt. */
export type MItem = {
	id: string;
	shoppingListId: string;
	checked: boolean;
	position: number;
	quantity?: number | null;
	note?: string | null;
	display?: string;
	[key: string]: unknown;
};
export type MList = { id: string; name: string | null };
export type MPlanInput = { date: string; entryType: string; recipeId?: string; title?: string };

export interface MealieApi {
	mealplans(start: string, end: string): Promise<MPlanEntry[]>;
	recipe(slug: string): Promise<MRecipe>;
	searchRecipes(query: string, limit: number): Promise<MRecipeRef[]>;
	createMealplan(entry: MPlanInput): Promise<MPlanEntry>;
	/** Zufälliges Rezept nach den Essensplan-Regeln des Haushalts; 404, wenn keins passt */
	randomMealplan(date: string, entryType: string): Promise<MPlanEntry>;
	deleteMealplan(id: number): Promise<void>;
	/** Slug der Gruppe des Token-Benutzers (für Links in die Mealie-Oberfläche) */
	groupSlug(): Promise<string>;
	/** Rezeptbild (klein); liefert die Antwort zum Durchreichen */
	image(recipeId: string): Promise<Response>;
	shoppingLists(): Promise<MList[]>;
	createShoppingList(name: string): Promise<MList>;
	shoppingItems(listId: string): Promise<MItem[]>;
	getItem(id: string): Promise<MItem>;
	createItem(listId: string, note: string, position: number): Promise<void>;
	updateItem(item: MItem): Promise<void>;
	deleteItems(ids: string[]): Promise<void>;
	/** Zutaten der Rezepte auf die Liste setzen (Mealie fasst gleiche Zutaten zusammen) */
	addRecipes(listId: string, recipes: { recipeId: string; times: number }[]): Promise<void>;
}

const TIMEOUT_MS = 8_000;
const ALL = 'page=1&perPage=-1&per_page=-1';

export function createMealieApi(
	opts: { url: string; token: string },
	f: typeof fetch = fetch
): MealieApi {
	const base = opts.url.replace(/\/+$/, '');

	async function call(path: string, init: RequestInit = {}): Promise<Response> {
		const headers = new Headers(init.headers);
		headers.set('authorization', `Bearer ${opts.token}`);
		if (init.body) headers.set('content-type', 'application/json');
		let res: Response;
		try {
			res = await f(`${base}${path}`, {
				...init,
				headers,
				signal: AbortSignal.timeout(TIMEOUT_MS)
			});
		} catch (err) {
			throw new MealieError(0, err instanceof Error ? err.message : 'unreachable');
		}
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			throw new MealieError(res.status, body.slice(0, 200) || res.statusText);
		}
		return res;
	}
	const json = async <T>(path: string, init?: RequestInit) =>
		(await (await call(path, init)).json()) as T;
	const send = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) });

	return {
		async mealplans(start, end) {
			const r = await json<{ items: MPlanEntry[] }>(
				`/api/households/mealplans?${ALL}&start_date=${start}&end_date=${end}&orderBy=date&orderDirection=asc`
			);
			return r.items;
		},
		recipe: (slug) => json<MRecipe>(`/api/recipes/${encodeURIComponent(slug)}`),
		async searchRecipes(query, limit) {
			const q = new URLSearchParams({
				page: '1',
				perPage: String(limit),
				per_page: String(limit),
				orderBy: 'name',
				orderDirection: 'asc'
			});
			if (query) q.set('search', query);
			return (await json<{ items: MRecipeRef[] }>(`/api/recipes?${q}`)).items;
		},
		createMealplan: (entry) =>
			json<MPlanEntry>(
				'/api/households/mealplans',
				send('POST', { title: '', text: '', recipeId: null, ...entry })
			),
		randomMealplan: (date, entryType) =>
			json<MPlanEntry>('/api/households/mealplans/random', send('POST', { date, entryType })),
		async deleteMealplan(id) {
			await call(`/api/households/mealplans/${id}`, { method: 'DELETE' });
		},
		async groupSlug() {
			return (await json<{ groupSlug: string }>('/api/users/self')).groupSlug;
		},
		image: (id) => call(`/api/media/recipes/${encodeURIComponent(id)}/images/min-original.webp`),
		async shoppingLists() {
			const r = await json<{ items: MList[] }>(
				`/api/households/shopping/lists?${ALL}&orderBy=createdAt&orderDirection=asc`
			);
			return r.items;
		},
		createShoppingList: (name) =>
			json<MList>('/api/households/shopping/lists', send('POST', { name })),
		async shoppingItems(listId) {
			const r = await json<{ listItems: MItem[] }>(
				`/api/households/shopping/lists/${encodeURIComponent(listId)}`
			);
			return r.listItems;
		},
		getItem: (id) => json<MItem>(`/api/households/shopping/items/${encodeURIComponent(id)}`),
		async createItem(listId, note, position) {
			// Menge 0: Mealie zeigt dann nur den Text (sonst „1 Milch“)
			await call(
				'/api/households/shopping/items',
				send('POST', { shoppingListId: listId, note, quantity: 0, checked: false, position })
			);
		},
		async updateItem(item) {
			// display leer lassen, damit Mealie die Anzeige neu berechnet
			await call(
				`/api/households/shopping/items/${encodeURIComponent(item.id)}`,
				send('PUT', { ...item, display: '' })
			);
		},
		async deleteItems(ids) {
			if (!ids.length) return;
			const q = ids.map((id) => `ids=${encodeURIComponent(id)}`).join('&');
			await call(`/api/households/shopping/items?${q}`, { method: 'DELETE' });
		},
		async addRecipes(listId, recipes) {
			if (!recipes.length) return;
			await call(
				`/api/households/shopping/lists/${encodeURIComponent(listId)}/recipe`,
				send(
					'POST',
					recipes.map((r) => ({ recipeId: r.recipeId, recipeIncrementQuantity: r.times }))
				)
			);
		}
	};
}
