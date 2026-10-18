import { describe, expect, it } from 'vitest';
import { createAccessPolicy, normalizeIp } from '../src/auth/access.ts';
import { createAccessVerifier } from '../src/auth/cf-access.ts';
import { accessKeys, AUD, PUBLIC_HOST, TEAM, TUNNEL_IP } from './helpers.ts';

async function setup() {
	const { keys, sign } = await accessKeys();
	const decide = createAccessPolicy({
		publicHost: PUBLIC_HOST,
		tunnelSourceIps: [TUNNEL_IP],
		lanSubnets: ['192.168.1.0/24'],
		verify: createAccessVerifier({ teamDomain: TEAM, aud: AUD, keys })
	});
	return { decide, sign };
}

describe('Zugriffsregel', () => {
	it('LAN-Subnetz ist ohne Token erlaubt, inkl. IPv4-mapped IPv6', async () => {
		const { decide } = await setup();
		expect(await decide({ ip: '192.168.1.50', host: '192.168.1.10:8470', jwt: undefined })).toEqual(
			{
				ok: true,
				via: 'lan',
				email: null
			}
		);
		expect((await decide({ ip: '::ffff:192.168.1.50', host: undefined, jwt: undefined })).ok).toBe(
			true
		);
		expect(normalizeIp('::ffff:10.0.0.1')).toBe('10.0.0.1');
	});

	it('fremdes Netz wird abgelehnt', async () => {
		const { decide } = await setup();
		expect(await decide({ ip: '10.0.0.1', host: undefined, jwt: undefined })).toMatchObject({
			ok: false,
			status: 403
		});
	});

	it('Tunnel-IP liegt im LAN, braucht aber trotzdem ein gültiges Token', async () => {
		const { decide, sign } = await setup();
		expect(await decide({ ip: TUNNEL_IP, host: '192.168.1.10', jwt: undefined })).toMatchObject({
			ok: false,
			status: 401
		});
		expect(await decide({ ip: TUNNEL_IP, host: PUBLIC_HOST, jwt: await sign() })).toEqual({
			ok: true,
			via: 'public',
			email: 'a@example.com'
		});
	});

	it('öffentliche Domain im Host-Header erzwingt Token, auch aus dem LAN', async () => {
		const { decide } = await setup();
		expect(
			await decide({ ip: '192.168.1.50', host: `${PUBLIC_HOST.toUpperCase()}:443`, jwt: undefined })
		).toMatchObject({ ok: false, status: 401 });
	});

	it('Token mit falscher Audience oder falschem Issuer wird abgelehnt', async () => {
		const { decide, sign } = await setup();
		for (const jwt of [
			await sign({ aud: 'andere' }),
			await sign({ iss: 'https://evil.example' })
		]) {
			expect(await decide({ ip: TUNNEL_IP, host: PUBLIC_HOST, jwt })).toMatchObject({
				ok: false,
				status: 401
			});
		}
	});

	it('ohne Verifier ist öffentlicher Zugang gesperrt', async () => {
		const decide = createAccessPolicy({
			publicHost: PUBLIC_HOST,
			tunnelSourceIps: [],
			lanSubnets: ['192.168.1.0/24']
		});
		expect(await decide({ ip: '192.168.1.5', host: PUBLIC_HOST, jwt: 'x' })).toMatchObject({
			ok: false,
			status: 403
		});
	});
});
