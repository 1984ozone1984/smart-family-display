-- Verbundene Google-Konten; jede Person verbindet ihr eigenes.
CREATE TABLE google_account (
	id INTEGER PRIMARY KEY,
	person_id INTEGER NOT NULL REFERENCES person (id) ON DELETE CASCADE,
	email TEXT NOT NULL UNIQUE,
	refresh_token_enc TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'revoked')),
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Ein Google-Kalender. remote_id ist eindeutig: ein geteilter Kalender (Familie), den mehrere
-- Konten sehen, wird nur einmal synchronisiert. person_id NULL = „Alle“.
CREATE TABLE calendar_source (
	id INTEGER PRIMARY KEY,
	type TEXT NOT NULL DEFAULT 'google' CHECK (type IN ('google')),
	account_id INTEGER NOT NULL REFERENCES google_account (id) ON DELETE CASCADE,
	remote_id TEXT NOT NULL UNIQUE,
	summary TEXT NOT NULL,
	color TEXT,
	person_id INTEGER REFERENCES person (id) ON DELETE SET NULL,
	enabled INTEGER NOT NULL DEFAULT 0,
	writable INTEGER NOT NULL DEFAULT 0,
	sync_token TEXT,
	full_synced_at TEXT,
	last_synced_at TEXT,
	last_error TEXT
);

-- Lokaler Cache; die Quelle ist führend. Serien kommen als Einzeltermine (Google singleEvents),
-- recurring_id verweist auf die Serie. start/end: ISO-Zeitpunkt (UTC) bzw. Datum bei ganztägig
-- (end exklusiv). range_start/range_end: immer UTC, für Zeitraumabfragen.
CREATE TABLE event (
	id INTEGER PRIMARY KEY,
	source_id INTEGER NOT NULL REFERENCES calendar_source (id) ON DELETE CASCADE,
	remote_id TEXT NOT NULL,
	recurring_id TEXT,
	etag TEXT NOT NULL,
	title TEXT NOT NULL,
	description TEXT,
	location TEXT,
	start TEXT NOT NULL,
	end TEXT NOT NULL,
	all_day INTEGER NOT NULL,
	rrule TEXT,
	range_start TEXT NOT NULL,
	range_end TEXT NOT NULL,
	created_by INTEGER REFERENCES person (id) ON DELETE SET NULL,
	updated_at TEXT NOT NULL,
	UNIQUE (source_id, remote_id)
);

CREATE INDEX event_range ON event (range_start, range_end);
