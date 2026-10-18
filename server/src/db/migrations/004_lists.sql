-- Eigene Listen der Familie (Urlaub, Projekte …). Alle Listen sind gemeinsam.
-- sort: Reihenfolge, lückenlos ab 0; wird beim Verschieben neu nummeriert.
CREATE TABLE list (
	id INTEGER PRIMARY KEY,
	title TEXT NOT NULL,
	icon TEXT,
	sort INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE list_item (
	id INTEGER PRIMARY KEY,
	list_id INTEGER NOT NULL REFERENCES list (id) ON DELETE CASCADE,
	text TEXT NOT NULL,
	done INTEGER NOT NULL DEFAULT 0,
	sort INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX list_item_list ON list_item (list_id, sort);
