import type { Db } from '../db/index.ts';
import { AppError } from '../errors.ts';
import { tx } from '../tasks/store.ts';
import { localMidnightUtc, weekStart } from '../time.ts';
import { balance, book } from './ledger.ts';

export type RewardRow = {
	id: number;
	title: string;
	icon: string | null;
	cost: number;
	weekly_limit: number | null;
	active: boolean;
};

export type RedemptionStatus = 'requested' | 'approved' | 'rejected' | 'cancelled';
export type RedemptionRow = {
	id: number;
	reward_id: number;
	person_id: number;
	status: RedemptionStatus;
	requested_at: string;
	decided_by: number | null;
	decided_at: string | null;
};

type Raw = Record<string, unknown>;

function reward(r: Raw | undefined): RewardRow | null {
	if (!r) return null;
	return {
		id: Number(r.id),
		title: String(r.title),
		icon: r.icon == null ? null : String(r.icon),
		cost: Number(r.cost),
		weekly_limit: r.weekly_limit == null ? null : Number(r.weekly_limit),
		active: Boolean(r.active)
	};
}

function redemption(r: Raw | undefined): RedemptionRow | null {
	if (!r) return null;
	return {
		id: Number(r.id),
		reward_id: Number(r.reward_id),
		person_id: Number(r.person_id),
		status: r.status as RedemptionStatus,
		requested_at: String(r.requested_at),
		decided_by: r.decided_by == null ? null : Number(r.decided_by),
		decided_at: r.decided_at == null ? null : String(r.decided_at)
	};
}

export type RewardInput = {
	title: string;
	icon: string | null;
	cost: number;
	weeklyLimit: number | null;
	active: boolean;
};

export const listRewards = (db: Db) =>
	db
		.prepare('SELECT * FROM reward ORDER BY active DESC, cost, title')
		.all()
		.map((r) => reward(r)!);

export const getReward = (db: Db, id: number) =>
	reward(db.prepare('SELECT * FROM reward WHERE id = ?').get(id));

export function insertReward(db: Db, r: RewardInput): RewardRow {
	return reward(
		db
			.prepare(
				'INSERT INTO reward (title, icon, cost, weekly_limit, active) VALUES (?, ?, ?, ?, ?) RETURNING *'
			)
			.get(r.title, r.icon, r.cost, r.weeklyLimit, r.active ? 1 : 0)
	)!;
}

export function updateReward(db: Db, id: number, r: Partial<RewardInput>) {
	const cols: [string, string | number | null][] = [];
	if (r.title !== undefined) cols.push(['title', r.title]);
	if (r.icon !== undefined) cols.push(['icon', r.icon]);
	if (r.cost !== undefined) cols.push(['cost', r.cost]);
	if (r.weeklyLimit !== undefined) cols.push(['weekly_limit', r.weeklyLimit]);
	if (r.active !== undefined) cols.push(['active', r.active ? 1 : 0]);
	if (!cols.length) return;
	db.prepare(`UPDATE reward SET ${cols.map(([c]) => `${c} = ?`).join(', ')} WHERE id = ?`).run(
		...cols.map(([, v]) => v),
		id
	);
}

export function listRedemptions(db: Db, status?: RedemptionStatus, limit = 100): RedemptionRow[] {
	const rows = status
		? db
				.prepare('SELECT * FROM redemption WHERE status = ? ORDER BY id DESC LIMIT ?')
				.all(status, limit)
		: db.prepare('SELECT * FROM redemption ORDER BY id DESC LIMIT ?').all(limit);
	return rows.map((r) => redemption(r)!);
}

export const getRedemption = (db: Db, id: number) =>
	redemption(db.prepare('SELECT * FROM redemption WHERE id = ?').get(id));

/** Punkte, die durch offene Anfragen schon „reserviert“ sind */
function reserved(db: Db, personId: number): number {
	return Number(
		db
			.prepare(
				`SELECT COALESCE(SUM(r.cost), 0) AS n FROM redemption d JOIN reward r ON r.id = d.reward_id
				 WHERE d.person_id = ? AND d.status = 'requested'`
			)
			.get(personId)!.n
	);
}

/** Anfragen + Einlösungen dieser Woche (Mo–So, lokal) für Belohnung und Person */
function usedThisWeek(
	db: Db,
	rewardId: number,
	personId: number,
	today: string,
	tz: string
): number {
	const since = localMidnightUtc(weekStart(today), tz);
	return Number(
		db
			.prepare(
				`SELECT COUNT(*) AS n FROM redemption WHERE reward_id = ? AND person_id = ?
				 AND status IN ('requested', 'approved') AND requested_at >= ?`
			)
			.get(rewardId, personId, since)!.n
	);
}

/** Kind fragt an: Belohnung aktiv, genug freie Punkte, Wochenlimit nicht erreicht. */
export function requestReward(
	db: Db,
	o: { rewardId: number; personId: number; today: string; tz: string }
) {
	return tx(db, () => {
		const r = getReward(db, o.rewardId);
		if (!r || !r.active) throw new AppError(404, 'not found');
		if (
			r.weekly_limit !== null &&
			usedThisWeek(db, r.id, o.personId, o.today, o.tz) >= r.weekly_limit
		)
			throw new AppError(409, 'weekly limit');
		if (balance(db, o.personId) - reserved(db, o.personId) < r.cost)
			throw new AppError(409, 'insufficient');
		return redemption(
			db
				.prepare('INSERT INTO redemption (reward_id, person_id) VALUES (?, ?) RETURNING *')
				.get(r.id, o.personId)
		)!;
	});
}

/** Eltern entscheiden; bei Freigabe wird der Kontostand erneut geprüft und abgebucht. */
export function decideRedemption(db: Db, o: { id: number; approve: boolean; by: number }) {
	tx(db, () => {
		const d = getRedemption(db, o.id);
		if (!d) throw new AppError(404, 'not found');
		if (d.status !== 'requested') throw new AppError(409, 'already decided');
		let ledgerId: number | null = null;
		if (o.approve) {
			const r = getReward(db, d.reward_id)!;
			if (balance(db, d.person_id) < r.cost) throw new AppError(409, 'insufficient');
			ledgerId = book(db, {
				personId: d.person_id,
				delta: -r.cost,
				reason: `Belohnung: ${r.title}`,
				refType: 'redemption',
				refId: d.id,
				createdBy: o.by
			});
		}
		db.prepare(
			`UPDATE redemption SET status = ?, decided_by = ?, decided_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), ledger_id = ?
			 WHERE id = ?`
		).run(o.approve ? 'approved' : 'rejected', o.by, ledgerId, d.id);
	});
}

export function cancelRedemption(db: Db, id: number) {
	const d = getRedemption(db, id);
	if (!d) throw new AppError(404, 'not found');
	if (d.status !== 'requested') throw new AppError(409, 'already decided');
	db.prepare("UPDATE redemption SET status = 'cancelled' WHERE id = ?").run(id);
}
