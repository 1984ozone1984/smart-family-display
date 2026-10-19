import type { EventBus } from '../events/bus.ts';
import { addDays, todayIn, weekStart } from '../time.ts';
import {
	MealieError,
	type MealieApi,
	type MItem,
	type MPlanEntry,
	type MRecipe,
	type MRecipeRef
} from './client.ts';

/**
 * Essensplan, Rezepte und Einkaufsliste kommen ausschließlich aus Mealie (nichts wird in SQLite
 * gespeichert). Änderungen über die App senden sofort ein Event; Änderungen direkt in Mealie
 * erkennt `poll()` und meldet sie ebenfalls.
 */

const DEFAULT_LIST = 'Einkaufsliste';

export type ShoppingItem = { id: string; text: string; done: boolean };
export type MealEntry = {
	id: number;
	date: string;
	type: string;
	title: string;
	text: string;
	recipe: { id: string; slug: string; name: string; image: boolean } | null;
};

export function shoppingDto(items: MItem[]): ShoppingItem[] {
	// Offene zuerst (Reihenfolge wie in Mealie), abgehakte unten
	return [...items]
		.sort((a, b) => Number(a.checked) - Number(b.checked) || a.position - b.position)
		.map((i) => ({
			id: i.id,
			text: (i.display || i.note || '').trim(),
			done: i.checked
		}));
}

export function mealDto(e: MPlanEntry): MealEntry {
	return {
		id: e.id,
		date: e.date,
		type: e.entryType,
		title: e.recipe?.name || e.title,
		text: e.text,
		recipe: e.recipe
			? { id: e.recipe.id, slug: e.recipe.slug, name: e.recipe.name ?? '', image: !!e.recipe.image }
			: null
	};
}

export const recipeRefDto = (r: MRecipeRef) => ({
	id: r.id,
	slug: r.slug,
	name: r.name ?? '',
	image: !!r.image
});

export function recipeDto(r: MRecipe) {
	return {
		id: r.id,
		slug: r.slug,
		name: r.name ?? '',
		description: r.description ?? '',
		image: !!r.image,
		yield: r.recipeYield ?? '',
		totalTime: r.totalTime ?? '',
		prepTime: r.prepTime ?? '',
		ingredients: (r.recipeIngredient ?? []).map((i) => ({
			section: i.title || null,
			text: (i.display || i.note || i.originalText || '').trim()
		})),
		steps: (r.recipeInstructions ?? []).map((s) => ({
			section: s.title || null,
			text: s.text
		}))
	};
}

