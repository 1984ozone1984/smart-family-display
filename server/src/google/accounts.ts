import { getAccount, setAccountStatus } from '../calendar/store.ts';
import type { Crypto } from '../crypto.ts';
import type { Db } from '../db/index.ts';
import type { EventBus } from '../events/bus.ts';
import { createCalendarApi, type CalendarApi } from './calendar-api.ts';
import { GoogleError } from './errors.ts';
import type { OAuth } from './oauth.ts';

/**
 * Liefert pro Konto einen Calendar-Client mit gecachtem Access-Token.
 * Widerruft der Nutzer den Zugriff (invalid_grant), wird das Konto als `revoked` markiert.
 */
export function createGoogleAccounts(deps: {
	db: Db;
	bus: EventBus;
	crypto: Crypto;
	oauth: OAuth;
	fetch?: typeof fetch;
}) {
	const tokens = new Map<number, { accessToken: string; expiresAt: number }>();

	async function token(accountId: number, force = false): Promise<string> {
		const cached = tokens.get(accountId);
		if (!force && cached && cached.expiresAt - 60_000 > Date.now()) return cached.accessToken;
		const acc = getAccount(deps.db, accountId);
		if (!acc || acc.status !== 'ok') throw new GoogleError(401, 'account revoked');
		try {
			const t = await deps.oauth.refresh(deps.crypto.decrypt(acc.refresh_token_enc));
			tokens.set(accountId, t);
			return t.accessToken;
		} catch (err) {
			if (err instanceof GoogleError && err.reason === 'invalid_grant') {
				setAccountStatus(deps.db, accountId, 'revoked');
				deps.bus.publish({ type: 'calendars.changed' });
			}
			throw err;
		}
	}

	return {
		apiFor(accountId: number): CalendarApi {
			return createCalendarApi((force) => token(accountId, force), deps.fetch);
		},
		/** Client für einen frisch erhaltenen Access-Token (direkt nach dem OAuth-Callback). */
		apiWithToken(accessToken: string): CalendarApi {
			return createCalendarApi(async () => accessToken, deps.fetch);
		},
		remember(accountId: number, t: { accessToken: string; expiresAt: number }) {
			tokens.set(accountId, t);
		},
		forget(accountId: number) {
			tokens.delete(accountId);
		}
	};
}

export type GoogleAccounts = ReturnType<typeof createGoogleAccounts>;
