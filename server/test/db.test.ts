import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrate, openDb } from '../src/db/index.ts';

describe('migrate', () => {
	it('wendet Migrationen genau einmal an', () => {
		const db = openDb(':memory:');
		expect(migrate(db)).toContain('001_init.sql');
		expect(migrate(db)).toEqual([]);
		const tables = db
			.prepare("SELECT name FROM sqlite_master WHERE type='table'")
			.all()
			.map((r) => r.name);
		expect(tables).toEqual(expect.arrayContaining(['person', 'session', 'setting']));
	});

	it('rollt eine fehlerhafte Migration vollständig zurück', () => {
		const dir = mkdtempSync(join(tmpdir(), 'kz-mig-'));
		writeFileSync(join(dir, '001_ok.sql'), 'CREATE TABLE a (x);');
		writeFileSync(join(dir, '002_bad.sql'), 'CREATE TABLE b (x); SELECT * FROM fehlt;');
		const db = openDb(':memory:');
		expect(() => migrate(db, dir)).toThrow(/002_bad/);
		const tables = db
			.prepare("SELECT name FROM sqlite_master WHERE type='table'")
			.all()
			.map((r) => r.name);
		expect(tables).toContain('a');
		expect(tables).not.toContain('b');
		const versions = db.prepare('SELECT version FROM schema_migration').all();
		expect(versions.map((v) => v.version)).toEqual(['001_ok.sql']);
	});
});

describe('loadConfig', () => {
	it('leere Werte gelten als nicht gesetzt', async () => {
		const { loadConfig } = await import('../src/config.ts');
		const c = loadConfig({
			LAN_SUBNETS: '192.168.1.0/24',
			CF_ACCESS_AUD: '',
			PUBLIC_HOST: 'x.example'
		});
		expect(c.CF_ACCESS_AUD).toBeUndefined();
		expect(c.LAN_SUBNETS).toEqual(['192.168.1.0/24']);
	});

	it('Access nur vollständig konfigurierbar', async () => {
		const { loadConfig } = await import('../src/config.ts');
		expect(() => loadConfig({ LAN_SUBNETS: '10.0.0.0/8', CF_ACCESS_AUD: 'a' })).toThrow(
			/gemeinsam/
		);
		expect(() => loadConfig({})).toThrow(/LAN_SUBNETS/);
	});
});
