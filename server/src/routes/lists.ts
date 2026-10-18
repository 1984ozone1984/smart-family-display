import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireParent, requireReader, type Ctx } from '../app.ts';
import {
	clearDone,
	deleteItem,
	deleteList,
	getList,
	insertItem,
	insertList,
	listItems,
	listLists,
	updateItem,
	updateList,
	type ItemRow,
	type ListRow
} from '../lists/store.ts';
import { handle, iconSchema, parse } from './validate.ts';

const idParam = z.object({ id: z.coerce.number().int().positive() });
const itemParam = idParam.extend({ itemId: z.coerce.number().int().positive() });
const position = z.number().int().min(0).max(10_000);
const listFields = { title: z.string().trim().min(1).max(100), icon: iconSchema };
const listBody = z.object({ ...listFields, icon: listFields.icon.default(null) });
const listPatch = z.object({ ...listFields, position }).partial();
const text = z.string().trim().min(1).max(200);
const itemBody = z.object({ text });
const itemPatch = z.object({ text, done: z.boolean(), position }).partial();

/**
 * Listen gehören der ganzen Familie: Am Tablet darf jede Person ohne PIN anlegen, abhaken,
 * bearbeiten und sortieren, über das Handy jede angemeldete Person. Nur das Löschen einer
 * ganzen Liste bleibt den Eltern vorbehalten.
 */
export async function listRoutes(app: FastifyInstance, { db, bus }: Ctx) {
	const changed = () => bus.publish({ type: 'lists.changed' });

	const itemDto = (i: ItemRow) => ({ id: i.id, text: i.text, done: i.done });
	const listDto = (l: ListRow, items: ItemRow[]) => ({
		id: l.id,
		title: l.title,
		icon: l.icon,
		items: items.filter((i) => i.list_id === l.id).map(itemDto)
	});

	app.get('/lists', { preHandler: requireReader }, async () => {
		const items = listItems(db);
		return { lists: listLists(db).map((l) => listDto(l, items)) };
	});

	app.post('/lists', { preHandler: requireReader }, async (req, reply) => {
		const b = parse(listBody, req.body, reply);
		if (!b) return;
		const l = insertList(db, b);
		changed();
		return reply.code(201).send({ list: listDto(l, []) });
	});

	app.patch('/lists/:id', { preHandler: requireReader }, async (req, reply) => {
		const p = parse(idParam, req.params, reply);
		const b = p && parse(listPatch, req.body, reply);
		if (!p || !b) return;
		return handle(reply, () => {
			updateList(db, p.id, b);
			changed();
			return { list: listDto(getList(db, p.id)!, listItems(db, p.id)) };
		});
	});

	app.delete('/lists/:id', { preHandler: requireParent }, async (req, reply) => {
		const p = parse(idParam, req.params, reply);
		if (!p) return;
		return handle(reply, () => {
			deleteList(db, p.id);
			changed();
		});
	});

	app.get('/lists/:id/items', { preHandler: requireReader }, async (req, reply) => {
		const p = parse(idParam, req.params, reply);
		if (!p) return;
		if (!getList(db, p.id)) return reply.code(404).send({ error: 'not found' });
		return { items: listItems(db, p.id).map(itemDto) };
	});

	app.post('/lists/:id/items', { preHandler: requireReader }, async (req, reply) => {
		const p = parse(idParam, req.params, reply);
		const b = p && parse(itemBody, req.body, reply);
		if (!p || !b) return;
		return handle(reply, () => {
			const i = insertItem(db, p.id, b.text);
			changed();
			return reply.code(201).send({ item: itemDto(i) });
		});
	});

	app.patch('/lists/:id/items/:itemId', { preHandler: requireReader }, async (req, reply) => {
		const p = parse(itemParam, req.params, reply);
		const b = p && parse(itemPatch, req.body, reply);
		if (!p || !b) return;
		return handle(reply, () => {
			updateItem(db, p.id, p.itemId, b);
			changed();
		});
	});

	app.delete('/lists/:id/items/:itemId', { preHandler: requireReader }, async (req, reply) => {
		const p = parse(itemParam, req.params, reply);
		if (!p) return;
		return handle(reply, () => {
			deleteItem(db, p.id, p.itemId);
			changed();
		});
	});

	// Abgehakte Einträge auf einmal entfernen
	app.post('/lists/:id/clear-done', { preHandler: requireReader }, async (req, reply) => {
		const p = parse(idParam, req.params, reply);
		if (!p) return;
		return handle(reply, () => {
			const removed = clearDone(db, p.id);
			if (removed) changed();
			return { removed };
		});
	});
}
