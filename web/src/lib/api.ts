export type Role = 'parent' | 'child';
export type Via = 'lan' | 'public';
export type Person = {
	id: number;
	name: string;
	color: string;
	role: Role;
	avatarUrl: string | null;
	email?: string | null;
};

export type Calendar = {
	id: number;
	summary: string;
	color: string | null;
	personId: number | null;
	enabled: boolean;
	writable: boolean;
	account: string | null;
	lastSyncedAt: string | null;
	lastError: string | null;
};

/** Termin; ganztägig: start/end als Datum (end exklusiv), sonst ISO-Zeitpunkt (UTC). */
export type CalEvent = {
	id: number;
	sourceId: number;
	personId: number | null;
	title: string;
	start: string;
	end: string;
	allDay: boolean;
	location: string | null;
	description: string | null;
	recurring: boolean;
	createdBy: number | null;
	writable: boolean;
};

export type GoogleAccount = {
	id: number;
	email: string;
	personId: number;
	status: 'ok' | 'revoked';
};

export type Slot = 'morning' | 'afternoon' | 'evening';
export type Task = {
	id: number;
	title: string;
	icon: string | null;
	dueDate: string | null;
	availableFrom: string | null;
	timeSlot: Slot | null;
	points: number;
	requiresApproval: boolean;
	routineId: number | null;
	overdue: boolean;
	/** Einmalige Aufgabe, die heute fällig ist */
	dueToday: boolean;
	assignees: { personId: number; status: 'open' | 'done' | 'approved'; doneAt: string | null }[];
	/** Nur im Frontend: geplante Routinen-Aufgabe dieses Tages, noch nicht angelegt */
	plannedFor?: string;
};
export type PlannedTask = {
	routineId: number;
	title: string;
	icon: string | null;
	dueDate: string;
	timeSlot: Slot;
	points: number;
	requiresApproval: boolean;
	assignees: number[];
};
export type ListItem = { id: number; text: string; done: boolean };
export type FamilyList = { id: number; title: string; icon: string | null; items: ListItem[] };
/** Eintrag der Mealie-Einkaufsliste (IDs von Mealie) */
export type ShoppingItem = { id: string; text: string; done: boolean };
export type MealEntry = {
	id: number;
	date: string;
	/** breakfast, lunch, dinner, side, snack, drink, dessert */
	type: string;
	title: string;
	text: string;
	recipe: { id: string; slug: string; name: string; image: boolean } | null;
};
export type RecipeRef = { id: string; slug: string; name: string; image: boolean };
/** Links in die Mealie-Oberfläche (nur im LAN) */
export type MealieLinks = { planner: string; recipe: string | null };
export type Recipe = {
	id: string;
	slug: string;
	name: string;
	description: string;
	image: boolean;
	yield: string;
	totalTime: string;
	prepTime: string;
	ingredients: { section: string | null; text: string }[];
	steps: { section: string | null; text: string }[];
};
export type Schedule =
	{ type: 'daily' } | { type: 'weekdays'; days: number[] } | { type: 'weekly' };
export type Routine = {
	id: number;
	title: string;
	icon: string | null;
	schedule: Schedule;
	timeSlot: Slot;
	points: number;
	requiresApproval: boolean;
	active: boolean;
	assignees: number[];
};
export type Approval = {
	taskId: number;
	title: string;
	icon: string | null;
	points: number;
	personId: number;
	doneAt: string | null;
};
export type Reward = {
	id: number;
	title: string;
	icon: string | null;
	cost: number;
	weeklyLimit: number | null;
	active: boolean;
};
export type Redemption = {
	id: number;
	rewardId: number;
	title: string;
	icon: string | null;
	cost: number;
	personId: number;
	status: 'requested' | 'approved' | 'rejected' | 'cancelled';
	requestedAt: string;
	decidedAt: string | null;
};
export type LedgerEntry = {
	id: number;
	delta: number;
	reason: string;
	refType: 'task' | 'bonus' | 'redemption';
	createdAt: string;
};

export class ApiError extends Error {
	constructor(
		public status: number,
		public body: Record<string, unknown>
	) {
		super(`API ${status}: ${String(body.error ?? '')}`);
	}
}

/**
 * Läuft die Cloudflare-Access-Session ab, leitet Access API-Aufrufe auf die Login-Seite um;
 * fetch scheitert dann an CORS. Einmal neu laden bringt den Login-Dialog von Access.
 */
function handleNetworkFailure(err: unknown): never {
	if (location.protocol === 'https:' && !sessionStorage.getItem('kz-reloaded')) {
		sessionStorage.setItem('kz-reloaded', '1');
		location.reload();
	}
	throw err;
}

export async function api<T>(
	path: string,
	init: RequestInit & { json?: unknown } = {}
): Promise<T> {
	const { json, ...rest } = init;
	const headers = new Headers(rest.headers);
	if (json !== undefined) headers.set('content-type', 'application/json');
	let res: Response;
	try {
		res = await fetch(`/api/v1${path}`, {
			...rest,
			headers,
			body: json !== undefined ? JSON.stringify(json) : rest.body,
			credentials: 'same-origin'
		});
	} catch (err) {
		handleNetworkFailure(err);
	}
	sessionStorage.removeItem('kz-reloaded');
	if (res.status === 204) return undefined as T;
	const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
	if (!res.ok) throw new ApiError(res.status, body);
	return body as T;
}
