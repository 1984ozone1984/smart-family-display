import { describe, expect, it } from 'vitest';
import { migrate, openDb } from '../src/db/index.ts';
import { balance, book, history, settleTask } from '../src/points/ledger.ts';
import { generateRoutineTasks, occurrence } from '../src/tasks/routines.ts';
import { insertRoutine, tasksForDate } from '../src/tasks/store.ts';
import { cookieOf, LAN_IP, makeApp, PUBLIC_HOST, TUNNEL_IP } from './helpers.ts';

// 2026-10-19 ist ein Montag
const MON = '2026-10-19';

function db() {
	const d = openDb(':memory:');
	migrate(d);
	d.prepare(
		"INSERT INTO person (id, name, color, role, pin_hash) VALUES (1, 'Mama', '#000000', 'parent', 'x'), (2, 'Kind', '#000000', 'child', 'x')"
	).run();
	return d;
}

const routine = (schedule: object, extra: object = {}) => ({
	title: 'Zähne putzen',
	icon: '🪥',
	schedule: JSON.stringify(schedule),
	timeSlot: 'morning' as const,
	points: 2,
	requiresApproval: false,
	active: true,
	...extra
});

describe('Routinen', () => {
	it('Zeitpläne: täglich, Wochentage, wöchentlich (Mo–So)', () => {
		expect(occurrence({ type: 'daily' }, MON)).toEqual({ from: MON, due: MON });
		expect(occurrence({ type: 'weekdays', days: [1, 3] }, MON)).toEqual({ from: MON, due: MON });
		expect(occurrence({ type: 'weekdays', days: [2] }, MON)).toBeNull();
		expect(occurrence({ type: 'weekly' }, '2026-10-22')).toEqual({ from: MON, due: '2026-10-25' });
		expect(occurrence({ type: 'weekly' }, '2026-10-25')).toEqual({ from: MON, due: '2026-10-25' });
	});

	it('erzeugt pro Tag genau eine Aufgabe, auch bei mehrfachem Lauf', () => {
		const d = db();
		insertRoutine(d, routine({ type: 'daily' }), [2], 1);
		insertRoutine(d, routine({ type: 'weekdays', days: [2] }, { title: 'Nur Dienstag' }), [2], 1);
		insertRoutine(d, routine({ type: 'daily' }, { title: 'Inaktiv', active: false }), [2], 1);
		insertRoutine(d, routine({ type: 'daily' }, { title: 'Niemand' }), [], 1);

		expect(generateRoutineTasks(d, MON)).toBe(1);
		expect(generateRoutineTasks(d, MON)).toBe(0);
		expect(generateRoutineTasks(d, '2026-10-20')).toBe(2);
		const titles = (date: string) =>
			tasksForDate(d, date, date, `${date}T00:00:00Z`).map((t) => t.title);
		expect(titles(MON)).toEqual(['Zähne putzen']);
		expect(titles('2026-10-20').sort()).toEqual(['Nur Dienstag', 'Zähne putzen']);
	});

	it('wöchentliche Routine: eine Aufgabe für die ganze Woche, danach verfallen', () => {
		const d = db();
		insertRoutine(d, routine({ type: 'weekly' }, { title: 'Zimmer aufräumen' }), [2], 1);
		expect(generateRoutineTasks(d, MON)).toBe(1);
		expect(generateRoutineTasks(d, '2026-10-23')).toBe(0);
		const on = (date: string) => tasksForDate(d, date, date, `${date}T00:00:00Z`).length;
		expect(on('2026-10-23')).toBe(1);
		expect(on('2026-10-26')).toBe(0);
		expect(generateRoutineTasks(d, '2026-10-26')).toBe(1);
	});
});

describe('Ledger', () => {
	it('ist append-only: Ändern und Löschen werden von der DB abgewiesen', () => {
		const d = db();
		book(d, { personId: 2, delta: 5, reason: 'Test', refType: 'bonus' });
		expect(() => d.prepare('UPDATE points_ledger SET delta = 500').run()).toThrow(/append-only/);
		expect(() => d.prepare('DELETE FROM points_ledger').run()).toThrow(/append-only/);
		expect(balance(d, 2)).toBe(5);
	});

	it('Aufgaben-Punkte: idempotent, Rücknahme als Gegenbuchung', () => {
		const d = db();
		const s = (target: number) =>
			settleTask(d, { taskId: 7, personId: 2, target, title: 'Müll', by: 2 });
		s(3);
		s(3);
		expect(balance(d, 2)).toBe(3);
		s(0);
		expect(balance(d, 2)).toBe(0);
		expect(history(d, 2).map((h) => [h.delta, h.reason])).toEqual([
			[-3, 'Rückgängig: Müll'],
			[3, 'Aufgabe: Müll']
		]);
	});
});

