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
