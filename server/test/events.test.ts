import { describe, expect, it } from 'vitest';
import { makeApp } from './helpers.ts';

describe('SSE', () => {
	it('Änderung an einer Person erreicht verbundene Clients sofort', async () => {
		// Echter Stream über Loopback, daher 127.0.0.1 als LAN zulassen
		const { app } = await makeApp({ lanSubnets: '127.0.0.1' });
		const base = await app.listen({ port: 0, host: '127.0.0.1' });
		try {
			const setup = await fetch(`${base}/api/v1/setup`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'Mama', color: '#e11d48', pin: '1111' })
			});
			const cookie = setup.headers.get('set-cookie')!.split(';')[0]!;
			const { person } = (await setup.json()) as { person: { id: number } };

			const ac = new AbortController();
			const stream = await fetch(`${base}/api/v1/events/stream`, { signal: ac.signal });
			expect(stream.headers.get('content-type')).toContain('text/event-stream');
			const reader = stream.body!.getReader();

			const started = Date.now();
			await fetch(`${base}/api/v1/persons/${person.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json', cookie },
				body: JSON.stringify({ color: '#16a34a' })
			});

			let text = '';
			while (!text.includes('event: persons.changed')) {
				const { value, done } = await reader.read();
				if (done) break;
				text += new TextDecoder().decode(value);
			}
			expect(text).toContain(`data: {"id":${person.id}}`);
			expect(Date.now() - started).toBeLessThan(2000);
			ac.abort();
		} finally {
			await app.close();
		}
	});
});
