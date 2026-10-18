import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { buildApp } from '../src/app.ts';
import { createAccessVerifier } from '../src/auth/cf-access.ts';
import { loadConfig } from '../src/config.ts';
import { migrate, openDb } from '../src/db/index.ts';
import { createEventBus } from '../src/events/bus.ts';

export const TEAM = 'https://team.example.cloudflareaccess.com';
export const AUD = 'test-aud';
export const LAN_IP = '192.168.1.50';
export const TUNNEL_IP = '192.168.1.2';
export const OUTSIDE_IP = '10.9.9.9';
export const PUBLIC_HOST = 'dashboard.example.com';

export async function accessKeys() {
	const { publicKey, privateKey } = await generateKeyPair('RS256');
	const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
	const keys = createLocalJWKSet({ keys: [jwk] });
	const sign = (claims: { aud?: string; iss?: string; email?: string } = {}) =>
		new SignJWT({ email: claims.email ?? 'a@example.com' })
			.setProtectedHeader({ alg: 'RS256', kid: 'k1' })
			.setIssuer(claims.iss ?? TEAM)
			.setAudience(claims.aud ?? AUD)
			.setIssuedAt()
			.setExpirationTime('5m')
			.sign(privateKey);
	return { keys, sign };
}

export async function makeApp(opts: { lanSubnets?: string } = {}) {
	const config = loadConfig({
		DATA_DIR: mkdtempSync(join(tmpdir(), 'kz-test-')),
		PUBLIC_HOST,
		CF_ACCESS_TEAM_DOMAIN: TEAM,
		CF_ACCESS_AUD: AUD,
		TUNNEL_SOURCE_IPS: TUNNEL_IP,
		LAN_SUBNETS: opts.lanSubnets ?? '192.168.1.0/24'
	});
	const db = openDb(':memory:');
	migrate(db);
	const bus = createEventBus();
	const { keys, sign } = await accessKeys();
	const verify = createAccessVerifier({ teamDomain: TEAM, aud: AUD, keys });
	const app = await buildApp({ config, db, bus, verify });
	return { app, db, bus, sign, config };
}

/** Session-Cookie aus einer Inject-Antwort als Header-Wert. */
export function cookieOf(res: { cookies: { name: string; value: string }[] }): string {
	const c = res.cookies.find((x) => x.name === 'kz_session');
	if (!c) throw new Error('kein Session-Cookie');
	return `kz_session=${c.value}`;
}
