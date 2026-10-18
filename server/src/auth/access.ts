import { BlockList, isIPv4 } from 'node:net';
import type { AccessVerifier } from './cf-access.ts';

export type Via = 'lan' | 'public';
export type AccessDecision =
	{ ok: true; via: Via; email: string | null } | { ok: false; status: 401 | 403; reason: string };

export type AccessPolicy = {
	publicHost?: string;
	tunnelSourceIps: string[];
	lanSubnets: string[];
	verify?: AccessVerifier;
};

export function normalizeIp(ip: string): string {
	return ip.startsWith('::ffff:') && isIPv4(ip.slice(7)) ? ip.slice(7) : ip;
}

function buildLanList(subnets: string[]): BlockList {
	const list = new BlockList();
	for (const s of subnets) {
		const [addr, bits] = s.split('/');
		if (!addr) continue;
		const type = isIPv4(addr) ? 'ipv4' : 'ipv6';
		if (bits === undefined) list.addAddress(addr, type);
		else list.addSubnet(addr, Number(bits), type);
	}
	return list;
}

/**
 * Entscheidet pro Request, über welchen Weg er kommt:
 * - über den Tunnel (Quell-IP von cloudflared oder Host = öffentliche Domain): nur mit gültigem Access-JWT
 * - direkt aus einem erlaubten LAN-Subnetz: erlaubt (Tablet)
 * - alles andere: abgelehnt
 * Die Tunnel-IP liegt meist selbst im LAN und darf deshalb nie als LAN gelten.
 */
export function createAccessPolicy(policy: AccessPolicy) {
	const lan = buildLanList(policy.lanSubnets);
	const tunnelIps = new Set(policy.tunnelSourceIps.map(normalizeIp));
	const publicHost = policy.publicHost?.toLowerCase();

	return async (req: {
		ip: string;
		host: string | undefined;
		jwt: string | undefined;
	}): Promise<AccessDecision> => {
		const ip = normalizeIp(req.ip);
		const host = req.host?.toLowerCase().replace(/:\d+$/, '');
		const viaTunnel = tunnelIps.has(ip) || (publicHost !== undefined && host === publicHost);

		if (viaTunnel) {
			if (!policy.verify) return { ok: false, status: 403, reason: 'public access disabled' };
			if (!req.jwt) return { ok: false, status: 401, reason: 'missing access token' };
			try {
				const { email } = await policy.verify(req.jwt);
				return { ok: true, via: 'public', email };
			} catch {
				return { ok: false, status: 401, reason: 'invalid access token' };
			}
		}

		const type = isIPv4(ip) ? 'ipv4' : 'ipv6';
		if (lan.check(ip, type)) return { ok: true, via: 'lan', email: null };
		return { ok: false, status: 403, reason: 'network not allowed' };
	};
}
