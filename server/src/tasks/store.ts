import type { Db } from '../db/index.ts';

export type Slot = 'morning' | 'afternoon' | 'evening';
export type AssigneeStatus = 'open' | 'done' | 'approved';

export type TaskRow = {
	id: number;
	title: string;
	icon: string | null;
	available_from: string | null;
	due_date: string | null;
	time_slot: Slot | null;
	points: number;
	requires_approval: boolean;
	routine_id: number | null;
	created_by: number | null;
};

export type Assignee = {
	task_id: number;
	person_id: number;
	status: AssigneeStatus;
	done_at: string | null;
};

export type RoutineRow = {
	id: number;
	title: string;
	icon: string | null;
	schedule: string;
	time_slot: Slot;
	points: number;
	requires_approval: boolean;
	active: boolean;
};

type Raw = Record<string, unknown>;
const str = (v: unknown) => (v == null ? null : String(v));

function task(r: Raw | undefined): TaskRow | null {
	if (!r) return null;
	return {
		id: Number(r.id),
		title: String(r.title),
		icon: str(r.icon),
		available_from: str(r.available_from),
		due_date: str(r.due_date),
		time_slot: (r.time_slot ?? null) as Slot | null,
		points: Number(r.points),
		requires_approval: Boolean(r.requires_approval),
		routine_id: r.routine_id == null ? null : Number(r.routine_id),
		created_by: r.created_by == null ? null : Number(r.created_by)
	};
}

function routine(r: Raw | undefined): RoutineRow | null {
	if (!r) return null;
	return {
		id: Number(r.id),
		title: String(r.title),
		icon: str(r.icon),
		schedule: String(r.schedule),
		time_slot: r.time_slot as Slot,
		points: Number(r.points),
		requires_approval: Boolean(r.requires_approval),
		active: Boolean(r.active)
	};
}

/** Führt `fn` in einer Transaktion aus (node:sqlite ist synchron, daher ohne await dazwischen). */
export function tx<T>(db: Db, fn: () => T): T {
	db.exec('BEGIN');
	try {
		const r = fn();
		db.exec('COMMIT');
		return r;
	} catch (err) {
		db.exec('ROLLBACK');
		throw err;
	}
}

// --- Aufgaben ---

export type TaskInput = {
	title: string;
	icon: string | null;
	dueDate: string | null;
	timeSlot: Slot | null;
	points: number;
	requiresApproval: boolean;
};

export function insertTask(
	db: Db,
	t: TaskInput,
	assignees: number[],
	createdBy: number | null
): TaskRow {
	return tx(db, () => {
		const row = task(
			db
				.prepare(
					`INSERT INTO task (title, icon, due_date, time_slot, points, requires_approval, created_by)
					 VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`
				)
				.get(
					t.title,
					t.icon,
					t.dueDate,
					t.timeSlot,
					t.points,
					t.requiresApproval ? 1 : 0,
					createdBy
				)
		)!;
		setTaskAssignees(db, row.id, assignees);
		return row;
	});
}

export function updateTask(db: Db, id: number, t: Partial<TaskInput>, assignees?: number[]) {
	tx(db, () => {
		const cols: [string, unknown][] = [];
		if (t.title !== undefined) cols.push(['title', t.title]);
		if (t.icon !== undefined) cols.push(['icon', t.icon]);
		if (t.dueDate !== undefined) cols.push(['due_date', t.dueDate]);
		if (t.timeSlot !== undefined) cols.push(['time_slot', t.timeSlot]);
		if (t.points !== undefined) cols.push(['points', t.points]);
		if (t.requiresApproval !== undefined)
			cols.push(['requires_approval', t.requiresApproval ? 1 : 0]);
		if (cols.length)
			db.prepare(`UPDATE task SET ${cols.map(([c]) => `${c} = ?`).join(', ')} WHERE id = ?`).run(
				...(cols.map(([, v]) => v) as (string | number | null)[]),
				id
			);
		if (assignees) setTaskAssignees(db, id, assignees);
	});
}

/** Ersetzt die Zuständigen; der Status bleibt für Personen erhalten, die weiter zuständig sind. */
function setTaskAssignees(db: Db, taskId: number, personIds: number[]) {
	const keep = new Set(personIds);
	for (const a of assigneesOf(db, [taskId]))
		if (!keep.has(a.person_id))
			db.prepare('DELETE FROM task_assignee WHERE task_id = ? AND person_id = ?').run(
				taskId,
				a.person_id
			);
	const ins = db.prepare('INSERT OR IGNORE INTO task_assignee (task_id, person_id) VALUES (?, ?)');
	for (const p of keep) ins.run(taskId, p);
}

export function deleteTask(db: Db, id: number) {
	db.prepare('DELETE FROM task WHERE id = ?').run(id);
}

export const getTask = (db: Db, id: number) =>
	task(db.prepare('SELECT * FROM task WHERE id = ?').get(id));

export function assigneesOf(db: Db, taskIds: number[]): Assignee[] {
	if (taskIds.length === 0) return [];
	return db
		.prepare(`SELECT * FROM task_assignee WHERE task_id IN (${taskIds.map(() => '?').join(',')})`)
		.all(...taskIds)
		.map((r) => ({
			task_id: Number(r.task_id),
			person_id: Number(r.person_id),
			status: r.status as AssigneeStatus,
			done_at: str(r.done_at)
		}));
}

