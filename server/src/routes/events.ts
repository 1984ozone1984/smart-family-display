import type { FastifyInstance } from 'fastify';
import { requireReader, type Ctx } from '../app.ts';

export async function eventRoutes(app: FastifyInstance, { bus }: Ctx) {
	app.get('/events/stream', { preHandler: requireReader }, (_req, reply) => {
		reply.hijack();
		bus.attach(reply.raw);
	});
}
