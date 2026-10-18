import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireParent, requireReader, type Ctx } from '../app.ts';
import { hashPin } from '../auth/pin.ts';
import {
	countParents,
	getPerson,
	insertPerson,
	listPersons,
	toDto,
	updatePerson
} from '../persons.ts';
import { colorSchema, emailSchema, nameSchema, parse, pinSchema, roleSchema } from './validate.ts';

const createSchema = z.object({
	name: nameSchema,
	color: colorSchema,
	role: roleSchema,
	pin: pinSchema,
	email: emailSchema.optional()
});
const patchSchema = createSchema.partial();
const idParam = z.object({ id: z.coerce.number().int().positive() });

const AVATAR_MAX = 5 * 1024 * 1024;
const AVATAR_NAME = /^\d+-[0-9a-f]{16}\.(jpg|png|webp)$/;
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as const;

/** Bildtyp an den ersten Bytes erkennen, nicht am vom Client gemeldeten MIME-Typ. */
function sniffImage(buf: Buffer): keyof typeof MIME | null {
	if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
	if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
		return 'png';
	if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP')
		return 'webp';
	return null;
}

export async function personRoutes(app: FastifyInstance, { db, bus, config }: Ctx) {
	const avatarDir = join(config.DATA_DIR, 'avatars');
	await app.register(multipart, { limits: { fileSize: AVATAR_MAX, files: 1, fields: 0 } });

	const changed = (id: number) => bus.publish({ type: 'persons.changed', data: { id } });

	app.get('/persons', { preHandler: requireReader }, async (req) => {
		const isParent = req.person?.role === 'parent';
		return { persons: listPersons(db).map((p) => toDto(p, isParent)) };
	});

	app.post('/persons', { preHandler: requireParent }, async (req, reply) => {
		const body = parse(createSchema, req.body, reply);
		if (!body) return;
		const person = insertPerson(db, {
			name: body.name,
			color: body.color,
			role: body.role,
			pinHash: await hashPin(body.pin),
			email: body.email ?? null
		});
		changed(person.id);
		return reply.code(201).send({ person: toDto(person, true) });
	});

	app.patch('/persons/:id', { preHandler: requireParent }, async (req, reply) => {
		const params = parse(idParam, req.params, reply);
		const body = params && parse(patchSchema, req.body, reply);
		if (!params || !body) return;
		const pinHash = body.pin ? await hashPin(body.pin) : undefined;

		const current = getPerson(db, params.id);
		if (!current) return reply.code(404).send({ error: 'not found' });
		if (current.role === 'parent' && body.role === 'child' && countParents(db) <= 1) {
			return reply.code(409).send({ error: 'last parent' });
		}
		const person = updatePerson(db, params.id, {
			name: body.name,
			color: body.color,
			role: body.role,
			email: body.email,
			pin_hash: pinHash
		});
		changed(params.id);
		return { person: toDto(person!, true) };
	});

	app.post('/persons/:id/avatar', { preHandler: requireParent }, async (req, reply) => {
		const params = parse(idParam, req.params, reply);
		if (!params) return;
		const current = getPerson(db, params.id);
		if (!current) return reply.code(404).send({ error: 'not found' });

		const file = await req.file();
		if (!file) return reply.code(400).send({ error: 'no file' });
		const buf = await file.toBuffer();
		const ext = sniffImage(buf);
		if (!ext) return reply.code(415).send({ error: 'only jpeg, png, webp' });

		await mkdir(avatarDir, { recursive: true });
		const name = `${current.id}-${randomBytes(8).toString('hex')}.${ext}`;
		await writeFile(join(avatarDir, name), buf);
		const person = updatePerson(db, current.id, { avatar_path: name });
		if (current.avatar_path) await rm(join(avatarDir, current.avatar_path), { force: true });
		changed(current.id);
		return { person: toDto(person!, true) };
	});

	// Ohne Session abrufbar (Login-Dialog); Zugriffsregel LAN/Access gilt trotzdem.
	app.get('/avatars/:file', async (req, reply) => {
		const { file } = req.params as { file: string };
		const m = AVATAR_NAME.exec(file);
		if (!m) return reply.code(404).send({ error: 'not found' });
		const stream = createReadStream(join(avatarDir, file));
		stream.on('error', () => {
			if (!reply.sent) void reply.code(404).send({ error: 'not found' });
		});
		return reply
			.type(MIME[m[1] as keyof typeof MIME])
			.header('Cache-Control', 'private, max-age=31536000, immutable')
			.send(stream);
	});
}
