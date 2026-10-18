import { describe, expect, it } from 'vitest';
import { createLockout, hashPin, verifyPin } from '../src/auth/pin.ts';

describe('PIN', () => {
	it('hasht und prüft', async () => {
		const h = await hashPin('1234');
		expect(h).not.toContain('1234');
		expect(await verifyPin(h, '1234')).toBe(true);
		expect(await verifyPin(h, '4321')).toBe(false);
		expect(await verifyPin('kaputt', '1234')).toBe(false);
	});
});

describe('Lockout', () => {
	it('sperrt nach 5 Fehlversuchen und gibt nach Ablauf wieder frei', () => {
		let t = 0;
		const l = createLockout({ maxFailures: 5, lockMs: 1000 }, () => t);
		for (let i = 0; i < 4; i++) l.fail(['p:1']);
		expect(l.lockedFor(['p:1'])).toBe(0);
		l.fail(['p:1']);
		expect(l.lockedFor(['p:1'])).toBe(1000);
		expect(l.lockedFor(['p:2'])).toBe(0);
		t = 1001;
		expect(l.lockedFor(['p:1'])).toBe(0);
		l.fail(['p:1']);
		expect(l.lockedFor(['p:1'])).toBe(0);
	});

	it('Erfolg setzt den Zähler zurück', () => {
		const l = createLockout({ maxFailures: 2, lockMs: 1000 }, () => 0);
		l.fail(['k']);
		l.succeed(['k']);
		l.fail(['k']);
		expect(l.lockedFor(['k'])).toBe(0);
	});
});