async function family() {
	const { app, db, sign } = await makeApp();
	const lan = { remoteAddress: LAN_IP };
	const setup = await app.inject({
		method: 'POST',
		url: '/api/v1/setup',
		...lan,
		payload: { name: 'Mama', color: '#e11d48', pin: '1111' }
	});
	const parent = { id: setup.json().person.id as number, cookie: cookieOf(setup) };
	const add = async (name: string) =>
		(
			await app.inject({
				method: 'POST',
				url: '/api/v1/persons',
				...lan,
				headers: { cookie: parent.cookie },
				payload: { name, color: '#2563eb', role: 'child', pin: '2222' }
			})
		).json().person.id as number;
	const kid = await add('Kind');
	const sibling = await add('Geschwister');
	const asParent = { ...lan, headers: { cookie: parent.cookie } };

	const jwt = await sign();
	const pub = {
		remoteAddress: TUNNEL_IP,
		headers: { host: PUBLIC_HOST, 'cf-access-jwt-assertion': jwt }
	};
	const kidLogin = await app.inject({
		method: 'POST',
		url: '/api/v1/session',
		...pub,
		payload: { personId: kid, pin: '2222' }
	});
	const kidPhone = {
		remoteAddress: TUNNEL_IP,
		headers: { ...pub.headers, cookie: cookieOf(kidLogin) }
	};

	const points = async (id: number) =>
		(await app.inject({ url: `/api/v1/points/${id}`, ...lan })).json().balance as number;
	const tasks = async () =>
		(await app.inject({ url: '/api/v1/tasks', ...lan })).json().tasks as {
			id: number;
			title: string;
			points: number;
			overdue: boolean;
			assignees: { personId: number; status: string }[];
		}[];
	// Am Tablet: Person meldet sich per PIN an (Kinder-PIN 2222)
	const tablet: Record<number, object> = { [parent.id]: asParent };
	for (const id of [kid, sibling]) {
		const login = await app.inject({
			method: 'POST',
			url: '/api/v1/session',
			...lan,
			payload: { personId: id, pin: '2222' }
		});
		tablet[id] = { ...lan, headers: { cookie: cookieOf(login) } };
	}
	const done = (taskId: number, personId: number, done = true, opts?: object) =>
		app.inject({
			method: 'POST',
			url: `/api/v1/tasks/${taskId}/done`,
			...(opts ?? tablet[personId] ?? lan),
			payload: { personId, done }
		});
	const createTask = async (payload: object) =>
		(await app.inject({ method: 'POST', url: '/api/v1/tasks', ...asParent, payload })).json()
			.id as number;

	return {
		app,
		db,
		lan,
		parent,
		kid,
		sibling,
		asParent,
		kidPhone,
		tablet,
		points,
		tasks,
		done,
		createTask
	};
}

