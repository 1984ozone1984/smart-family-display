import { googleError } from './errors.ts';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

export const SCOPES = [
	'https://www.googleapis.com/auth/calendar.events',
	'https://www.googleapis.com/auth/calendar.calendarlist.readonly'
];

export type AccessToken = { accessToken: string; expiresAt: number };

export type OAuth = {
	authUrl(state: string): string;
	exchange(code: string): Promise<AccessToken & { refreshToken: string }>;
	refresh(refreshToken: string): Promise<AccessToken>;
	revoke(token: string): Promise<void>;
};

export function createOAuth(opts: {
	clientId: string;
	clientSecret: string;
	redirectUri: string;
	fetch?: typeof fetch;
}): OAuth {
	const f = opts.fetch ?? fetch;

	async function token(params: Record<string, string>) {
		const res = await f(TOKEN_URL, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				client_id: opts.clientId,
				client_secret: opts.clientSecret,
				...params
			})
		});
		if (!res.ok) throw await googleError(res);
		return (await res.json()) as {
			access_token: string;
			expires_in: number;
			refresh_token?: string;
		};
	}

	return {
		authUrl(state) {
			const q = new URLSearchParams({
				client_id: opts.clientId,
				redirect_uri: opts.redirectUri,
				response_type: 'code',
				scope: SCOPES.join(' '),
				// offline + consent: Google liefert zuverlässig einen Refresh-Token
				access_type: 'offline',
				prompt: 'consent',
				include_granted_scopes: 'true',
				state
			});
			return `${AUTH_URL}?${q}`;
		},
		async exchange(code) {
			const t = await token({
				grant_type: 'authorization_code',
				code,
				redirect_uri: opts.redirectUri
			});
			if (!t.refresh_token) throw new Error('Google hat keinen Refresh-Token geliefert');
			return {
				accessToken: t.access_token,
				expiresAt: Date.now() + t.expires_in * 1000,
				refreshToken: t.refresh_token
			};
		},
		async refresh(refreshToken) {
			const t = await token({ grant_type: 'refresh_token', refresh_token: refreshToken });
			return { accessToken: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 };
		},
		async revoke(t) {
			await f(REVOKE_URL, {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({ token: t })
			});
		}
	};
}
