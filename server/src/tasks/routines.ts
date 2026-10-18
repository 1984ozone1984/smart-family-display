import { z } from 'zod';
import type { Db } from '../db/index.ts';
import { addDays, isoWeekday, weekStart } from '../time.ts';
import { listRoutines, routineAssignees, tx, type RoutineRow } from './store.ts';

export const scheduleSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('daily') }),
	z.object({
		type: z.literal('weekdays'),
		days: z.array(z.number().int().min(1).max(7)).min(1).max(7)
	}),
	// Einmal pro Woche, an einem beliebigen Tag Mo–So zu erledigen
	z.object({ type: z.literal('weekly') })
]);
export type Schedule = z.infer<typeof scheduleSchema>;

/** Zeitraum der Aufgabe, die `s` an `today` erzeugt – oder null, wenn heute nichts fällig ist. */
export function occurrence(s: Schedule, today: string): { from: string; due: string } | null {
	switch (s.type) {
		case 'daily':
			return { from: today, due: today };
		case 'weekdays':
			return s.days.includes(isoWeekday(today)) ? { from: today, due: today } : null;
		case 'weekly': {
			const monday = weekStart(today);
			return { from: monday, due: addDays(monday, 6) };
		}
	}
}

function parseSchedule(r: RoutineRow): Schedule | null {
	try {
		return scheduleSchema.parse(JSON.parse(r.schedule));
	} catch {
		return null;
	}
}

/**
 * Legt für alle aktiven Routinen die heute fällige Aufgabe an. Idempotent: pro Routine und
 * Fälligkeitstag höchstens eine Aufgabe (UNIQUE), mehrfaches Ausführen erzeugt nichts doppelt.
 * Liefert die Anzahl neu erzeugter Aufgaben.
 */
export function generateRoutineTasks(db: Db, today: string, only?: number): number {
	let created = 0;
	const insert = db.prepare(
		`INSERT INTO task (title, icon, available_from, due_date, time_slot, points, requires_approval, routine_id, created_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
		 ON CONFLICT (routine_id, due_date) DO NOTHING RETURNING id`
	);
	const assign = db.prepare('INSERT INTO task_assignee (task_id, person_id) VALUES (?, ?)');
	for (const r of listRoutines(db)) {
		if (!r.active || (only !== undefined && r.id !== only)) continue;
		const s = parseSchedule(r);
		const occ = s && occurrence(s, today);
		if (!occ) continue;
		const people = routineAssignees(db, r.id);
		if (people.length === 0) continue;
		tx(db, () => {
			const row = insert.get(
				r.title,
				r.icon,
				occ.from,
				occ.due,
				r.time_slot,
				r.points,
				r.requires_approval ? 1 : 0,
				r.id
			);
			if (!row) return;
			for (const p of people) assign.run(Number(row.id), p);
			created++;
		});
	}
	return created;
}

export type PlannedTask = { routine: RoutineRow; due: string; assignees: number[] };

/**
 * Routinen-Aufgaben, die an einem künftigen Tag `date` fällig werden, aber noch nicht angelegt
 * sind (sie entstehen erst an ihrem Tag oder beim Vorab-Abhaken).
 */
export function plannedRoutineTasks(db: Db, date: string): PlannedTask[] {
	const exists = db.prepare('SELECT 1 FROM task WHERE routine_id = ? AND due_date = ?');
	const planned: PlannedTask[] = [];
	for (const r of listRoutines(db)) {
		if (!r.active) continue;
		const s = parseSchedule(r);
		const occ = s && occurrence(s, date);
		if (!occ || exists.get(r.id, occ.due)) continue;
		const assignees = routineAssignees(db, r.id);
		if (assignees.length) planned.push({ routine: r, due: occ.due, assignees });
	}
	return planned;
}

/** Legt die Aufgabe der Routine für `date` an (falls noch nicht da) und liefert ihre Id. */
export function materializeRoutineTask(db: Db, routineId: number, date: string): number | null {
	generateRoutineTasks(db, date, routineId);
	const r = listRoutines(db).find((x) => x.id === routineId);
	const s = r && parseSchedule(r);
	const occ = s && occurrence(s, date);
	if (!occ) return null;
	const row = db
		.prepare('SELECT id FROM task WHERE routine_id = ? AND due_date = ?')
		.get(routineId, occ.due);
	return row ? Number(row.id) : null;
}