export function setStatus(db: Db, taskId: number, personId: number, status: AssigneeStatus) {
	db.prepare(
		`UPDATE task_assignee SET status = ?,
		   done_at = CASE WHEN ? = 'open' THEN NULL ELSE COALESCE(done_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')) END
		 WHERE task_id = ? AND person_id = ?`
	).run(status, status, taskId, personId);
}

/**
 * Aufgaben, die an `date` angezeigt werden:
 * - aus Routinen: im Zeitraum available_from … due_date (danach verfallen sie)
 * - einmalig mit Datum `date`
 * - nur für heute zusätzlich: einmalige ohne Datum oder überfällige, solange jemand offen ist
 *   oder sie heute erledigt wurden (damit das Häkchen bis zum Abend sichtbar bleibt)
 */
export function tasksForDate(
	db: Db,
	date: string,
	today: string,
	todayStartUtc: string
): TaskRow[] {
	return db
		.prepare(
			`SELECT t.* FROM task t WHERE
			   (t.available_from IS NOT NULL AND t.available_from <= :date AND t.due_date >= :date)
			   OR (t.available_from IS NULL AND t.due_date = :date)
			   OR (:date = :today AND t.available_from IS NULL AND (t.due_date IS NULL OR t.due_date < :today)
			       AND EXISTS (SELECT 1 FROM task_assignee a WHERE a.task_id = t.id
			                   AND (a.status = 'open' OR a.done_at >= :start)))
			 ORDER BY CASE t.time_slot WHEN 'morning' THEN 1 WHEN 'afternoon' THEN 2 WHEN 'evening' THEN 3 ELSE 4 END, t.id`
		)
		.all({ date, today, start: todayStartUtc })
		.map((r) => task(r)!);
}

/** Erledigt, aber noch nicht von Eltern bestätigt */
export function pendingApprovals(
	db: Db
): { task: TaskRow; personId: number; doneAt: string | null }[] {
	return db
		.prepare(
			`SELECT t.*, a.person_id AS a_person, a.done_at AS a_done FROM task t
			 JOIN task_assignee a ON a.task_id = t.id
			 WHERE t.requires_approval = 1 AND a.status = 'done' ORDER BY a.done_at`
		)
		.all()
		.map((r) => ({ task: task(r)!, personId: Number(r.a_person), doneAt: str(r.a_done) }));
}

// --- Routinen ---

export type RoutineInput = {
	title: string;
	icon: string | null;
	schedule: string;
	timeSlot: Slot;
	points: number;
	requiresApproval: boolean;
	active: boolean;
};

export const listRoutines = (db: Db) =>
	db
		.prepare('SELECT * FROM routine ORDER BY active DESC, title')
		.all()
		.map((r) => routine(r)!);

export const getRoutine = (db: Db, id: number) =>
	routine(db.prepare('SELECT * FROM routine WHERE id = ?').get(id));

export function routineAssignees(db: Db, routineId: number): number[] {
	return db
		.prepare('SELECT person_id FROM routine_assignee WHERE routine_id = ? ORDER BY person_id')
		.all(routineId)
		.map((r) => Number(r.person_id));
}

export function insertRoutine(
	db: Db,
	r: RoutineInput,
	assignees: number[],
	createdBy: number | null
): RoutineRow {
	return tx(db, () => {
		const row = routine(
			db
				.prepare(
					`INSERT INTO routine (title, icon, schedule, time_slot, points, requires_approval, active, created_by)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
				)
				.get(
					r.title,
					r.icon,
					r.schedule,
					r.timeSlot,
					r.points,
					r.requiresApproval ? 1 : 0,
					r.active ? 1 : 0,
					createdBy
				)
		)!;
		setRoutineAssignees(db, row.id, assignees);
		return row;
	});
}

export function updateRoutine(db: Db, id: number, r: Partial<RoutineInput>, assignees?: number[]) {
	tx(db, () => {
		const map: [keyof RoutineInput, string][] = [
			['title', 'title'],
			['icon', 'icon'],
			['schedule', 'schedule'],
			['timeSlot', 'time_slot'],
			['points', 'points'],
			['requiresApproval', 'requires_approval'],
			['active', 'active']
		];
		const cols = map
			.filter(([k]) => r[k] !== undefined)
			.map(([k, c]) => [c, typeof r[k] === 'boolean' ? (r[k] ? 1 : 0) : r[k]] as const);
		if (cols.length)
			db.prepare(`UPDATE routine SET ${cols.map(([c]) => `${c} = ?`).join(', ')} WHERE id = ?`).run(
				...(cols.map(([, v]) => v) as (string | number | null)[]),
				id
			);
		if (assignees) setRoutineAssignees(db, id, assignees);
	});
}

function setRoutineAssignees(db: Db, routineId: number, personIds: number[]) {
	db.prepare('DELETE FROM routine_assignee WHERE routine_id = ?').run(routineId);
	const ins = db.prepare('INSERT INTO routine_assignee (routine_id, person_id) VALUES (?, ?)');
	for (const p of new Set(personIds)) ins.run(routineId, p);
}
