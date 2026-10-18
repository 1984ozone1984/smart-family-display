import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db/index.ts';
import type { Via } from './access.ts';

export const SESSION_COOKIE = 'kz_session';

export type Role = 'parent' | 'child';
export type SessionPerson = { id: number; name: string; role: Role };

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function createSession(db: Db, personId: number, via: Via, ttlMs: number) {
	const token = randomBytes(32).toString('base64url');
	const expiresAt = new Date(Date.now() + ttlMs);
	db.prepare('INSERT INTO session (id, person_id, via, expires_at) VALUES (?, ?, ?, ?)').run(
		sha256(token),
		personId,
		via,
		expiresAt.toISOString()
	);
	return { token, expiresAt };
}

/** Liefert die Person zur Session; eine Session gilt nur auf dem Weg (LAN/öffentlich), auf dem sie entstand. */
export function findSession(db: Db, token: string, via: Via): SessionPerson | null {
	const row = db
		.prepare(
			`SELECT p.id, p.name, p.role FROM session s JOIN person p ON p.id = s.person_id
			 WHERE s.id = ? AND s.via = ? AND s.expires_at > ?`
		)
		.get(sha256(token), via, new Date().toISOString());
	if (!row) return null;
	return { id: Number(row.id), name: String(row.name), role: row.role as Role };
}

export function deleteSession(db: Db, token: string) {
	db.prepare('DELETE FROM session WHERE id = ?').run(sha256(token));
}

export function purgeExpiredSessions(db: Db) {
	db.prepare('DELETE FROM session WHERE expires_at <= ?').run(new Date().toISOString());
}
