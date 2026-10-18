import type { ServerResponse } from 'node:http';

export type AppEvent = { type: string; data?: unknown };

/** Verteilt Ereignisse per Server-Sent Events an alle verbundenen Clients. */
export function createEventBus(heartbeatMs = 25_000) {
	const clients = new Set<ServerResponse>();
	let nextId = 1;

	// Kommentarzeilen halten die Verbindung durch Proxies/Tunnel offen (Cloudflare trennt nach ~100 s Stille).
	const timer = setInterval(() => {
		for (const res of clients) res.write(': ping\n\n');
	}, heartbeatMs);
	timer.unref();

	return {
		attach(res: ServerResponse) {
			res.writeHead(200, {
				'Content-Type': 'text/event-stream; charset=utf-8',
				'Cache-Control': 'no-cache, no-transform',
				Connection: 'keep-alive',
				'X-Accel-Buffering': 'no'
			});
			res.write('retry: 3000\n\n');
			clients.add(res);
			res.on('close', () => clients.delete(res));
		},
		publish(event: AppEvent) {
			const frame = `id: ${nextId++}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data ?? null)}\n\n`;
			for (const res of clients) res.write(frame);
		},
		get size() {
			return clients.size;
		},
		close() {
			clearInterval(timer);
			for (const res of clients) res.end();
			clients.clear();
		}
	};
}

export type EventBus = ReturnType<typeof createEventBus>;
