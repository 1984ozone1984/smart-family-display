import type { Db } from '../db/index.ts';
import type { GCalendar } from '../google/calendar-api.ts';

export type AccountRow = {
	id: number;
	person_id: number;
	email: string;
	refresh_token_enc: string;
	status: 'ok' | 'revoked';
};

export type SourceRow = {
	id: number;
	account_id: number;
	remote_id: string;
	summary: string;
	color: string | null;
	person_id: number | null;
	enabled: boolean;
	writable: boolean;
	sync_token: string | null;
	full_synced_at: string | null;
	last_synced_at: string | null;
	last_error: string | null;
};

export type LocalEvent = {
	remote_id: string;
	recurring_id: string | null;
	etag: string;
	title: string;
	description: string | null;
	location: string | null;
	start: string;
	end: string;
	all_day: boolean;
	range_start: string;
	range_end: string;
	updated_at: string;
};

export type EventRow = LocalEvent & { id: number; source_id: number; created_by: number | null };

type Raw = Record<string, unknown>;
const str = (v: unknown) => (v == null ? null : String(v));

function account(r: Raw | undefined): AccountRow | null {
	if (!r) return null;
	return {
		id: Number(r.id),
		person_id: Number(r.person_id),
		email: String(r.email),
		refresh_token_enc: String(r.refresh_token_enc),
		status: r.status as AccountRow['status']
	};
}

function source(r: Raw | undefined): SourceRow | null {
	if (!r) return null;
	return {
		id: Number(r.id),
		account_id: Number(r.account_id),
		remote_id: String(r.remote_id),
		summary: String(r.summary),
		color: str(r.color),
		person_id: r.person_id == null ? null : Number(r.person_id),
		enabled: Boolean(r.enabled),
		writable: Boolean(r.writable),
		sync_token: str(r.sync_token),
		full_synced_at: str(r.full_synced_at),
		last_synced_at: str(r.last_synced_at),
		last_error: str(r.last_error)
	};
}

function event(r: Raw | undefined): EventRow | null {
	if (!r) return null;
	return {
		id: Number(r.id),
		source_id: Number(r.source_id),
		remote_id: String(r.remote_id),
		recurring_id: str(r.recurring_id),
		etag: String(r.etag),
		title: String(r.title),
		description: str(r.description),
		location: str(r.location),
		start: String(r.start),
		end: String(r.end),
		all_day: Boolean(r.all_day),
		range_start: String(r.range_start),
		range_end: String(r.range_end),
		created_by: r.created_by == null ? null : Number(r.created_by),
		updated_at: String(r.updated_at)
	};
}

// --- Konten ---

export function upsertAccount(
	db: Db,
	a: { personId: number; email: string; refreshTokenEnc: string }
): AccountRow {
	const r = db
		.prepare(
			`INSERT INTO google_account (person_id, email, refresh_token_enc) VALUES (?, ?, ?)
			 ON CONFLICT (email) DO UPDATE SET person_id = excluded.person_id,
			   refresh_token_enc = excluded.refresh_token_enc, status = 'ok'
			 RETURNING *`
		)
		.get(a.personId, a.email, a.refreshTokenEnc);
	return account(r)!;
}

export const getAccount = (db: Db, id: number) =>
	account(db.prepare('SELECT * FROM google_account WHERE id = ?').get(id));

export const listAccounts = (db: Db) =>
	db
		.prepare('SELECT * FROM google_account ORDER BY id')
		.all()
		.map((r) => account(r)!);

export function setAccountStatus(db: Db, id: number, status: AccountRow['status']) {
	db.prepare('UPDATE google_account SET status = ? WHERE id = ?').run(status, id);
}

export function deleteAccount(db: Db, id: number) {
	db.prepare('DELETE FROM google_account WHERE id = ?').run(id);
}

// --- Kalender ---

const canWrite = (c: GCalendar) => c.accessRole === 'owner' || c.accessRole === 'writer';

/**
 * Übernimmt die Kalenderliste eines Kontos. Kennt die App einen Kalender schon über ein anderes
 * Konto (geteilter Familienkalender), bleibt es bei einer Quelle; sie wechselt nur zu diesem
 * Konto, wenn es schreiben darf und das bisherige nicht.
 * Neu: der Hauptkalender ist aktiv und der Person zugeordnet, alle anderen erst einmal aus.
 */
export function discoverSources(db: Db, accountId: number, personId: number, cals: GCalendar[]) {
	const find = db.prepare('SELECT * FROM calendar_source WHERE remote_id = ?');
	const insert = db.prepare(
		`INSERT INTO calendar_source (account_id, remote_id, summary, color, person_id, enabled, writable)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`
	);
	const update = db.prepare(
		'UPDATE calendar_source SET account_id = ?, summary = ?, writable = ? WHERE id = ?'
	);
	for (const c of cals) {
		if (c.accessRole === 'freeBusyReader') continue;
		const name = c.summaryOverride ?? c.summary;
		const existing = source(find.get(c.id));
		if (!existing) {
			insert.run(
				accountId,
				c.id,
				name,
				c.backgroundColor ?? null,
				c.primary ? personId : null,
				c.primary ? 1 : 0,
				canWrite(c) ? 1 : 0
			);
		} else if (existing.account_id === accountId || (!existing.writable && canWrite(c))) {
			update.run(accountId, name, canWrite(c) ? 1 : 0, existing.id);
		}
	}
}

