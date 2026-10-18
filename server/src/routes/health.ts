import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';

export async function healthRoutes(app: FastifyInstance, { db }: Ctx) {
	app.get('/health', async () => {
		db.prepare('SELECT 1').get();
		return { status: 'ok' };
	});
}
