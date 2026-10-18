import { googleError } from './errors.ts';

const BASE = 'https://www.googleapis.com/calendar/v3';

export type GTime = { date?: string; dateTime?: string; timeZone?: string };
export type GEvent = {
	id: string;
	etag: string;
	status?: 'confirmed' | 'tentative' | 'cancelled';
	summary?: string;
	description?: string;
	location?: string;
	start?: GTime;
	end?: GTime;
	recurringEventId?: string;
	recurrence?: string[];
	updated?: string;
};
export type GCalendar = {
	id: string;
	summary: string;
	summaryOverride?: string;
	primary?: boolean;
	accessRole: 'owner' | 'writer' | 'reader' | 'freeBusyReader';
	backgroundColor?: string;
};
export type GEventInput = Partial<
	Pick<GEvent, 'summary' | 'description' | 'location' | 'start' | 'end'>
>;

export interface CalendarApi {
	listCalendars(): Promise<GCalendar[]>;
	/** Mit syncToken: nur Änderungen (inkl. gelöschter). Sonst: alles im Zeitraum. */
	listEvents(
		calendarId: string,
		q: { syncToken?: string; timeMin?: string; timeMax?: string }
	): Promise<{ items: GEvent[]; nextSyncToken?: string }>;
	getEvent(calendarId: string, eventId: string): Promise<GEvent>;
	insertEvent(calendarId: string, body: GEventInput): Promise<GEvent>;
	patchEvent(calendarId: string, eventId: string, body: GEventInput, etag: string): Promise<GEvent>;
	deleteEvent(calendarId: string, eventId: string, etag: string): Promise<void>;
}

/** Calendar-REST-Client; `getToken(true)` erzwingt einen neuen Access-Token. */
export function createCalendarApi(
	getToken: (force?: boolean) => Promise<string>,
	f: typeof fetch = fetch
): CalendarApi {
	async function call(path: string, init: RequestInit = {}, retried = false): Promise<Response> {
		const headers = new Headers(init.headers);
		headers.set('authorization', `Bearer ${await getToken(retried)}`);
		if (init.body) headers.set('content-type', 'application/json');
		const res = await f(`${BASE}${path}`, { ...init, headers });
		if (res.status === 401 && !retried) return call(path, init, true);
		if (!res.ok) throw await googleError(res);
		return res;
	}
	const cal = (id: string) => `/calendars/${encodeURIComponent(id)}`;

	return {
		async listCalendars() {
			const items: GCalendar[] = [];
			let pageToken: string | undefined;
			do {
				const q = new URLSearchParams({ minAccessRole: 'reader', maxResults: '250' });
				if (pageToken) q.set('pageToken', pageToken);
				const body = (await (await call(`/users/me/calendarList?${q}`)).json()) as {
					items?: GCalendar[];
					nextPageToken?: string;
				};
				items.push(...(body.items ?? []));
				pageToken = body.nextPageToken;
			} while (pageToken);
			return items;
		},
		async listEvents(calendarId, opts) {
			const items: GEvent[] = [];
			let pageToken: string | undefined;
			let nextSyncToken: string | undefined;
			do {
				const q = new URLSearchParams({ singleEvents: 'true', maxResults: '2500' });
				if (opts.syncToken) q.set('syncToken', opts.syncToken);
				else {
					if (opts.timeMin) q.set('timeMin', opts.timeMin);
					if (opts.timeMax) q.set('timeMax', opts.timeMax);
				}
				if (pageToken) q.set('pageToken', pageToken);
				const body = (await (await call(`${cal(calendarId)}/events?${q}`)).json()) as {
					items?: GEvent[];
					nextPageToken?: string;
					nextSyncToken?: string;
				};
				items.push(...(body.items ?? []));
				pageToken = body.nextPageToken;
				nextSyncToken = body.nextSyncToken ?? nextSyncToken;
			} while (pageToken);
			return { items, nextSyncToken };
		},
		async getEvent(calendarId, eventId) {
			return (await (
				await call(`${cal(calendarId)}/events/${encodeURIComponent(eventId)}`)
			).json()) as GEvent;
		},
		async insertEvent(calendarId, body) {
			const res = await call(`${cal(calendarId)}/events`, {
				method: 'POST',
				body: JSON.stringify(body)
			});
			return (await res.json()) as GEvent;
		},
		async patchEvent(calendarId, eventId, body, etag) {
			const res = await call(`${cal(calendarId)}/events/${encodeURIComponent(eventId)}`, {
				method: 'PATCH',
				headers: { 'if-match': etag },
				body: JSON.stringify(body)
			});
			return (await res.json()) as GEvent;
		},
		async deleteEvent(calendarId, eventId, etag) {
			await call(`${cal(calendarId)}/events/${encodeURIComponent(eventId)}`, {
				method: 'DELETE',
				headers: { 'if-match': etag }
			});
		}
	};
}
