CREATE TABLE person (
	id INTEGER PRIMARY KEY,
	name TEXT NOT NULL,
	color TEXT NOT NULL,
	avatar_path TEXT,
	role TEXT NOT NULL CHECK (role IN ('parent', 'child')),
	pin_hash TEXT NOT NULL,
	email TEXT,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- id = SHA-256 des Session-Tokens; das Token selbst wird nie gespeichert.
CREATE TABLE session (
	id TEXT PRIMARY KEY,
	person_id INTEGER NOT NULL REFERENCES person (id) ON DELETE CASCADE,
	via TEXT NOT NULL CHECK (via IN ('lan', 'public')),
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	expires_at TEXT NOT NULL
);

CREATE INDEX session_person ON session (person_id);

CREATE TABLE setting (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
);
