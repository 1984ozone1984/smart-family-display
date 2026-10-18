import { describe, expect, it } from 'vitest';
import { cookieOf, LAN_IP, makeApp, PUBLIC_HOST, TUNNEL_IP } from './helpers.ts';

async function family() {
	const { app, bus, sign } = await makeApp();
	const lan = { remoteAddress: LAN_IP };
	const setup = await app.inject({
		method: 'POST',
		url: '/api/v1/setup',
		...lan,
		payload: { name: 'Mama', color: '#e11d48', pin: '1111' }
	});
	const asParent = { ...lan, headers: { cookie: cookieOf(setup) } };
	const kidRes = await app.inject({
		method: 'POST',
		url: '/api/v1/persons',
		...asParent,
		payload: { name: 'Kind', color: '#2563eb', role: 'child', pin: '2222' }
	});
	const kid = kidRes.json().person.id as number;

	const pub = {
		remoteAddress: TUNNEL_IP,
		headers: { host: PUBLIC_HOST, 'cf-access-jwt-assertion': await sign() }
	};
	const kidLogin = await app.inject({
		method: 'POST',
		url: '/api/v1/session',
		...pub,
		payload: { personId: kid, pin: '2222' }
	});
	const kidPhone = { ...pub, headers: { ...pub.headers, cookie: cookieOf(kidLogin) } };

	// Gesendete SSE-Events mitschreiben
	const events: string[] = [];
	const publish = bus.publish;
	bus.publish = (e) => {
		events.push(e.type);
		publish(e);
	};

	const req = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
		app.inject({ method, url: `/api/v1${url}`, ...lan, ...(payload ? { payload } : {}) });
	const lists = async () =>
		(await req('GET', '/lists')).json().lists as {
			id: number;
			title: string;
			items: { id: number; text: string; done: boolean }[];
		}[];
	return { app, lan, pub, asParent, kidPhone, events, req, lists };
}

describe('Listen', () => {
	it('Tablet ohne PIN: anlegen, Einträge hinzufügen, abhaken, bearbeiten; jede Änderung sendet ein Event', async () => {
		const f = await family();
		const created = await f.req('POST', '/lists', { title: 'Urlaub', icon: '🏖️' });
		expect(created.statusCode).toBe(201);
		const id = created.json().list.id as number;

		const add = async (text: string) =>
			(await f.req('POST', `/lists/${id}/items`, { text })).json().item.id as number;
		const a = await add('Sonnencreme');
		const b = await add('Badehose');
		expect(f.events.filter((e) => e === 'lists.changed')).toHaveLength(3);

		expect((await f.req('PATCH', `/lists/${id}/items/${a}`, { done: true })).statusCode).toBe(204);
		await f.req('PATCH', `/lists/${id}/items/${b}`, { text: 'Badesachen' });
		await f.req('PATCH', `/lists/${id}`, { title: 'Sommerurlaub' });

		expect(await f.lists()).toEqual([
			{
				id,
				title: 'Sommerurlaub',
				icon: '🏖️',
				items: [
					{ id: a, text: 'Sonnencreme', done: true },
					{ id: b, text: 'Badesachen', done: false }
				]
			}
		]);
		expect(f.events).toHaveLength(6);
	});

	it('Sortieren: Einträge und Listen lassen sich verschieben', async () => {
		const f = await family();
		const id = (await f.req('POST', '/lists', { title: 'Projekt' })).json().list.id as number;
		const ids: number[] = [];
		for (const text of ['A', 'B', 'C', 'D'])
			ids.push((await f.req('POST', `/lists/${id}/items`, { text })).json().item.id);
		const order = async () => (await f.lists())[0]!.items.map((i) => i.text).join('');

		await f.req('PATCH', `/lists/${id}/items/${ids[3]}`, { position: 0 });
		expect(await order()).toBe('DABC');
		await f.req('PATCH', `/lists/${id}/items/${ids[3]}`, { position: 99 });
		expect(await order()).toBe('ABCD');
		await f.req('PATCH', `/lists/${id}/items/${ids[0]}`, { position: 2 });
		expect(await order()).toBe('BCAD');
		// Neue Einträge kommen ans Ende
		await f.req('POST', `/lists/${id}/items`, { text: 'E' });
		expect(await order()).toBe('BCADE');

		const second = (await f.req('POST', '/lists', { title: 'Zweite' })).json().list.id as number;
		await f.req('PATCH', `/lists/${second}`, { position: 0 });
		expect((await f.lists()).map((l) => l.title)).toEqual(['Zweite', 'Projekt']);
	});

	it('Erledigte entfernen, einzelne Einträge löschen', async () => {
		const f = await family();
		const id = (await f.req('POST', '/lists', { title: 'Baumarkt' })).json().list.id as number;
		const add = async (text: string) =>
			(await f.req('POST', `/lists/${id}/items`, { text })).json().item.id as number;
		const a = await add('Schrauben');
		const b = await add('Dübel');
		const c = await add('Farbe');
		await f.req('PATCH', `/lists/${id}/items/${a}`, { done: true });
		await f.req('PATCH', `/lists/${id}/items/${b}`, { done: true });

		expect((await f.req('POST', `/lists/${id}/clear-done`)).json()).toEqual({ removed: 2 });
		expect((await f.req('DELETE', `/lists/${id}/items/${c}`)).statusCode).toBe(204);
		expect((await f.lists())[0]!.items).toEqual([]);
		expect((await f.req('DELETE', `/lists/${id}/items/${c}`)).statusCode).toBe(404);
	});

	it('Ganze Liste löschen nur Eltern; Einträge gehen mit', async () => {
		const f = await family();
		const id = (await f.req('POST', '/lists', { title: 'Alt' })).json().list.id as number;
		await f.req('POST', `/lists/${id}/items`, { text: 'X' });

		const del = (opts: object) =>
			f.app.inject({ method: 'DELETE', url: `/api/v1/lists/${id}`, ...opts });
		expect((await del(f.lan)).statusCode).toBe(401);
		expect((await del(f.kidPhone)).statusCode).toBe(403);
		expect((await del(f.asParent)).statusCode).toBe(204);
		expect(await f.lists()).toEqual([]);
	});

	it('Über die öffentliche Adresse nur angemeldet; Eintrag einer anderen Liste nicht erreichbar', async () => {
		const f = await family();
		const anon = await f.app.inject({ url: '/api/v1/lists', ...f.pub });
		expect(anon.statusCode).toBe(401);
		const viaPhone = await f.app.inject({
			method: 'POST',
			url: '/api/v1/lists',
			...f.kidPhone,
			payload: { title: 'Wünsche' }
		});
		expect(viaPhone.statusCode).toBe(201);

		const one = viaPhone.json().list.id as number;
		const two = (await f.req('POST', '/lists', { title: 'Andere' })).json().list.id as number;
		const item = (await f.req('POST', `/lists/${one}/items`, { text: 'Rad' })).json().item.id;
		expect((await f.req('PATCH', `/lists/${two}/items/${item}`, { done: true })).statusCode).toBe(
			404
		);
		expect((await f.req('POST', `/lists/${two}/items`, { text: '  ' })).statusCode).toBe(400);
	});
});
