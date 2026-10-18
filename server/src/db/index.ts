import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

const MIGRATIONS_DIR = join(import.meta.dirname, 'migrations');

export function openDb(file: string): Db {
	const db = new DatabaseSync(file);
	db.exec('PRAGMA journal_mode = WAL');
	db.exec('PRAGMA foreign_keys = ON');
	db.exec('PRAGMA busy_timeout = 5000');
	return db;
}

/** Spielt alle noch nicht angewendeten `NNN_name.sql` in Reihenfolge ein, jede in einer Transaktion. */
export function migrate(db: Db, dir = MIGRATIONS_DIR): string[] {
	db.exec(`CREATE TABLE IF NOT EXISTS schema_migration (
		version TEXT PRIMARY KEY,
		applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
	)`);
	const applied = new Set(
		db
			.prepare('SELECT version FROM schema_migration')
			.all()
			.map((r) => String(r.version))
	);
	const files = readdirSync(dir)
		.filter((f) => /^\d{3}_.+\.sql$/.test(f))
		.sort();

	const ran: string[] = [];
	for (const file of files) {
		if (applied.has(file)) continue;
		const sql = readFileSync(join(dir, file), 'utf8');
		db.exec('BEGIN');
		try {
			db.exec(sql);
			db.prepare('INSERT INTO schema_migration (version) VALUES (?)').run(file);
			db.exec('COMMIT');
		} catch (err) {
			db.exec('ROLLBACK');
			throw new Error(`Migration ${file} fehlgeschlagen: ${String(err)}`, { cause: err });
		}
		ran.push(file);
	}
	return ran;
}
