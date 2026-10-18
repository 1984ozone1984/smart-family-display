import type { Role } from './auth/session.ts';
import type { Db } from './db/index.ts';

export type PersonRow = {
	id: number;
	name: string;
	color: string;
	avatar_path: string | null;
	role: Role;
	pin_hash: string;
	email: string | null;
	updated_at: string;
};

export type PersonDto = {
	id: number;
	name: string;
	color: string;
	role: Role;
	avatarUrl: string | null;
	email?: string | null;
};

function row(r: Record<string, unknown> | undefined): PersonRow | null {
	if (!r) return null;
	return {
		id: Number(r.id),
		name: String(r.name),
		color: String(r.color),
		avatar_path: r.avatar_path == null ? null : String(r.avatar_path),
		role: r.role as Role,
		pin_hash: String(r.pin_hash),
		email: r.email == null ? null : String(r.email),
		updated_at: String(r.updated_at)
	};
}

/** Öffentliche Sicht einer Person; E-Mail nur für Eltern. */
export function toDto(p: PersonRow, viewerIsParent: boolean): PersonDto {
	const dto: PersonDto = {
		id: p.id,
		name: p.name,
		color: p.color,
		role: p.role,
		avatarUrl: p.avatar_path
			? `/api/v1/avatars/${p.avatar_path}?v=${encodeURIComponent(p.updated_at)}`
			: null
	};
	if (viewerIsParent) dto.email = p.email;
	return dto;
}

export function listPersons(db: Db): PersonRow[] {
	return db
		.prepare('SELECT * FROM person ORDER BY role DESC, id')
		.all()
		.map((r) => row(r)!);
}

export function getPerson(db: Db, id: number): PersonRow | null {
	return row(db.prepare('SELECT * FROM person WHERE id = ?').get(id));
}

export function countPersons(db: Db): number {
	return Number(db.prepare('SELECT COUNT(*) AS n FROM person').get()?.n ?? 0);
}

export function countParents(db: Db): number {
	return Number(db.prepare("SELECT COUNT(*) AS n FROM person WHERE role = 'parent'").get()?.n ?? 0);
}

export function insertPerson(
	db: Db,
	p: { name: string; color: string; role: Role; pinHash: string; email: string | null }
): PersonRow {
	const r = db
		.prepare(
			'INSERT INTO person (name, color, role, pin_hash, email) VALUES (?, ?, ?, ?, ?) RETURNING *'
		)
		.get(p.name, p.color, p.role, p.pinHash, p.email);
	return row(r)!;
}

const PATCHABLE = ['name', 'color', 'role', 'pin_hash', 'email', 'avatar_path'] as const;
type Patch = Partial<Pick<PersonRow, (typeof PATCHABLE)[number]>>;

export function updatePerson(db: Db, id: number, patch: Patch): PersonRow | null {
	const keys = PATCHABLE.filter((k) => patch[k] !== undefined);
	if (keys.length === 0) return getPerson(db, id);
	const sets = keys.map((k) => `${k} = ?`).join(', ');
	const r = db
		.prepare(
			`UPDATE person SET ${sets}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? RETURNING *`
		)
		.get(...keys.map((k) => patch[k] ?? null), id);
	return row(r);
}
