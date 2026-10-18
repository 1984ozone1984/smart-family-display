import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { createAccessPolicy, type Via } from './auth/access.ts';
import type { AccessVerifier } from './auth/cf-access.ts';
import { createLockout, type Lockout } from './auth/pin.ts';
import { findSession, SESSION_COOKIE, type SessionPerson } from './auth/session.ts';
import { createCalendarService, type CalendarService } from './calendar/service.ts';
import { createSync, type Sync } from './calendar/sync.ts';
import type { Config } from './config.ts';
import type { Crypto } from './crypto.ts';
import type { Db } from './db/index.ts';
import type { EventBus } from './events/bus.ts';
import type { GoogleAccounts } from './google/accounts.ts';
import type { CalendarApi } from './google/calendar-api.ts';
import { GoogleError } from './google/errors.ts';
import type { OAuth } from './google/oauth.ts';
import { calendarRoutes } from './routes/calendars.ts';
import { eventRoutes } from './routes/events.ts';
import { googleRoutes } from './routes/google.ts';
import { healthRoutes } from './routes/health.ts';
import { personRoutes } from './routes/persons.ts';
import { sessionRoutes } from './routes/session.ts';
import { setupRoutes } from './routes/setup.ts';
import { streamRoutes } from './routes/stream.ts';

declare module 'fastify' {
	interface FastifyInstance {
		sync: Sync;
	}
	interface FastifyRequest {
		via: Via;
		accessEmail: string | null;
		person: SessionPerson | null;
	}
}

export type GoogleDeps = {
	oauth: OAuth;
	accounts: Pick<GoogleAccounts, 'apiFor' | 'apiWithToken' | 'remember' | 'forget'>;
	crypto: Crypto;
};

export type AppDeps = {
	config: Config;
	db: Db;
	bus: EventBus;
	verify?: AccessVerifier;
	lockout?: Lockout;
	/** null = Google nicht konfiguriert */
	google?: GoogleDeps | null;
	logger?: boolean;
};

export type Ctx = {
	config: Config;
	db: Db;
	bus: EventBus;
	lockout: Lockout;
	google: GoogleDeps | null;
	sync: Sync;
	calendars: CalendarService;
};

const UNGUARDED = ['/api/v1/health'];

/** Einmal-Codes und OAuth-State nicht ins Log schreiben */
export function redactUrl(url: string): string {
	return url.replace(/([?&](?:code|state)=)[^&]*/g, '$1[redacted]');
}

function logRequest(req: FastifyRequest) {
	return {
		method: req.method,
		url: redactUrl(req.url),
		host: req.headers.host,
		remoteAddress: req.ip
	};
}

export async function buildApp(deps: AppDeps) {
	const app = Fastify({
		logger: deps.logger ? { serializers: { req: logRequest } } : false,
		trustProxy: false,
		bodyLimit: 64 * 1024
	});
	const google = deps.google ?? null;
	const apiFor = (accountId: number): CalendarApi => {
		if (!google) throw new GoogleError(503, 'google not configured');
		return google.accounts.apiFor(accountId);
	};
	const tz = deps.config.TZ;
	const sync = createSync({ db: deps.db, bus: deps.bus, tz, apiFor, log: app.log });
	const ctx: Ctx = {
		config: deps.config,
		db: deps.db,
		bus: deps.bus,
		lockout: deps.lockout ?? createLockout(),
		google,
		sync,
		calendars: createCalendarService({ db: deps.db, bus: deps.bus, tz, apiFor, sync })
	};
	const decide = createAccessPolicy({
		publicHost: deps.config.PUBLIC_HOST,
		tunnelSourceIps: deps.config.TUNNEL_SOURCE_IPS,
		lanSubnets: deps.config.LAN_SUBNETS,
		verify: deps.verify
	});

	await app.register(cookie);
	app.decorate('sync', sync);
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
			await streamRoutes(api, ctx);
			await googleRoutes(api, ctx);
			await calendarRoutes(api, ctx);
			await eventRoutes(api, ctx);
		},
		{ prefix: '/api/v1' }
	);

	const webDir = deps.config.WEB_DIR && resolve(deps.config.WEB_DIR);
	if (webDir && existsSync(join(webDir, 'index.html'))) {
		await app.register(fastifyStatic, {
			root: webDir,
			wildcard: false,
			// Gehashte Bundles dürfen ewig gecacht werden, alles andere (index.html, SW) immer prüfen.
			setHeaders: (res, path) => {
				res.header(
					'Cache-Control',
					path.includes('/_app/immutable/') ? 'public, max-age=31536000, immutable' : 'no-cache'
				);
			}
		});
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
