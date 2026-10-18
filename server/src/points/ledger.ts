import type { Db } from '../db/index.ts';

export type RefType = 'task' | 'bonus' | 'redemption';
export type LedgerEntry = {
	id: number;
	personId: number;
	delta: number;
	reason: string;
	refType: RefType;
	refId: number | null;
	createdBy: number | null;
	createdAt: string;
};

/**
 * Einzige Stelle, die Punkte bucht. Das Ledger ist append-only (per Trigger abgesichert);
 * Korrekturen sind Gegenbuchungen.
 */
export function book(
	db: Db,
	e: {
		personId: number;
		delta: number;
		reason: string;
		refType: RefType;
		refId?: number | null;
		createdBy?: number | null;
	}
): number {
	const r = db
		.prepare(
			'INSERT INTO points_ledger (person_id, delta, reason, ref_type, ref_id, created_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING id'
		)
		.get(e.personId, e.delta, e.reason, e.refType, e.refId ?? null, e.createdBy ?? null);
	return Number(r!.id);
}

export function balance(db: Db, personId: number): number {
	return Number(
		db
			.prepare('SELECT COALESCE(SUM(delta), 0) AS b FROM points_ledger WHERE person_id = ?')
			.get(personId)!.b
	);
}

export function balances(db: Db): Map<number, number> {
	const rows = db
		.prepare(
			'SELECT p.id, COALESCE(SUM(l.delta), 0) AS b FROM person p LEFT JOIN points_ledger l ON l.person_id = p.id GROUP BY p.id'
		)
		.all();
	return new Map(rows.map((r) => [Number(r.id), Number(r.b)]));
}

export function history(db: Db, personId: number, limit = 50): LedgerEntry[] {
	return db
		.prepare('SELECT * FROM points_ledger WHERE person_id = ? ORDER BY id DESC LIMIT ?')
		.all(personId, limit)
		.map((r) => ({
			id: Number(r.id),
			personId: Number(r.person_id),
			delta: Number(r.delta),
			reason: String(r.reason),
			refType: r.ref_type as RefType,
			refId: r.ref_id == null ? null : Number(r.ref_id),
			createdBy: r.created_by == null ? null : Number(r.created_by),
			createdAt: String(r.created_at)
		}));
}

/** Bisher für eine Aufgabe an eine Person gebuchte Punkte (netto). */
function taskNet(db: Db, taskId: number, personId: number): number {
	return Number(
		db
			.prepare(
				"SELECT COALESCE(SUM(delta), 0) AS n FROM points_ledger WHERE ref_type = 'task' AND ref_id = ? AND person_id = ?"
			)
			.get(taskId, personId)!.n
	);
}

/**
 * Bringt die Punkte für (Aufgabe, Person) auf `target` (Punkte der Aufgabe oder 0) – durch die
 * Differenz als Buchung bzw. Gegenbuchung. Mehrfaches Abhaken bucht dadurch nie doppelt.
 */
export function settleTask(
	db: Db,
	t: { taskId: number; personId: number; target: number; title: string; by: number | null }
) {
	const diff = t.target - taskNet(db, t.taskId, t.personId);
	if (diff === 0) return;
	book(db, {
		personId: t.personId,
		delta: diff,
		reason: diff > 0 ? `Aufgabe: ${t.title}` : `Rückgängig: ${t.title}`,
		refType: 'task',
		refId: t.taskId,
		createdBy: t.by
	});
}