describe('Aufgaben-API', () => {
	it('Routine erzeugt heutige Aufgabe; Antippen am Tablet bucht Punkte, Rücknahme bucht zurück', async () => {
		const f = await family();
		const r = await f.app.inject({
			method: 'POST',
			url: '/api/v1/routines',
			...f.asParent,
			payload: {
				title: 'Bett machen',
				schedule: { type: 'daily' },
				timeSlot: 'morning',
				points: 3,
				assignees: [f.kid]
			}
		});
		expect(r.statusCode).toBe(201);
		const [t] = await f.tasks();
		expect(t).toMatchObject({ title: 'Bett machen', points: 3 });

		expect((await f.done(t!.id, f.kid)).statusCode).toBe(204);
		expect((await f.done(t!.id, f.kid)).statusCode).toBe(204);
		expect(await f.points(f.kid)).toBe(3);
		expect((await f.tasks())[0]!.assignees[0]!.status).toBe('done');

		await f.done(t!.id, f.kid, false);
		expect(await f.points(f.kid)).toBe(0);
	});

	it('Eltern-Bestätigung: Punkte erst bei Freigabe; Kind kann bestätigte nicht zurücknehmen', async () => {
		const f = await family();
		const id = await f.createTask({
			title: 'Hausaufgaben',
			points: 5,
			requiresApproval: true,
			assignees: [f.kid]
		});
		await f.done(id, f.kid);
		expect(await f.points(f.kid)).toBe(0);

		const approvals = (await f.app.inject({ url: '/api/v1/tasks/approvals', ...f.lan })).json()
			.approvals;
		expect(approvals).toEqual([expect.objectContaining({ taskId: id, personId: f.kid })]);

		// Ohne Eltern-Login keine Freigabe
		const anon = await f.app.inject({
			method: 'POST',
			url: `/api/v1/tasks/${id}/approve`,
			...f.lan,
			payload: { personId: f.kid }
		});
		expect(anon.statusCode).toBe(401);

		const ok = await f.app.inject({
			method: 'POST',
			url: `/api/v1/tasks/${id}/approve`,
			...f.asParent,
			payload: { personId: f.kid }
		});
		expect(ok.statusCode).toBe(204);
		expect(await f.points(f.kid)).toBe(5);
		expect((await f.done(id, f.kid, false)).statusCode).toBe(403);
		expect((await f.done(id, f.kid, false, f.asParent)).statusCode).toBe(204);
		expect(await f.points(f.kid)).toBe(0);
	});

	it('Ablehnen setzt zurück auf offen, ohne Punkte', async () => {
		const f = await family();
		const id = await f.createTask({
			title: 'Geschirr',
			points: 4,
			requiresApproval: true,
			assignees: [f.kid]
		});
		await f.done(id, f.kid);
		await f.app.inject({
			method: 'POST',
			url: `/api/v1/tasks/${id}/approve`,
			...f.asParent,
			payload: { personId: f.kid, approve: false }
		});
		expect((await f.tasks())[0]!.assignees[0]!.status).toBe('open');
		expect(await f.points(f.kid)).toBe(0);
	});

	it('Gemeinsame Aufgabe: jede Person hakt für sich ab und bekommt eigene Punkte', async () => {
		const f = await family();
		const id = await f.createTask({
			title: 'Tisch decken',
			points: 2,
			assignees: [f.kid, f.sibling]
		});
		await f.done(id, f.kid);
		expect(await f.points(f.kid)).toBe(2);
		expect(await f.points(f.sibling)).toBe(0);
		expect((await f.done(id, f.parent.id)).statusCode).toBe(404);
	});

	it('Am Tablet: ohne Anmeldung kein Abhaken, Kind nur eigene Aufgaben, Eltern für alle', async () => {
		const f = await family();
		const id = await f.createTask({ title: 'Lesen', points: 1, assignees: [f.kid, f.sibling] });
		expect((await f.done(id, f.kid, true, f.lan)).statusCode).toBe(401);
		expect((await f.done(id, f.sibling, true, f.tablet[f.kid])).statusCode).toBe(403);
		expect((await f.done(id, f.kid, true, f.tablet[f.kid])).statusCode).toBe(204);
		expect((await f.done(id, f.sibling, true, f.asParent)).statusCode).toBe(204);
		expect(await f.points(f.sibling)).toBe(1);
	});

	it('Über das Handy: Kind nur für sich selbst, nicht fürs Geschwister', async () => {
		const f = await family();
		const id = await f.createTask({ title: 'Lesen', points: 1, assignees: [f.kid, f.sibling] });
		expect((await f.done(id, f.sibling, true, f.kidPhone)).statusCode).toBe(403);
		expect((await f.done(id, f.kid, true, f.kidPhone)).statusCode).toBe(204);
	});

	it('abgelaufene Routinen-Aufgabe ist gesperrt; überfällige einmalige bleibt sichtbar', async () => {
		const f = await family();
		f.db
			.prepare(
				"INSERT INTO task (id, title, available_from, due_date, points) VALUES (900, 'Gestern', '2020-01-01', '2020-01-01', 1)"
			)
			.run();
		f.db.prepare('INSERT INTO task_assignee (task_id, person_id) VALUES (900, ?)').run(f.kid);
		expect((await f.done(900, f.kid)).statusCode).toBe(409);

		await f.createTask({ title: 'Formular abgeben', dueDate: '2020-01-01', assignees: [f.kid] });
		expect((await f.tasks()).map((t) => [t.title, t.overdue])).toEqual([
			['Formular abgeben', true]
		]);
	});

	it('PATCH ändert nur gesendete Felder (keine Standardwerte)', async () => {
		const f = await family();
		const id = await f.createTask({
			title: 'Alt',
			points: 7,
			requiresApproval: true,
			assignees: [f.kid]
		});
		await f.app.inject({
			method: 'PATCH',
			url: `/api/v1/tasks/${id}`,
			...f.asParent,
			payload: { title: 'Neu' }
		});
		const t = (await f.tasks())[0]!;
		expect(t).toMatchObject({ title: 'Neu', points: 7 });
		expect((t as unknown as { requiresApproval: boolean }).requiresApproval).toBe(true);
	});

	it('nachträglich geänderte Punkte werden per Differenz nachgebucht', async () => {
		const f = await family();
		const id = await f.createTask({ title: 'Rasen', points: 5, assignees: [f.kid] });
		await f.done(id, f.kid);
		await f.app.inject({
			method: 'PATCH',
			url: `/api/v1/tasks/${id}`,
			...f.asParent,
			payload: { points: 8 }
		});
		expect(await f.points(f.kid)).toBe(8);
	});

	it('Kinder dürfen keine Aufgaben anlegen', async () => {
		const f = await family();
		const r = await f.app.inject({
			method: 'POST',
			url: '/api/v1/tasks',
			...f.kidPhone,
			payload: { title: 'X', assignees: [f.kid] }
		});
		expect(r.statusCode).toBe(403);
	});
});

