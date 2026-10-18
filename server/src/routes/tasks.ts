import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireParent, requirePerson, requireReader, type Ctx } from '../app.ts';
import { AppError } from '../errors.ts';
import { getPerson } from '../persons.ts';
import { generateRoutineTasks, scheduleSchema } from '../tasks/routines.ts';
import { decideTask, resettle, setDone } from '../tasks/service.ts';
import {
	assigneesOf,
	deleteTask,
	getRoutine,
	getTask,
	insertRoutine,
	insertTask,
	listRoutines,
	pendingApprovals,
	routineAssignees,
	tasksForDate,
	updateRoutine,
	updateTask,
	type RoutineRow,
	type TaskRow
} from '../tasks/store.ts';
import { localMidnightUtc, todayIn } from '../time.ts';
import { handle, iconSchema, parse, pointsSchema, slotSchema } from './validate.ts';

const idParam = z.object({ id: z.coerce.number().int().positive() });
const people = z.array(z.number().int().positive()).min(1).max(20);

// Felder ohne Standardwerte: PATCH übernimmt nur, was gesendet wurde
const taskFields = {
	title: z.string().trim().min(1).max(100),
	icon: iconSchema,
	dueDate: z.iso.date().nullable(),
	timeSlot: slotSchema.nullable(),
	points: pointsSchema,
	requiresApproval: z.boolean(),
	assignees: people
};
const taskBody = z.object({
	...taskFields,
	icon: taskFields.icon.default(null),
	dueDate: taskFields.dueDate.default(null),
	timeSlot: taskFields.timeSlot.default(null),
	points: taskFields.points.default(0),
	requiresApproval: taskFields.requiresApproval.default(false)
});
const taskPatch = z.object(taskFields).partial();

const routineFields = {
	title: z.string().trim().min(1).max(100),
	icon: iconSchema,
	schedule: scheduleSchema,
	timeSlot: slotSchema,
	points: pointsSchema,
	requiresApproval: z.boolean(),
	active: z.boolean(),
	assignees: people
};
const routineBody = z.object({
	...routineFields,
	icon: routineFields.icon.default(null),
	points: routineFields.points.default(0),
	requiresApproval: routineFields.requiresApproval.default(false),
	active: routineFields.active.default(true)
});
const routinePatch = z.object(routineFields).partial();

const doneBody = z.object({
	personId: z.number().int().positive(),
	done: z.boolean().default(true)
});
const approveBody = z.object({
	personId: z.number().int().positive(),
	approve: z.boolean().default(true)
});
const dateQuery = z.object({ date: z.iso.date().optional() });

