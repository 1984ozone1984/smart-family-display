import { hash, verify } from '@node-rs/argon2';

export const PIN_PATTERN = /^\d{4}$/;

export function hashPin(pin: string): Promise<string> {
	return hash(pin);
}

export async function verifyPin(pinHash: string, pin: string): Promise<boolean> {
	try {
		return await verify(pinHash, pin);
	} catch {
		return false;
	}
}

/**
 * Sperrt nach `maxFailures` Fehlversuchen innerhalb des Fensters für `lockMs`.
 * Gezählt wird pro Schlüssel (Person und Quell-IP getrennt), damit weder eine Person
 * von außen gesperrt noch eine PIN von einem Gerät aus durchprobiert werden kann.
 */
export function createLockout(opts = { maxFailures: 5, lockMs: 5 * 60_000 }, now = Date.now) {
	const state = new Map<string, { failures: number; lockedUntil: number }>();

	return {
		/** Restsperre in ms, 0 = frei */
		lockedFor(keys: string[]): number {
			const t = now();
			return Math.max(0, ...keys.map((k) => (state.get(k)?.lockedUntil ?? 0) - t));
		},
		fail(keys: string[]) {
			for (const k of keys) {
				const s = state.get(k) ?? { failures: 0, lockedUntil: 0 };
				if (s.lockedUntil && s.lockedUntil <= now()) s.failures = 0;
				s.failures++;
				if (s.failures >= opts.maxFailures) s.lockedUntil = now() + opts.lockMs;
				state.set(k, s);
			}
		},
		succeed(keys: string[]) {
			for (const k of keys) state.delete(k);
		}
	};
}

export type Lockout = ReturnType<typeof createLockout>;
