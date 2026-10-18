import type { Db } from '../db/index.ts';
import type { EventBus } from '../events/bus.ts';
import type { CalendarApi } from '../google/calendar-api.ts';
import { GoogleError } from '../google/errors.ts';
import { fromGoogle } from './map.ts';
import {
	deleteEventByRemote,
	getAccount,
	listSources,
	replaceEvents,
	setSyncError,
	setSyncState,
	upsertEvent,
	type SourceRow
} from './store.ts';

const DAY_MS = 86_400_000;
/** Zeitraum laut SPEC: −30 bis +180 Tage */
const PAST_DAYS = 30;
const FUTURE_DAYS = 180;
/** Täglich voll abgleichen, damit neue Tage am Ende des Zeitraums nachrücken */
const FULL_EVERY_MS = DAY_MS;

export type SyncDeps = {
	db: Db;
	bus: EventBus;
	tz: string;
	apiFor: (accountId: number) => CalendarApi;
	now?: () => Date;
	log?: { warn: (obj: object, msg: string) => void };
};

export function createSync(deps: SyncDeps) {
	const { db, bus, tz, apiFor } = deps;
	const now = deps.now ?? (() => new Date());
	let running: Promise<number[]> | null = null;

	function window() {
		const t = now().getTime();
		return {
			timeMin: new Date(t - PAST_DAYS * DAY_MS).toISOString(),
			timeMax: new Date(t + FUTURE_DAYS * DAY_MS).toISOString()
		};
	}

	async function full(src: SourceRow, api: CalendarApi): Promise<boolean> {
		const w = window();
		const res = await api.listEvents(src.remote_id, w);
		const events = res.items
			.filter((g) => g.status !== 'cancelled')
			.map((g) => fromGoogle(g, tz))
			.filter((e) => e !== null);
		const changed = replaceEvents(db, src.id, events);
		setSyncState(db, src.id, { syncToken: res.nextSyncToken ?? null, at: now(), full: true });
		return changed;
	}

	async function incremental(src: SourceRow, api: CalendarApi): Promise<boolean> {
		const w = window();
		const res = await api.listEvents(src.remote_id, { syncToken: src.sync_token! });
		let changed = false;
		for (const g of res.items) {
			const e = g.status === 'cancelled' ? null : fromGoogle(g, tz);
			const inWindow = e && e.range_start < w.timeMax && e.range_end > w.timeMin;
			changed =
				(inWindow ? upsertEvent(db, src.id, e) : deleteEventByRemote(db, src.id, g.id)) || changed;
		}
		setSyncState(db, src.id, { syncToken: res.nextSyncToken ?? src.sync_token, at: now() });
		return changed;
	}

	/** Gleicht eine Quelle ab: inkrementell per syncToken, sonst (oder bei 410) vollständig. */
	async function syncSource(src: SourceRow): Promise<boolean> {
		const api = apiFor(src.account_id);
		const fullDue =
			!src.sync_token ||
			!src.full_synced_at ||
			now().getTime() - Date.parse(src.full_synced_at) > FULL_EVERY_MS;
		if (!fullDue) {
			try {
				return await incremental(src, api);
			} catch (err) {
				// 410 Gone: syncToken abgelaufen → neu aufsetzen
				if (!(err instanceof GoogleError && err.status === 410)) throw err;
			}
		}
		return full(src, api);
	}

	async function runAll(): Promise<number[]> {
		const changed: number[] = [];
		for (const src of listSources(db)) {
			if (!src.enabled || getAccount(db, src.account_id)?.status !== 'ok') continue;
			try {
				if (await syncSource(src)) changed.push(src.id);
			} catch (err) {
				setSyncError(db, src.id, String(err instanceof Error ? err.message : err));
				deps.log?.warn({ source: src.id, err: String(err) }, 'Kalender-Sync fehlgeschlagen');
			}
		}
		if (changed.length) bus.publish({ type: 'events.changed', data: { sourceIds: changed } });
		return changed;
	}

	return {
		syncSource,
		/** Alle aktiven Quellen; läuft schon ein Abgleich, wird dieser abgewartet statt doppelt gestartet. */
		syncAll(): Promise<number[]> {
			running ??= runAll().finally(() => (running = null));
			return running;
		}
	};
}

export type Sync = ReturnType<typeof createSync>;
