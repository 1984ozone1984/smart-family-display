import type { Db } from '../db/index.ts';
import { AppError } from '../errors.ts';
import { settleTask } from '../points/ledger.ts';
import { assigneesOf, getTask, setStatus, tx, type AssigneeStatus, type TaskRow } from './store.ts';

/** Punkte gibt es für erledigte Aufgaben ohne Freigabe-Pflicht bzw. für bestätigte. */
function credited(status: AssigneeStatus, t: TaskRow): boolean {
	return status === 'approved' || (status === 'done' && !t.requires_approval);
}

function load(db: Db, taskId: number, personId: number) {
	const t = getTask(db, taskId);
	const a = t && assigneesOf(db, [taskId]).find((x) => x.person_id === personId);
	if (!t || !a) throw new AppError(404, 'not found');
	return { t, a };
}

function apply(db: Db, t: TaskRow, personId: number, status: AssigneeStatus, by: number | null) {
	setStatus(db, t.id, personId, status);
	settleTask(db, {
		taskId: t.id,
		personId,
		target: credited(status, t) ? t.points : 0,
		title: t.title,
		by
	});
}

/**
 * Abhaken bzw. zurücknehmen durch die zuständige Person. Abgelaufene Routinen-Aufgaben sind
 * gesperrt; eine bereits bestätigte Aufgabe können nur Eltern zurücknehmen.
 */
export function setDone(
	db: Db,
	o: {
		taskId: number;
		personId: number;
		done: boolean;
		byParent: boolean;
		by: number | null;
		today: string;
	}
) {
	tx(db, () => {
		const { t, a } = load(db, o.taskId, o.personId);
		if (t.available_from && t.due_date && t.due_date < o.today) throw new AppError(409, 'expired');
		if (o.done) {
			if (a.status !== 'open') return;
			apply(db, t, o.personId, 'done', o.by);
		} else {
			if (a.status === 'open') return;
			if (a.status === 'approved' && !o.byParent) throw new AppError(403, 'approved');
			apply(db, t, o.personId, 'open', o.by);
		}
	});
}

/** Eltern bestätigen (Punkte werden gebucht) oder lehnen ab (wieder offen). */
export function decideTask(
	db: Db,
	o: { taskId: number; personId: number; approve: boolean; by: number }
) {
	tx(db, () => {
		const { t, a } = load(db, o.taskId, o.personId);
		if (!t.requires_approval) throw new AppError(409, 'no approval needed');
		if (a.status !== 'done') throw new AppError(409, 'not done');
		apply(db, t, o.personId, o.approve ? 'approved' : 'open', o.by);
	});
}

/** Nach Änderung von Punkten/Freigabe-Pflicht: Buchungen aller Zuständigen per Differenz anpassen. */
export function resettle(db: Db, taskId: number, by: number) {
	tx(db, () => {
		const t = getTask(db, taskId);
		if (!t) return;
		for (const a of assigneesOf(db, [taskId])) apply(db, t, a.person_id, a.status, by);
	});
}
