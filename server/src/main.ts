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
import { createMealieApi } from './mealie/client.ts';
import { generateRoutineTasks } from './tasks/routines.ts';
import { todayIn } from './time.ts';

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

const mealie = config.MEALIE_TOKEN
	? createMealieApi({ url: config.MEALIE_URL, token: config.MEALIE_TOKEN })
	: null;

const app = await buildApp({ config, db, bus, verify, google, mealie, logger: true });
if (ran.length) app.log.info({ migrations: ran }, 'Migrationen angewendet');
if (!verify)
	app.log.warn('Cloudflare Access nicht konfiguriert: öffentlicher Zugang gesperrt, nur LAN');

if (!google) app.log.warn('Google nicht konfiguriert: Kalender deaktiviert');
else {
	const run = () => void app.sync.syncAll();
	setTimeout(run, 5_000).unref();
	setInterval(run, config.CALENDAR_SYNC_MIN * 60_000).unref();
}

// Mealie: Änderungen, die direkt in Mealie gemacht wurden, an die Geräte melden
if (!app.mealie) app.log.warn('MEALIE_TOKEN fehlt: Essen und Einkaufsliste deaktiviert');
else {
	const m = app.mealie;
	let failing = false;
	const poll = () =>
		m.poll().then(
			() => {
				if (failing) app.log.info('Mealie wieder erreichbar');
				failing = false;
			},
			(err: unknown) => {
				if (!failing) app.log.warn({ err: String(err) }, 'Mealie nicht erreichbar');
				failing = true;
			}
		);
	setTimeout(() => void poll(), 5_000).unref();
	setInterval(() => void poll(), config.MEALIE_POLL_SEC * 1000).unref();
}

// Routinen: heutige Aufgaben anlegen – beim Start und regelmäßig (deckt den Tageswechsel ab)
const routines = () => {
	if (generateRoutineTasks(db, todayIn(config.TZ)) > 0) bus.publish({ type: 'tasks.changed' });
};
routines();
setInterval(routines, 5 * 60_000).unref();

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
