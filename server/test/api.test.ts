import { describe, expect, it } from 'vitest';
import { redactUrl } from '../src/app.ts';
import { cookieOf, LAN_IP, makeApp, OUTSIDE_IP, PUBLIC_HOST, TUNNEL_IP } from './helpers.ts';

type App = Awaited<ReturnType<typeof makeApp>>['app'];

const lan = { remoteAddress: LAN_IP };

async function setupParent(app: App) {
	const res = await app.inject({
		method: 'POST',
		url: '/api/v1/setup',
		...lan,
		payload: { name: 'Mama', color: '#e11d48', pin: '1111' }
	});
	expect(res.statusCode).toBe(201);
	return { id: res.json().person.id as number, cookie: cookieOf(res) };
}

async function addChild(app: App, parentCookie: string) {
	const res = await app.inject({
		method: 'POST',
		url: '/api/v1/persons',
		...lan,
		headers: { cookie: parentCookie },
		payload: { name: 'Kind', color: '#2563eb', role: 'child', pin: '2222' }
	});
	expect(res.statusCode).toBe(201);
	return res.json().person.id as number;
}

describe('API', () => {
	it('Health ist ohne Zugriffsprüfung erreichbar', async () => {
		const { app } = await makeApp();
		const res = await app.inject({ url: '/api/v1/health', remoteAddress: OUTSIDE_IP });
		expect(res.json()).toEqual({ status: 'ok' });
	});

	it('fremdes Netz bekommt 403, Tunnel ohne Token 401', async () => {
		const { app } = await makeApp();
		expect(
			(await app.inject({ url: '/api/v1/persons', remoteAddress: OUTSIDE_IP })).statusCode
		).toBe(403);
		expect(
			(await app.inject({ url: '/api/v1/persons', remoteAddress: TUNNEL_IP })).statusCode
		).toBe(401);
	});

	it('Ersteinrichtung nur einmal und nur aus dem LAN', async () => {
		const { app, sign } = await makeApp();
		expect((await app.inject({ url: '/api/v1/setup', ...lan })).json()).toEqual({ needed: true });

		const viaTunnel = await app.inject({
			method: 'POST',
			url: '/api/v1/setup',
			remoteAddress: TUNNEL_IP,
			headers: { host: PUBLIC_HOST, 'cf-access-jwt-assertion': await sign() },
			payload: { name: 'X', color: '#000000', pin: '1234' }
		});
		expect(viaTunnel.statusCode).toBe(403);

		await setupParent(app);
		expect((await app.inject({ url: '/api/v1/setup', ...lan })).json()).toEqual({ needed: false });
		const again = await app.inject({
			method: 'POST',
			url: '/api/v1/setup',
			...lan,
			payload: { name: 'Papa', color: '#000000', pin: '1234' }
		});
		expect(again.statusCode).toBe(409);
	});

	it('Login per PIN, Sperre nach 5 Fehlversuchen', async () => {
		const { app } = await makeApp();
		const { id } = await setupParent(app);
		const login = (pin: string) =>
			app.inject({
				method: 'POST',
				url: '/api/v1/session',
				...lan,
				payload: { personId: id, pin }
			});

		const ok = await login('1111');
		expect(ok.statusCode).toBe(200);
		const me = await app.inject({
			url: '/api/v1/session',
			...lan,
			headers: { cookie: cookieOf(ok) }
		});
		expect(me.json().person.name).toBe('Mama');

		for (let i = 0; i < 5; i++) expect((await login('0000')).statusCode).toBe(401);
		const locked = await login('1111');
		expect(locked.statusCode).toBe(429);
		expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
	});

	it('ungültige Eingaben ergeben 400', async () => {
		const { app } = await makeApp();
		const res = await app.inject({
			method: 'POST',
			url: '/api/v1/setup',
			...lan,
			payload: { name: '', color: 'rot', pin: '12' }
		});
		expect(res.statusCode).toBe(400);
		expect(
			res
				.json()
				.issues.map((i: { path: string }) => i.path)
				.sort()
		).toEqual(['color', 'name', 'pin']);
	});

	it('Rollen: Kind darf keine Personen anlegen, Eltern schon', async () => {
		const { app } = await makeApp();
		const parent = await setupParent(app);
		const childId = await addChild(app, parent.cookie);
		const childLogin = await app.inject({
			method: 'POST',
			url: '/api/v1/session',
			...lan,
			payload: { personId: childId, pin: '2222' }
		});
		const res = await app.inject({
			method: 'POST',
			url: '/api/v1/persons',
			...lan,
			headers: { cookie: cookieOf(childLogin) },
			payload: { name: 'X', color: '#000000', role: 'parent', pin: '9999' }
		});
		expect(res.statusCode).toBe(403);
		const anon = await app.inject({
			method: 'PATCH',
			url: `/api/v1/persons/${childId}`,
			...lan,
			payload: { name: 'Y' }
		});
		expect(anon.statusCode).toBe(401);
	});

	it('Lesen: LAN ohne Login, öffentlich nur mit Session; E-Mail nur für Eltern', async () => {
		const { app, sign } = await makeApp();
		const parent = await setupParent(app);
		await app.inject({
			method: 'PATCH',
			url: `/api/v1/persons/${parent.id}`,
			...lan,
			headers: { cookie: parent.cookie },
			payload: { email: 'mama@example.com' }
		});

		const tablet = await app.inject({ url: '/api/v1/persons', ...lan });
		expect(tablet.statusCode).toBe(200);
		expect(tablet.json().persons[0].email).toBeUndefined();

		const pub = {
			remoteAddress: TUNNEL_IP,
			headers: { host: PUBLIC_HOST, 'cf-access-jwt-assertion': await sign() }
		};
		expect((await app.inject({ url: '/api/v1/persons', ...pub })).statusCode).toBe(401);

		// LAN-Session gilt nicht über den Tunnel
		const viaLanCookie = await app.inject({
			url: '/api/v1/persons',
			...pub,
			headers: { ...pub.headers, cookie: parent.cookie }
		});
		expect(viaLanCookie.statusCode).toBe(401);

		const login = await app.inject({
			method: 'POST',
			url: '/api/v1/session',
			...pub,
			payload: { personId: parent.id, pin: '1111' }
		});
		expect(login.cookies.find((c) => c.name === 'kz_session')?.secure).toBe(true);
		const list = await app.inject({
			url: '/api/v1/persons',
			...pub,
			headers: { ...pub.headers, cookie: cookieOf(login) }
		});
		expect(list.json().persons[0].email).toBe('mama@example.com');
	});

	it('Login-Auswahl öffentlich ohne Session, mit Vorschlag per Access-E-Mail', async () => {
		const { app, sign } = await makeApp();
		const parent = await setupParent(app);
		await app.inject({
			method: 'PATCH',
			url: `/api/v1/persons/${parent.id}`,
			...lan,
			headers: { cookie: parent.cookie },
			payload: { email: 'Mama@Example.com' }
		});
		const res = await app.inject({
			url: '/api/v1/session/persons',
			remoteAddress: TUNNEL_IP,
			headers: {
				host: PUBLIC_HOST,
				'cf-access-jwt-assertion': await sign({ email: 'mama@example.com' })
			}
		});
		expect(res.statusCode).toBe(200);
		expect(res.json().suggestedId).toBe(parent.id);
		expect(res.json().persons[0].email).toBeUndefined();
	});

	it('Sperre über den Tunnel gilt pro Client-IP, nicht für alle Handys', async () => {
		const { app, sign } = await makeApp();
		const parent = await setupParent(app);
		const jwt = await sign();
		const login = (clientIp: string, pin: string) =>
			app.inject({
				method: 'POST',
				url: '/api/v1/session',
				remoteAddress: TUNNEL_IP,
				headers: {
					host: PUBLIC_HOST,
					'cf-access-jwt-assertion': jwt,
					'cf-connecting-ip': clientIp
				},
				payload: { personId: 999, pin }
			});
		for (let i = 0; i < 5; i++) await login('203.0.113.1', '0000');
		expect((await login('203.0.113.1', '0000')).statusCode).toBe(429);
		const other = await app.inject({
			method: 'POST',
			url: '/api/v1/session',
			remoteAddress: TUNNEL_IP,
			headers: {
				host: PUBLIC_HOST,
				'cf-access-jwt-assertion': jwt,
				'cf-connecting-ip': '203.0.113.2'
			},
			payload: { personId: parent.id, pin: '1111' }
		});
		expect(other.statusCode).toBe(200);
	});

	it('letzter Elternteil kann nicht zum Kind werden', async () => {
		const { app } = await makeApp();
		const parent = await setupParent(app);
		const res = await app.inject({
			method: 'PATCH',
			url: `/api/v1/persons/${parent.id}`,
			...lan,
			headers: { cookie: parent.cookie },
			payload: { role: 'child' }
		});
		expect(res.statusCode).toBe(409);
	});

	it('Logout beendet die Session', async () => {
		const { app } = await makeApp();
		const parent = await setupParent(app);
		await app.inject({
			method: 'DELETE',
			url: '/api/v1/session',
			...lan,
			headers: { cookie: parent.cookie }
		});
		const me = await app.inject({
			url: '/api/v1/session',
			...lan,
			headers: { cookie: parent.cookie }
		});
		expect(me.json().person).toBeNull();
	});

	it('Avatar: nur echte Bilder, danach abrufbar', async () => {
		const { app } = await makeApp();
		const parent = await setupParent(app);
		const upload = (content: Buffer) => {
			const boundary = '----kz';
			const body = Buffer.concat([
				Buffer.from(
					`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`
				),
				content,
				Buffer.from(`\r\n--${boundary}--\r\n`)
			]);
			return app.inject({
				method: 'POST',
				url: `/api/v1/persons/${parent.id}/avatar`,
				...lan,
				headers: {
					cookie: parent.cookie,
					'content-type': `multipart/form-data; boundary=${boundary}`
				},
				payload: body
			});
		};
		expect((await upload(Buffer.from('kein bild'))).statusCode).toBe(415);

		const png = Buffer.concat([
			Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			Buffer.alloc(16)
		]);
		const ok = await upload(png);
		expect(ok.statusCode).toBe(200);
		const url = ok.json().person.avatarUrl as string;
		const img = await app.inject({ url, ...lan });
		expect(img.statusCode).toBe(200);
		expect(img.headers['content-type']).toBe('image/png');
		expect(
			(await app.inject({ url: '/api/v1/avatars/..%2F..%2Fetc%2Fpasswd', ...lan })).statusCode
		).toBe(404);
	});

	it('OAuth-Code und State landen nicht im Log', () => {
		expect(redactUrl('/api/v1/google/callback?state=abc&iss=x&code=4/geheim&scope=s')).toBe(
			'/api/v1/google/callback?state=[redacted]&iss=x&code=[redacted]&scope=s'
		);
	});
});
