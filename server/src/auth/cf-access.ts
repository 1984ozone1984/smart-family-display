import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export type AccessIdentity = { email: string | null };
export type AccessVerifier = (token: string) => Promise<AccessIdentity>;

/**
 * Prüft das von Cloudflare Access gesetzte `Cf-Access-Jwt-Assertion`:
 * Signatur gegen die Team-Zertifikate, Issuer = Team-Domain, Audience = AUD-Tag der Application.
 */
export function createAccessVerifier(opts: {
	teamDomain: string;
	aud: string;
	keys?: JWTVerifyGetKey;
}): AccessVerifier {
	const issuer = opts.teamDomain.replace(/\/+$/, '');
	const keys = opts.keys ?? createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
	return async (token) => {
		const { payload } = await jwtVerify(token, keys, { issuer, audience: opts.aud });
		return { email: typeof payload.email === 'string' ? payload.email : null };
	};
}
