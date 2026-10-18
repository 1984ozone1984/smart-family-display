import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { PIN_PATTERN } from '../auth/pin.ts';
import { AppError } from '../errors.ts';

export const pinSchema = z.string().regex(PIN_PATTERN, 'PIN muss 4 Ziffern haben');
export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Farbe als #RRGGBB');
export const nameSchema = z.string().trim().min(1).max(40);
export const emailSchema = z.email().max(200).nullable();
export const roleSchema = z.enum(['parent', 'child']);

/** Validiert `data`; bei Fehler wird 400 gesendet und `null` geliefert. */
export function parse<T extends z.ZodType>(
	schema: T,
	data: unknown,
	reply: FastifyReply
): z.infer<T> | null {
	const r = schema.safeParse(data);
	if (r.success) return r.data;
	void reply.code(400).send({
		error: 'invalid',
		issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
	});
	return null;
}

export const iconSchema = z.string().trim().min(1).max(16).nullable();
export const pointsSchema = z.number().int().min(0).max(1000);
export const slotSchema = z.enum(['morning', 'afternoon', 'evening']);

/** AppError als `{ error: code }` mit Status senden, alles andere weiterwerfen. */
export async function handle(reply: FastifyReply, fn: () => unknown | Promise<unknown>) {
	try {
		const r = await fn();
		return r === undefined ? reply.code(204).send() : r;
	} catch (err) {
		if (err instanceof AppError) return reply.code(err.status).send({ error: err.code });
		throw err;
	}
}
