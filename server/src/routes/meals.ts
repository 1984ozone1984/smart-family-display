import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireReader, type Ctx } from '../app.ts';
import { MealieError } from '../mealie/client.ts';
import { todayIn } from '../time.ts';
import { parse } from './validate.ts';

const date = z.iso.date();
const weekQuery = z.object({ week: date.optional() });
const weekBody = z.object({ week: date.optional() });
const slugParam = z.object({ slug: z.string().regex(/^[\w-]{1,200}$/) });
const idParam = z.object({ id: z.uuid() });
const text = z.string().trim().min(1).max(200);
const itemBody = z.object({ text });
const itemPatch = z.object({ text, done: z.boolean() }).partial();

/**
 * Essen und Einkaufsliste als Proxy zu Mealie. Wie bei den eigenen Listen darf am Tablet jede
 * Person ohne PIN die Einkaufsliste ändern, über das Handy jede angemeldete Person.
 */
export async function mealRoutes(app: FastifyInstance, { mealie, config }: Ctx) {
	/** Mealie-Fehler als 503/404/502 senden */
	async function proxy(reply: FastifyReply, fn: () => unknown | Promise<unknown>) {
		if (!mealie) return reply.code(503).send({ error: 'mealie not configured' });
		try {
			const r = await fn();
			return r === undefined ? reply.code(204).send() : r;
		} catch (err) {
			if (!(err instanceof MealieError)) throw err;
			if (err.status === 404) return reply.code(404).send({ error: 'not found' });
			reply.log.warn({ err: err.message }, 'Mealie-Aufruf fehlgeschlagen');
			return reply.code(502).send({ error: 'mealie unavailable' });
		}
	}
	const today = () => todayIn(config.TZ);

	app.get('/meals', { preHandler: requireReader }, async (req, reply) => {
		const q = parse(weekQuery, req.query, reply);
		if (!q) return;
		return proxy(reply, async () => ({
			today: today(),
			...(await mealie!.week(q.week ?? today()))
		}));
	});

	app.post('/meals/shopping', { preHandler: requireReader }, async (req, reply) => {
		const b = parse(weekBody, req.body ?? {}, reply);
		if (!b) return;
		return proxy(reply, async () => ({
			recipes: await mealie!.addWeekToShopping(b.week ?? today())
		}));
	});

	app.get('/recipes/:slug', { preHandler: requireReader }, async (req, reply) => {
		const p = parse(slugParam, req.params, reply);
		if (!p) return;
		return proxy(reply, async () => ({ recipe: await mealie!.recipe(p.slug) }));
	});

	app.get('/recipes/:id/image', { preHandler: requireReader }, async (req, reply) => {
		const p = parse(idParam, req.params, reply);
		if (!p) return;
		return proxy(reply, async () => {
			const res = await mealie!.image(p.id);
			return reply
				.type(res.headers.get('content-type') ?? 'image/webp')
				.header('cache-control', 'private, max-age=86400')
				.send(Buffer.from(await res.arrayBuffer()));
		});
	});

	app.get('/shopping', { preHandler: requireReader }, async (_req, reply) =>
		proxy(reply, async () => ({ items: await mealie!.shopping() }))
	);

	app.post('/shopping/items', { preHandler: requireReader }, async (req, reply) => {
		const b = parse(itemBody, req.body, reply);
		if (!b) return;
		return proxy(reply, async () => {
			await mealie!.addItem(b.text);
			return reply.code(201).send({ items: await mealie!.shopping() });
		});
	});

	app.patch('/shopping/items/:id', { preHandler: requireReader }, async (req, reply) => {
		const p = parse(idParam, req.params, reply);
		const b = p && parse(itemPatch, req.body, reply);
		if (!p || !b) return;
		return proxy(reply, () => mealie!.updateItem(p.id, b));
	});

	app.delete('/shopping/items/:id', { preHandler: requireReader }, async (req, reply) => {
		const p = parse(idParam, req.params, reply);
		if (!p) return;
		return proxy(reply, () => mealie!.deleteItem(p.id));
	});

	app.post('/shopping/clear-done', { preHandler: requireReader }, async (_req, reply) =>
		proxy(reply, async () => ({ removed: await mealie!.clearDone() }))
	);
}
