import type { Db } from '../db/index.ts';
import { AppError } from '../errors.ts';
import { tx } from '../tasks/store.ts';

export type ListRow = { id: number; title: string; icon: string | null; sort: number };
export type ItemRow = { id: number; list_id: number; text: string; done: boolean; sort: number };

type Raw = Record<string, unknown>;

function list(r: Raw | undefined): ListRow | null {
	if (!r) return null;
	return {
		id: Number(r.id),
		title: String(r.title),
		icon: r.icon == null ? null : String(r.icon),
		sort: Number(r.sort)
	};
}

function item(r: Raw | undefined): ItemRow | null {
	if (!r) return null;
	return {
		id: Number(r.id),
		list_id: Number(r.list_id),
		text: String(r.text),
		done: Number(r.done) === 1,
		sort: Number(r.sort)
	};
}

/** Verschiebt `id` innerhalb von `ids` (aktuelle Reihenfolge) an `position` und nummeriert neu. */
function reorder(db: Db, table: 'list' | 'list_item', ids: number[], id: number, position: number) {
	const rest = ids.filter((x) => x !== id);
	rest.splice(Math.max(0, Math.min(position, rest.length)), 0, id);
	const set = db.prepare(`UPDATE ${table} SET sort = ? WHERE id = ?`);
	rest.forEach((x, i) => set.run(i, x));
}

// --- Listen ---

export function listLists(db: Db): ListRow[] {
	return db
		.prepare('SELECT * FROM list ORDER BY sort, id')
		.all()
		.map((r) => list(r)!);
}

export function getList(db: Db, id: number): ListRow | null {
	return list(db.prepare('SELECT * FROM list WHERE id = ?').get(id));
}

export function insertList(db: Db, l: { title: string; icon: string | null }): ListRow {
	return list(
		db
			.prepare(
				'INSERT INTO list (title, icon, sort) VALUES (?, ?, (SELECT COALESCE(MAX(sort) + 1, 0) FROM list)) RETURNING *'
			)
			.get(l.title, l.icon)
	)!;
}

export function updateList(
	db: Db,
	id: number,
	l: { title?: string; icon?: string | null; position?: number }
) {
	tx(db, () => {
		if (!getList(db, id)) throw new AppError(404, 'not found');
		if (l.title !== undefined)
			db.prepare('UPDATE list SET title = ? WHERE id = ?').run(l.title, id);
		if (l.icon !== undefined) db.prepare('UPDATE list SET icon = ? WHERE id = ?').run(l.icon, id);
		if (l.position !== undefined)
			reorder(
				db,
				'list',
				listLists(db).map((x) => x.id),
				id,
				l.position
			);
	});
}

export function deleteList(db: Db, id: number) {
	if (db.prepare('DELETE FROM list WHERE id = ?').run(id).changes === 0)
		throw new AppError(404, 'not found');
}

// --- Einträge ---

export function listItems(db: Db, listId?: number): ItemRow[] {
	const rows =
		listId === undefined
			? db.prepare('SELECT * FROM list_item ORDER BY list_id, sort, id').all()
			: db.prepare('SELECT * FROM list_item WHERE list_id = ? ORDER BY sort, id').all(listId);
	return rows.map((r) => item(r)!);
}

function getItem(db: Db, listId: number, id: number): ItemRow | null {
	return item(db.prepare('SELECT * FROM list_item WHERE id = ? AND list_id = ?').get(id, listId));
}

/** Neue Einträge kommen ans Ende der Liste. */
export function insertItem(db: Db, listId: number, text: string): ItemRow {
	if (!getList(db, listId)) throw new AppError(404, 'not found');
	return item(
		db
			.prepare(
				`INSERT INTO list_item (list_id, text, sort)
				 VALUES (?, ?, (SELECT COALESCE(MAX(sort) + 1, 0) FROM list_item WHERE list_id = ?)) RETURNING *`
			)
			.get(listId, text, listId)
	)!;
}

export function updateItem(
	db: Db,
	listId: number,
	id: number,
	i: { text?: string; done?: boolean; position?: number }
) {
	tx(db, () => {
		if (!getItem(db, listId, id)) throw new AppError(404, 'not found');
		if (i.text !== undefined)
			db.prepare('UPDATE list_item SET text = ? WHERE id = ?').run(i.text, id);
		if (i.done !== undefined)
			db.prepare('UPDATE list_item SET done = ? WHERE id = ?').run(i.done ? 1 : 0, id);
		if (i.position !== undefined)
			reorder(
				db,
				'list_item',
				listItems(db, listId).map((x) => x.id),
				id,
				i.position
			);
	});
}

export function deleteItem(db: Db, listId: number, id: number) {
	const r = db.prepare('DELETE FROM list_item WHERE id = ? AND list_id = ?').run(id, listId);
	if (r.changes === 0) throw new AppError(404, 'not found');
}

/** Entfernt alle abgehakten Einträge; liefert ihre Anzahl. */
export function clearDone(db: Db, listId: number): number {
	if (!getList(db, listId)) throw new AppError(404, 'not found');
	return Number(
		db.prepare('DELETE FROM list_item WHERE list_id = ? AND done = 1').run(listId).changes
	);
}
