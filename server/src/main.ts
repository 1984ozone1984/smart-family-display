import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildApp } from './app.ts';
import { createAccessVerifier } from './auth/cf-access.ts';
import { purgeExpiredSessions } from './auth/session.ts';
import { loadConfig } from './config.ts';
import { migrate, openDb } from './db/index.ts';
import { createEventBus } from './events/bus.ts';

const config = loadConfig();
mkdirSync(config.DATA_DIR, { recursive: true });

const db = openDb(join(config.DATA_DIR, 'kommandozentrale.db'));
const ran = migrate(db);
const bus = createEventBus();

const verify =
	config.CF_ACCESS_TEAM_DOMAIN && config.CF_ACCESS_AUD
		? createAccessVerifier({ teamDomain: config.CF_ACCESS_TEAM_DOMAIN, aud: config.CF_ACCESS_AUD })
		: undefined;

const app = await buildApp({ config, db, bus, verify, logger: true });
if (ran.length) app.log.info({ migrations: ran }, 'Migrationen angewendet');
if (!verify) app.log.warn('Kein Cloudflare Access konfiguriert: nur LAN-Zugriff möglich');

purgeExpiredSessions(db);
setInterval(() => purgeExpiredSessions(db), 3_600_000).unref();

const shutdown = async () => {
	bus.close();
	await app.close();
	db.close();
	process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: config.PORT, host: config.HOST });