export const listSources = (db: Db) =>
	db
		.prepare('SELECT * FROM calendar_source ORDER BY person_id IS NULL DESC, person_id, summary')
		.all()
		.map((r) => source(r)!);

export const getSource = (db: Db, id: number) =>
	source(db.prepare('SELECT * FROM calendar_source WHERE id = ?').get(id));

export function updateSource(
	db: Db,
	id: number,
	patch: { personId?: number | null; enabled?: boolean }
) {
	if (patch.personId !== undefined)
		db.prepare('UPDATE calendar_source SET person_id = ? WHERE id = ?').run(patch.personId, id);
	if (patch.enabled !== undefined) {
		// Aus- und wieder Einschalten erzwingt einen vollständigen Abgleich
		db.prepare(
			'UPDATE calendar_source SET enabled = ?, sync_token = NULL, full_synced_at = NULL WHERE id = ?'
		).run(patch.enabled ? 1 : 0, id);
		if (!patch.enabled) db.prepare('DELETE FROM event WHERE source_id = ?').run(id);
	}
}

export function setSyncState(
	db: Db,
	id: number,
	s: { syncToken: string | null; at: Date; full?: boolean; error?: string | null }
) {
	const now = s.at.toISOString();
	db.prepare(
		`UPDATE calendar_source SET sync_token = ?, last_synced_at = ?, last_error = ?,
		   full_synced_at = CASE WHEN ? THEN ? ELSE full_synced_at END WHERE id = ?`
	).run(s.syncToken, now, s.error ?? null, s.full ? 1 : 0, now, id);
}

export function setSyncError(db: Db, id: number, error: string) {
	db.prepare('UPDATE calendar_source SET last_error = ? WHERE id = ?').run(error, id);
}

// --- Termine ---

/** Legt an oder aktualisiert; `created_by` bleibt bei Aktualisierungen erhalten. Liefert true bei Änderung. */
export function upsertEvent(db: Db, sourceId: number, e: LocalEvent, createdBy?: number): boolean {
	const prev = db
		.prepare('SELECT etag FROM event WHERE source_id = ? AND remote_id = ?')
		.get(sourceId, e.remote_id);
	if (prev && prev.etag === e.etag) return false;
	db.prepare(
		`INSERT INTO event (source_id, remote_id, recurring_id, etag, title, description, location,
		   start, end, all_day, range_start, range_end, created_by, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT (source_id, remote_id) DO UPDATE SET recurring_id = excluded.recurring_id,
		   etag = excluded.etag, title = excluded.title, description = excluded.description,
		   location = excluded.location, start = excluded.start, end = excluded.end,
		   all_day = excluded.all_day, range_start = excluded.range_start,
		   range_end = excluded.range_end, updated_at = excluded.updated_at`
	).run(
		sourceId,
		e.remote_id,
		e.recurring_id,
		e.etag,
		e.title,
		e.description,
		e.location,
		e.start,
		e.end,
		e.all_day ? 1 : 0,
		e.range_start,
		e.range_end,
		createdBy ?? null,
		e.updated_at
	);
	return true;
}

export function deleteEventByRemote(db: Db, sourceId: number, remoteId: string): boolean {
	return (
		Number(
			db.prepare('DELETE FROM event WHERE source_id = ? AND remote_id = ?').run(sourceId, remoteId)
				.changes
		) > 0
	);
}

/** Vollabgleich: alles aus `events` übernehmen, lokal Fehlendes löschen. Liefert true bei Änderung. */
export function replaceEvents(db: Db, sourceId: number, events: LocalEvent[]): boolean {
	let changed = false;
	db.exec('BEGIN');
	try {
		const keep = new Set(events.map((e) => e.remote_id));
		for (const e of events) changed = upsertEvent(db, sourceId, e) || changed;
		const existing = db.prepare('SELECT remote_id FROM event WHERE source_id = ?').all(sourceId);
		for (const r of existing) {
			if (!keep.has(String(r.remote_id)))
				changed = deleteEventByRemote(db, sourceId, String(r.remote_id)) || changed;
		}
		db.exec('COMMIT');
	} catch (err) {
		db.exec('ROLLBACK');
		throw err;
	}
	return changed;
}

export const getEvent = (db: Db, id: number) =>
	event(db.prepare('SELECT * FROM event WHERE id = ?').get(id));

export const getEventByRemote = (db: Db, sourceId: number, remoteId: string) =>
	event(
		db.prepare('SELECT * FROM event WHERE source_id = ? AND remote_id = ?').get(sourceId, remoteId)
	);

/** Termine aktiver Kalender, die sich mit [from, to) überschneiden. */
export function eventsInRange(db: Db, from: string, to: string) {
	return db
		.prepare(
			`SELECT e.* FROM event e JOIN calendar_source s ON s.id = e.source_id
			 WHERE s.enabled = 1 AND e.range_start < ? AND e.range_end > ?
			 ORDER BY e.all_day DESC, e.range_start`
		)
		.all(to, from)
		.map((r) => event(r)!);
}