export async function taskRoutes(app: FastifyInstance, { db, bus, config }: Ctx) {
	const tz = config.TZ;
	const today = () => todayIn(tz);
	const changed = (points = false) => {
		bus.publish({ type: 'tasks.changed' });
		if (points) bus.publish({ type: 'points.changed' });
	};
	const checkPeople = (ids: number[]) => {
		if (ids.some((id) => !getPerson(db, id))) throw new AppError(400, 'unknown person');
	};

	const taskDto = (t: TaskRow, assignees: ReturnType<typeof assigneesOf>, now: string) => ({
		id: t.id,
		title: t.title,
		icon: t.icon,
		dueDate: t.due_date,
		availableFrom: t.available_from,
		timeSlot: t.time_slot,
		points: t.points,
		requiresApproval: t.requires_approval,
		routineId: t.routine_id,
		overdue: !t.available_from && t.due_date !== null && t.due_date < now,
		assignees: assignees
			.filter((a) => a.task_id === t.id)
			.map((a) => ({ personId: a.person_id, status: a.status, doneAt: a.done_at }))
	});
	const routineDto = (r: RoutineRow) => ({
		id: r.id,
		title: r.title,
		icon: r.icon,
		schedule: JSON.parse(r.schedule) as unknown,
		timeSlot: r.time_slot,
		points: r.points,
		requiresApproval: r.requires_approval,
		active: r.active,
		assignees: routineAssignees(db, r.id)
	});

	app.get('/tasks', { preHandler: requireReader }, async (req, reply) => {
		const q = parse(dateQuery, req.query, reply);
		if (!q) return;
		const now = today();
		const date = q.date ?? now;
		const tasks = tasksForDate(db, date, now, localMidnightUtc(now, tz));
		const assignees = assigneesOf(
			db,
			tasks.map((t) => t.id)
		);
		return { date, today: now, tasks: tasks.map((t) => taskDto(t, assignees, now)) };
	});

	app.get('/tasks/approvals', { preHandler: requireReader }, async () => ({
		approvals: pendingApprovals(db).map((p) => ({
			taskId: p.task.id,
			title: p.task.title,
			icon: p.task.icon,
			points: p.task.points,
			personId: p.personId,
			doneAt: p.doneAt
		}))
	}));

	app.post('/tasks', { preHandler: requireParent }, async (req, reply) => {
		const b = parse(taskBody, req.body, reply);
		if (!b) return;
		return handle(reply, () => {
			checkPeople(b.assignees);
			const t = insertTask(db, b, b.assignees, req.person!.id);
			changed();
			return reply.code(201).send({ id: t.id });
		});
	});

	app.patch('/tasks/:id', { preHandler: requireParent }, async (req, reply) => {
		const p = parse(idParam, req.params, reply);
		const b = p && parse(taskPatch, req.body, reply);
		if (!p || !b) return;
		return handle(reply, () => {
			if (!getTask(db, p.id)) throw new AppError(404, 'not found');
			if (b.assignees) checkPeople(b.assignees);
			updateTask(db, p.id, b, b.assignees);
			const rebook = b.points !== undefined || b.requiresApproval !== undefined;
			if (rebook) resettle(db, p.id, req.person!.id);
			changed(rebook);
		});
	});

	app.delete('/tasks/:id', { preHandler: requireParent }, async (req, reply) => {
		const p = parse(idParam, req.params, reply);
		if (!p) return;
		// Bereits gebuchte Punkte bleiben im Ledger (Historie)
		deleteTask(db, p.id);
		changed();
		return reply.code(204).send();
	});

	// Abhaken nur durch die Person selbst (mit PIN angemeldet) oder ein Elternteil – auch am Tablet
	app.post('/tasks/:id/done', { preHandler: requirePerson }, async (req, reply) => {
		const p = parse(idParam, req.params, reply);
		const b = p && parse(doneBody, req.body, reply);
		if (!p || !b) return;
		const me = req.person!;
		if (me.id !== b.personId && me.role !== 'parent')
			return reply.code(403).send({ error: 'not allowed' });
		return handle(reply, () => {
			setDone(db, {
				taskId: p.id,
				personId: b.personId,
				done: b.done,
				byParent: me.role === 'parent',
				by: me.id,
				today: today()
			});
			changed(true);
		});
	});

	app.post('/tasks/:id/approve', { preHandler: requireParent }, async (req, reply) => {
		const p = parse(idParam, req.params, reply);
		const b = p && parse(approveBody, req.body, reply);
		if (!p || !b) return;
		return handle(reply, () => {
			decideTask(db, {
				taskId: p.id,
				personId: b.personId,
				approve: b.approve,
				by: req.person!.id
			});
			changed(true);
		});
	});

	app.get('/routines', { preHandler: requireReader }, async () => ({
		routines: listRoutines(db).map(routineDto)
	}));

	app.post('/routines', { preHandler: requireParent }, async (req, reply) => {
		const b = parse(routineBody, req.body, reply);
		if (!b) return;
		return handle(reply, () => {
			checkPeople(b.assignees);
			const r = insertRoutine(
				db,
				{ ...b, schedule: JSON.stringify(b.schedule) },
				b.assignees,
				req.person!.id
			);
			// Ist die Routine heute fällig, gleich die heutige Aufgabe anlegen
			generateRoutineTasks(db, today(), r.id);
			changed();
			return reply.code(201).send({ routine: routineDto(getRoutine(db, r.id)!) });
		});
	});

	app.patch('/routines/:id', { preHandler: requireParent }, async (req, reply) => {
		const p = parse(idParam, req.params, reply);
		const b = p && parse(routinePatch, req.body, reply);
		if (!p || !b) return;
		return handle(reply, () => {
			if (!getRoutine(db, p.id)) throw new AppError(404, 'not found');
			if (b.assignees) checkPeople(b.assignees);
			const { schedule, ...rest } = b;
			// Wirkt auf künftige Aufgaben; die heutige bleibt, wie sie ist
			updateRoutine(
				db,
				p.id,
				{ ...rest, ...(schedule ? { schedule: JSON.stringify(schedule) } : {}) },
				b.assignees
			);
			generateRoutineTasks(db, today(), p.id);
			changed();
			return { routine: routineDto(getRoutine(db, p.id)!) };
		});
	});
}
