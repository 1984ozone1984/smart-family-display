import { describe, expect, it } from 'vitest';
import { createMealieApi } from '../src/mealie/client.ts';
import { fakeMealie } from './fake-mealie.ts';
import { LAN_IP, makeApp, PUBLIC_HOST, TUNNEL_IP } from './helpers.ts';

const lan = { remoteAddress: LAN_IP };

async function world() {
	const fake = fakeMealie();
	const api = createMealieApi({ url: 'http://mealie.test:9000', token: 'tok' }, fake.fetch);
	const { app, bus, sign } = await makeApp({ mealie: api });
	await app.inject({
		method: 'POST',
		url: '/api/v1/setup',
		...lan,
		payload: { name: 'Mama', color: '#e11d48', pin: '1111' }
	});

	const events: string[] = [];
	const publish = bus.publish;
	bus.publish = (e) => {
		events.push(e.type);
		publish(e);
	};
	const req = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
		app.inject({ method, url: `/api/v1${url}`, ...lan, ...(payload ? { payload } : {}) });
	const shopping = async () =>
		(await req('GET', '/shopping')).json().items as { id: string; text: string; done: boolean }[];
	return { app, fake, events, req, shopping, sign };
}

describe('Mealie: Einkaufsliste', () => {
	it('ohne Token deaktiviert (503)', async () => {
		const { app } = await makeApp();
		const r = await app.inject({ url: '/api/v1/shopping', ...lan });
		expect(r.statusCode).toBe(503);
	});

	it('legt die Liste an, wenn es keine gibt; Tablet ohne PIN: hinzufügen, abhaken, ändern, Erledigte entfernen', async () => {
		const w = await world();
		expect(await w.shopping()).toEqual([]);
		expect(w.fake.lists.map((l) => l.name)).toEqual(['Einkaufsliste']);

		expect((await w.req('POST', '/shopping/items', { text: 'Brot' })).statusCode).toBe(201);
		await w.req('POST', '/shopping/items', { text: 'Butter' });
		const [brot, butter] = await w.shopping();
		expect([brot?.text, butter?.text]).toEqual(['Brot', 'Butter']);

		expect((await w.req('PATCH', `/shopping/items/${brot!.id}`, { done: true })).statusCode).toBe(
			204
		);
		// Abgehakte stehen unten
		expect((await w.shopping()).map((i) => [i.text, i.done])).toEqual([
			['Butter', false],
			['Brot', true]
		]);

		await w.req('PATCH', `/shopping/items/${butter!.id}`, { text: 'Kräuterbutter' });
		expect((await w.shopping())[0]?.text).toBe('Kräuterbutter');

		expect((await w.req('POST', '/shopping/clear-done')).json()).toEqual({ removed: 1 });
		expect((await w.shopping()).map((i) => i.text)).toEqual(['Kräuterbutter']);
		expect(w.events.filter((e) => e === 'shopping.changed')).toHaveLength(5);
	});

	it('Text ändern ersetzt Menge/Lebensmittel, damit Mealie die Anzeige neu berechnet', async () => {
		const w = await world();
		await w.shopping();
		const list = w.fake.lists[0]!.id;
		const milk = w.fake.addItem(list, 'Milch', {
			quantity: 2,
			food: { name: 'Milch' },
			foodId: w.fake.uuid()
		});
		expect((await w.shopping())[0]?.text).toBe('2 Milch');

		await w.req('PATCH', `/shopping/items/${milk.id}`, { text: 'Hafermilch' });
		const stored = w.fake.items.get(milk.id)!;
		expect([stored.note, stored.quantity, stored.foodId, stored.food, stored.display]).toEqual([
			'Hafermilch',
			0,
			null,
			undefined,
			''
		]);
		expect((await w.shopping())[0]?.text).toBe('Hafermilch');
	});

	it('Einträge anderer Mealie-Listen sind tabu (404)', async () => {
		const w = await world();
		await w.shopping();
		w.fake.lists.push({ id: w.fake.uuid(), name: 'Baumarkt' });
		const other = w.fake.addItem(w.fake.lists[1]!.id, 'Schrauben');
		expect((await w.req('PATCH', `/shopping/items/${other.id}`, { done: true })).statusCode).toBe(
			404
		);
		expect((await w.req('DELETE', `/shopping/items/${other.id}`)).statusCode).toBe(404);
		expect(w.fake.items.get(other.id)?.checked).toBe(false);
	});

	it('Änderungen direkt in Mealie meldet poll() per Event', async () => {
		const w = await world();
		const mealie = w.app.mealie!;
		await mealie.poll();
		expect(w.events).toEqual([]);
		w.fake.addItem(w.fake.lists[0]!.id, 'Äpfel');
		await mealie.poll();
		expect(w.events).toEqual(['shopping.changed']);
		await mealie.poll();
		expect(w.events).toEqual(['shopping.changed']);
	});

	it('Mealie nicht erreichbar: 502; öffentlich ohne Anmeldung: 401', async () => {
		const w = await world();
		w.fake.setDown(true);
		expect((await w.req('GET', '/shopping')).statusCode).toBe(502);
		const r = await w.app.inject({
			url: '/api/v1/shopping',
			remoteAddress: TUNNEL_IP,
			headers: { host: PUBLIC_HOST, 'cf-access-jwt-assertion': await w.sign() }
		});
		expect(r.statusCode).toBe(401);
	});
});

