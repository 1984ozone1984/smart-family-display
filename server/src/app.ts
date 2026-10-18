import { existsSync } from 'node:fs';
import { join } from 'node:path';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { createAccessPolicy, type Via } from './auth/access.ts';
import type { AccessVerifier } from './auth/cf-access.ts';
import { createLockout, type Lockout } from './auth/pin.ts';
import { findSession, SESSION_COOKIE, type SessionPerson } from './auth/session.ts';
import type { Config } from './config.ts';
import type { Db } from './db/index.ts';
import type { EventBus } from './events/bus.ts';
import { eventRoutes } from './routes/events.ts';
import { healthRoutes } from './routes/health.ts';
import { personRoutes } from './routes/persons.ts';
import { sessionRoutes } from './routes/session.ts';
import { setupRoutes } from './routes/setup.ts';

declare module 'fastify' {
	interface FastifyRequest {
		via: Via;
		accessEmail: string | null;
		person: SessionPerson | null;
	}
}

export type AppDeps = {
	config: Config;
	db: Db;
	bus: EventBus;
	verify?: AccessVerifier;
	lockout?: Lockout;
	logger?: boolean;
};

export type Ctx = Required<Omit<AppDeps, 'verify' | 'logger'>>;

const UNGUARDED = ['/api/v1/health'];

export async function buildApp(deps: AppDeps) {
	const app = Fastify({ logger: deps.logger ?? false, trustProxy: false, bodyLimit: 64 * 1024 });
	const ctx: Ctx = {
		config: deps.config,
		db: deps.db,
		bus: deps.bus,
		lockout: deps.lockout ?? createLockout()
	};
	const decide = createAccessPolicy({
		publicHost: deps.config.PUBLIC_HOST,
		tunnelSourceIps: deps.config.TUNNEL_SOURCE_IPS,
		lanSubnets: deps.config.LAN_SUBNETS,
		verify: deps.verify
	});

	await app.register(cookie);
	app.decorateRequest('via', 'lan');
	app.decorateRequest('accessEmail', null);
	app.decorateRequest('person', null);

	app.addHook('onRequest', async (req, reply) => {
		if (UNGUARDED.includes(req.url)) return;
		const header = req.headers['cf-access-jwt-assertion'];
		const decision = await decide({
			ip: req.ip,
			host: req.headers.host,
			jwt: typeof header === 'string' ? header : undefined
		});
		if (!decision.ok) {
			req.log.warn({ ip: req.ip, reason: decision.reason }, 'Zugriff abgelehnt');
			return reply.code(decision.status).send({ error: 'forbidden' });
		}
		req.via = decision.via;
		req.accessEmail = decision.email;
		const token = req.cookies[SESSION_COOKIE];
		req.person = token ? findSession(ctx.db, token, decision.via) : null;
	});

	await app.register(
		async (api) => {
			await healthRoutes(api, ctx);
			await setupRoutes(api, ctx);
			await sessionRoutes(api, ctx);
			await personRoutes(api, ctx);
			await eventRoutes(api, ctx);
		},
		{ prefix: '/api/v1' }
	);

	const webDir = deps.config.WEB_DIR;
	if (webDir && existsSync(join(webDir, 'index.html'))) {
		await app.register(fastifyStatic, { root: webDir, wildcard: false });
		// SPA: unbekannte Pfade außerhalb der API liefern die App-Shell.
		app.setNotFoundHandler((req, reply) => {
			if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
			return reply.type('text/html').sendFile('index.html');
		});
	}

	return app;
}

// --- Rechteprüfung, als preHandler an Routen ---

/** Lesen: am Tablet (LAN) ohne Login, öffentlich nur mit Personen-Session. */
export async function requireReader(req: FastifyRequest, reply: FastifyReply) {
	if (req.via === 'lan' || req.person) return;
	return reply.code(401).send({ error: 'login required' });
}

export async function requirePerson(req: FastifyRequest, reply: FastifyReply) {
	if (!req.person) return reply.code(401).send({ error: 'login required' });
}

export async function requireParent(req: FastifyRequest, reply: FastifyReply) {
	if (!req.person) return reply.code(401).send({ error: 'login required' });
	if (req.person.role !== 'parent') return reply.code(403).send({ error: 'parents only' });
}