describe('Belohnungen', () => {
	async function withReward(cost: number, weeklyLimit: number | null = null) {
		const f = await family();
		const r = await f.app.inject({
			method: 'POST',
			url: '/api/v1/rewards',
			...f.asParent,
			payload: { title: '30 min Tablet', icon: '🎮', cost, weeklyLimit }
		});
		const rewardId = r.json().reward.id as number;
		const bonus = (delta: number) =>
			f.app.inject({
				method: 'POST',
				url: '/api/v1/points',
				...f.asParent,
				payload: { personId: f.kid, delta, reason: 'Test' }
			});
		const redeem = () =>
			f.app.inject({
				method: 'POST',
				url: `/api/v1/rewards/${rewardId}/redeem`,
				...f.lan,
				payload: { personId: f.kid }
			});
		const decide = (id: number, approve: boolean) =>
			f.app.inject({
				method: 'POST',
				url: `/api/v1/redemptions/${id}/decide`,
				...f.asParent,
				payload: { approve }
			});
		return { ...f, rewardId, bonus, redeem, decide };
	}

	it('Anfrage → Eltern-Freigabe → Abbuchung', async () => {
		const f = await withReward(10);
		expect((await f.redeem()).statusCode).toBe(409);
		await f.bonus(12);
		const req = await f.redeem();
		expect(req.statusCode).toBe(201);
		expect(await f.points(f.kid)).toBe(12);

		const pending = (
			await f.app.inject({ url: '/api/v1/redemptions?status=requested', ...f.lan })
		).json().redemptions;
		expect(pending).toEqual([
			expect.objectContaining({ personId: f.kid, cost: 10, status: 'requested' })
		]);

		expect((await f.decide(req.json().id, true)).statusCode).toBe(204);
		expect(await f.points(f.kid)).toBe(2);
		expect((await f.decide(req.json().id, true)).statusCode).toBe(409);
	});

	it('offene Anfragen reservieren Punkte; Freigabe prüft den Kontostand erneut', async () => {
		const f = await withReward(10);
		await f.bonus(15);
		const first = await f.redeem();
		expect((await f.redeem()).statusCode).toBe(409);
		await f.bonus(-10);
		expect((await f.decide(first.json().id, true)).statusCode).toBe(409);
		expect(await f.points(f.kid)).toBe(5);
	});

	it('Wochenlimit; Ablehnen und Zurückziehen buchen nichts', async () => {
		const f = await withReward(1, 2);
		await f.bonus(10);
		const a = await f.redeem();
		const b = await f.redeem();
		expect((await f.redeem()).statusCode).toBe(409);
		await f.decide(a.json().id, false);
		const cancel = await f.app.inject({
			method: 'POST',
			url: `/api/v1/redemptions/${b.json().id}/cancel`,
			...f.lan
		});
		expect(cancel.statusCode).toBe(204);
		expect(await f.points(f.kid)).toBe(10);
		expect((await f.redeem()).statusCode).toBe(201);
	});

	it('Bonus/Abzug nur durch Eltern', async () => {
		const f = await withReward(1);
		const r = await f.app.inject({
			method: 'POST',
			url: '/api/v1/points',
			...f.kidPhone,
			payload: { personId: f.kid, delta: 100, reason: 'Selbst' }
		});
		expect(r.statusCode).toBe(403);
		expect(await f.points(f.kid)).toBe(0);
	});
});
