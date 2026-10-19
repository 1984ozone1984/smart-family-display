import type { MItem, MPlanEntry, MRecipe } from '../src/mealie/client.ts';

/**
 * In-Memory-Nachbau der benötigten Mealie-Endpunkte als `fetch`, damit Client, Service und
 * Routen gemeinsam getestet werden. Anzeige wie in Mealie: ohne Menge nur die Notiz.
 */
export function fakeMealie(token = 'tok') {
	const lists: { id: string; name: string }[] = [];
	const items = new Map<string, MItem>();
	const recipes: MRecipe[] = [];
	const plans: MPlanEntry[] = [];
	const added: { listId: string; body: unknown }[] = [];
	let down = false;
	let seq = 0;
	const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
	const display = (i: MItem) =>
		i.display || [i.quantity ? String(i.quantity) : '', i.note ?? ''].filter(Boolean).join(' ');
	const json = (body: unknown, status = 200) =>
		new Response(JSON.stringify(body), {
			status,
			headers: { 'content-type': 'application/json' }
		});
	const notFound = () => json({ detail: 'not found' }, 404);

	const fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
		if (down) throw new TypeError('fetch failed');
		const url = new URL(String(input));
		const method = init.method ?? 'GET';
		const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
		if (new Headers(init.headers).get('authorization') !== `Bearer ${token}`)
			return json({ detail: 'unauthorized' }, 401);
		const p = url.pathname;
		let m: RegExpMatchArray | null;

		if (p === '/api/households/mealplans' && method === 'GET') {
			const s = url.searchParams.get('start_date') ?? '';
			const e = url.searchParams.get('end_date') ?? '9999';
			return json({ items: plans.filter((x) => x.date >= s && x.date <= e) });
		}
		if ((m = p.match(/^\/api\/recipes\/([^/]+)$/))) {
			const r = recipes.find((x) => x.slug === decodeURIComponent(m![1]!));
			return r ? json(r) : notFound();
		}
		if ((m = p.match(/^\/api\/media\/recipes\/([^/]+)\/images\/min-original\.webp$/))) {
			return recipes.some((x) => x.id === m![1] && x.image)
				? new Response('IMG', { headers: { 'content-type': 'image/webp' } })
				: notFound();
		}
		if (p === '/api/households/shopping/lists' && method === 'GET') return json({ items: lists });
		if (p === '/api/households/shopping/lists' && method === 'POST') {
			const l = { id: uuid(), name: String(body!.name) };
			lists.push(l);
			return json(l, 201);
		}
		if ((m = p.match(/^\/api\/households\/shopping\/lists\/([^/]+)\/recipe$/))) {
			added.push({ listId: m[1]!, body });
			return json({});
		}
		if ((m = p.match(/^\/api\/households\/shopping\/lists\/([^/]+)$/))) {
			if (!lists.some((l) => l.id === m![1])) return notFound();
			const listItems = [...items.values()]
				.filter((i) => i.shoppingListId === m![1])
				.map((i) => ({ ...i, display: display(i) }));
			return json({ id: m[1], listItems });
		}
		if (p === '/api/households/shopping/items' && method === 'POST') {
			const i = { ...(body as MItem), id: uuid() };
			items.set(i.id, i);
			return json({ createdItems: [i] }, 201);
		}
		if (p === '/api/households/shopping/items' && method === 'DELETE') {
			for (const id of url.searchParams.getAll('ids')) items.delete(id);
			return json({ message: 'ok' });
		}
		if ((m = p.match(/^\/api\/households\/shopping\/items\/([^/]+)$/))) {
			const cur = items.get(m[1]!);
			if (!cur) return notFound();
			if (method === 'GET') return json({ ...cur, display: display(cur) });
			if (method === 'PUT') {
				items.set(cur.id, { ...(body as MItem), id: cur.id });
				return json({ updatedItems: [] });
			}
		}
		return notFound();
	};

	return {
		fetch: fetch as typeof globalThis.fetch,
		lists,
		items,
		recipes,
		plans,
		added,
		setDown: (v: boolean) => (down = v),
		/** Eintrag wie direkt in Mealie angelegt */
		addItem(listId: string, note: string, extra: Partial<MItem> = {}) {
			const i: MItem = {
				id: uuid(),
				shoppingListId: listId,
				checked: false,
				position: items.size,
				quantity: 0,
				note,
				...extra
			};
			items.set(i.id, i);
			return i;
		},
		uuid
	};
}