describe('Mealie: Essensplan und Rezepte', () => {
	async function withPlan() {
		const w = await world();
		const nudeln = w.fake.uuid();
		const suppe = w.fake.uuid();
		w.fake.recipes.push(
			{
				id: nudeln,
				slug: 'nudeln',
				name: 'Nudeln',
				image: 'abc',
				recipeYield: '4 Portionen',
				recipeIngredient: [
					{ title: 'Soße', display: '400 g Tomaten' },
					{ note: 'Salz', display: '' }
				],
				recipeInstructions: [{ title: '', text: 'Kochen.' }]
			},
			{ id: suppe, slug: 'suppe', name: 'Suppe' }
		);
		const entry = (id: number, date: string, entryType: string, recipe: string | null) => {
			const r = w.fake.recipes.find((x) => x.id === recipe) ?? null;
			return { id, date, entryType, title: '', text: '', recipeId: recipe, recipe: r };
		};
		w.fake.plans.push(
			entry(1, '2026-10-19', 'lunch', nudeln),
			entry(2, '2026-10-21', 'dinner', suppe),
			entry(3, '2026-10-22', 'dinner', nudeln),
			{ ...entry(4, '2026-10-23', 'dinner', null), title: 'Essen gehen' },
			entry(5, '2026-10-26', 'lunch', suppe)
		);
		return { ...w, nudeln, suppe };
	}

	it('Woche ab Montag, egal welcher Tag angefragt wird', async () => {
		const w = await withPlan();
		const r = (await w.req('GET', '/meals?week=2026-10-22')).json();
		expect(r.start).toBe('2026-10-19');
		expect(
			(r.entries as { date: string; type: string; title: string }[]).map((e) => [
				e.date,
				e.type,
				e.title
			])
		).toEqual([
			['2026-10-19', 'lunch', 'Nudeln'],
			['2026-10-21', 'dinner', 'Suppe'],
			['2026-10-22', 'dinner', 'Nudeln'],
			['2026-10-23', 'dinner', 'Essen gehen']
		]);
		expect(r.entries[0].recipe).toEqual({
			id: w.nudeln,
			slug: 'nudeln',
			name: 'Nudeln',
			image: true
		});
	});

	it('Zutaten der Woche: jedes Rezept einmal, mehrfach geplante mit Anzahl', async () => {
		const w = await withPlan();
		const r = await w.req('POST', '/meals/shopping', { week: '2026-10-20' });
		expect(r.json()).toEqual({ recipes: 2 });
		await w.shopping();
		expect(w.fake.added).toEqual([
			{
				listId: w.fake.lists[0]!.id,
				body: [
					{ recipeId: w.nudeln, recipeIncrementQuantity: 2 },
					{ recipeId: w.suppe, recipeIncrementQuantity: 1 }
				]
			}
		]);
		expect(w.events).toContain('shopping.changed');
	});

	it('Rezept mit Zutaten und Schritten, Bild über den Proxy', async () => {
		const w = await withPlan();
		const r = (await w.req('GET', '/recipes/nudeln')).json().recipe;
		expect(r).toMatchObject({
			name: 'Nudeln',
			image: true,
			yield: '4 Portionen',
			ingredients: [
				{ section: 'Soße', text: '400 g Tomaten' },
				{ section: null, text: 'Salz' }
			],
			steps: [{ section: null, text: 'Kochen.' }]
		});
		const img = await w.req('GET', `/recipes/${w.nudeln}/image`);
		expect([img.statusCode, img.headers['content-type'], img.body]).toEqual([
			200,
			'image/webp',
			'IMG'
		]);
		expect((await w.req('GET', `/recipes/${w.suppe}/image`)).statusCode).toBe(404);
		expect((await w.req('GET', '/recipes/gibts-nicht')).statusCode).toBe(404);
	});
});