export function createMealieService(o: {
	api: MealieApi;
	bus: EventBus;
	tz: string;
	/** Name der Einkaufsliste in Mealie; ohne Angabe die älteste vorhandene */
	listName?: string;
	/** Adresse der Mealie-Oberfläche im LAN, für Links (nur am Tablet/im LAN angezeigt) */
	lanUrl?: string;
}) {
	const { api, bus } = o;
	let listId: string | null = null;
	let lastShopping = '';
	let lastMeals = '';
	let groupSlug: string | null = null;

	async function shoppingListId(): Promise<string> {
		if (listId) return listId;
		const lists = await api.shoppingLists();
		const wanted = o.listName?.trim().toLowerCase();
		const found = wanted ? lists.find((l) => l.name?.trim().toLowerCase() === wanted) : lists[0];
		listId = (found ?? (await api.createShoppingList(o.listName?.trim() || DEFAULT_LIST))).id;
		return listId;
	}

	async function items(): Promise<MItem[]> {
		try {
			return await api.shoppingItems(await shoppingListId());
		} catch (err) {
			// Liste in Mealie gelöscht: beim nächsten Mal neu suchen
			if (err instanceof MealieError && err.status === 404) listId = null;
			throw err;
		}
	}

	async function shopping(): Promise<ShoppingItem[]> {
		const list = shoppingDto(await items());
		lastShopping = JSON.stringify(list);
		return list;
	}

	async function week(date: string) {
		const start = weekStart(date);
		const entries = (await api.mealplans(start, addDays(start, 6))).map(mealDto);
		return { start, entries };
	}

	const mealsChanged = () => {
		lastMeals = '';
		bus.publish({ type: 'meals.changed' });
	};

	const shoppingChanged = () => {
		lastShopping = '';
		bus.publish({ type: 'shopping.changed' });
	};

	return {
		shopping,
		week,
		recipe: async (slug: string) => recipeDto(await api.recipe(slug)),
		search: async (query: string) => (await api.searchRecipes(query, 24)).map(recipeRefDto),

		/** Links in die Mealie-Oberfläche; null, wenn keine LAN-Adresse eingestellt ist */
		async links() {
			const base = o.lanUrl?.replace(/\/+$/, '');
			if (!base) return null;
			groupSlug ??= await api.groupSlug().catch(() => null);
			return {
				planner: `${base}/household/mealplan/planner/view`,
				recipe: groupSlug ? `${base}/g/${encodeURIComponent(groupSlug)}/r/` : null
			};
		},

		/**
		 * Mahlzeit planen (Rezept, Zufall oder nur Text). Mit `replace` wird der alte Eintrag erst
		 * entfernt, wenn der neue steht – so geht bei einem Fehler nichts verloren.
		 */
		async plan(p: {
			date: string;
			type: string;
			recipeId?: string;
			title?: string;
			random?: boolean;
			replace?: number;
		}) {
			const e = p.random
				? await api.randomMealplan(p.date, p.type)
				: await api.createMealplan({
						date: p.date,
						entryType: p.type,
						...(p.recipeId ? { recipeId: p.recipeId } : { title: p.title ?? '' })
					});
			if (p.replace !== undefined) await api.deleteMealplan(p.replace).catch(() => {});
			mealsChanged();
			return mealDto(e);
		},

		async unplan(id: number) {
			await api.deleteMealplan(id);
			mealsChanged();
		},
		image: (recipeId: string) => api.image(recipeId),

		async addItem(text: string) {
			const all = await items();
			const last = Math.max(-1, ...all.map((i) => i.position));
			await api.createItem(await shoppingListId(), text, last + 1);
			shoppingChanged();
		},

		async updateItem(id: string, patch: { text?: string; done?: boolean }) {
			const item = await api.getItem(id);
			if (item.shoppingListId !== (await shoppingListId())) throw new MealieError(404, 'item');
			const next: MItem = { ...item };
			if (patch.done !== undefined) next.checked = patch.done;
			if (patch.text !== undefined) {
				// Freitext ersetzt Menge/Einheit/Lebensmittel, sonst bliebe die alte Anzeige stehen
				Object.assign(next, { note: patch.text, quantity: 0, foodId: null, unitId: null });
				delete next.food;
				delete next.unit;
			}
			await api.updateItem(next);
			shoppingChanged();
		},

		async deleteItem(id: string) {
			const all = await items();
			if (!all.some((i) => i.id === id)) throw new MealieError(404, 'item');
			await api.deleteItems([id]);
			shoppingChanged();
		},

		async clearDone() {
			const done = (await items()).filter((i) => i.checked).map((i) => i.id);
			await api.deleteItems(done);
			shoppingChanged();
			return done.length;
		},

		/** Zutaten aller Rezepte der Woche auf die Einkaufsliste; Anzahl der Rezepte */
		async addWeekToShopping(date: string): Promise<number> {
			const { entries } = await week(date);
			const times = new Map<string, number>();
			for (const e of entries) {
				if (e.recipe) times.set(e.recipe.id, (times.get(e.recipe.id) ?? 0) + 1);
			}
			await api.addRecipes(
				await shoppingListId(),
				[...times].map(([recipeId, n]) => ({ recipeId, times: n }))
			);
			if (times.size) shoppingChanged();
			return times.size;
		},

		/** Änderungen direkt in Mealie erkennen (diese und nächste Woche, Einkaufsliste). */
		async poll() {
			const list = JSON.stringify(shoppingDto(await items()));
			if (lastShopping && list !== lastShopping) bus.publish({ type: 'shopping.changed' });
			lastShopping = list;

			const start = weekStart(todayIn(o.tz));
			const meals = JSON.stringify((await api.mealplans(start, addDays(start, 13))).map(mealDto));
			if (lastMeals && meals !== lastMeals) bus.publish({ type: 'meals.changed' });
			lastMeals = meals;
		}
	};
}

export type MealieService = ReturnType<typeof createMealieService>;
