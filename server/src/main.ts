import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildApp } from './app.ts';
import { createAccessVerifier } from './auth/cf-access.ts';
import { purgeExpiredSessions } from './auth/session.ts';
import { loadConfig } from './config.ts';
import { migrate, openDb } from './db/index.ts';
import { createCrypto } from './crypto.ts';
import { createEventBus } from './events/bus.ts';
import { createGoogleAccounts } from './google/accounts.ts';
import { createOAuth } from './google/oauth.ts';

const config = loadConfig();
mkdirSync(config.DATA_DIR, { recursive: true });

const db = openDb(join(config.DATA_DIR, 'kommandozentrale.db'));
const ran = migrate(db);
const bus = createEventBus();

const verify =
	config.CF_ACCESS_TEAM_DOMAIN && config.CF_ACCESS_AUD
		? createAccessVerifier({ teamDomain: config.CF_ACCESS_TEAM_DOMAIN, aud: config.CF_ACCESS_AUD })
		: undefined;

let google = null;
if (config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET && config.ENCRYPTION_KEY) {
	const crypto = createCrypto(config.ENCRYPTION_KEY);
	const oauth = createOAuth({
		clientId: config.GOOGLE_CLIENT_ID,
		clientSecret: config.GOOGLE_CLIENT_SECRET,
		redirectUri:
			config.GOOGLE_REDIRECT_URI ?? `https://${config.PUBLIC_HOST}/api/v1/google/callback`
	});
	google = { oauth, crypto, accounts: createGoogleAccounts({ db, bus, crypto, oauth }) };
}

const app = await buildApp({ config, db, bus, verify, google, logger: true });
if (ran.length) app.log.info({ migrations: ran }, 'Migrationen angewendet');
if (!verify)
	app.log.warn('Cloudflare Access nicht konfiguriert: öffentlicher Zugang gesperrt, nur LAN');

if (!google) app.log.warn('Google nicht konfiguriert: Kalender deaktiviert');
else {
	const run = () => void app.sync.syncAll();
	setTimeout(run, 5_000).unref();
	setInterval(run, config.CALENDAR_SYNC_MIN * 60_000).unref();
}

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
