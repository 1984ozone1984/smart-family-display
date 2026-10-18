-- Routine = Vorlage, aus der täglich (bzw. wöchentlich) Aufgaben entstehen.
-- schedule (JSON): {"type":"daily"} | {"type":"weekdays","days":[1..7]} (1 = Mo) | {"type":"weekly"}
CREATE TABLE routine (
	id INTEGER PRIMARY KEY,
	title TEXT NOT NULL,
	icon TEXT,
	schedule TEXT NOT NULL,
	time_slot TEXT NOT NULL CHECK (time_slot IN ('morning', 'afternoon', 'evening')),
	points INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
	requires_approval INTEGER NOT NULL DEFAULT 0,
	active INTEGER NOT NULL DEFAULT 1,
	created_by INTEGER REFERENCES person (id) ON DELETE SET NULL,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE routine_assignee (
	routine_id INTEGER NOT NULL REFERENCES routine (id) ON DELETE CASCADE,
	person_id INTEGER NOT NULL REFERENCES person (id) ON DELETE CASCADE,
	PRIMARY KEY (routine_id, person_id)
);

-- Aufgabe. Sichtbar von available_from bis due_date (Kalendertage, lokal).
-- Routinen-Aufgaben verfallen nach due_date; einmalige bleiben offen (überfällig).
-- UNIQUE: pro Routine und Fälligkeitstag genau eine Aufgabe.
CREATE TABLE task (
	id INTEGER PRIMARY KEY,
	title TEXT NOT NULL,
	icon TEXT,
	available_from TEXT,
	due_date TEXT,
	time_slot TEXT CHECK (time_slot IN ('morning', 'afternoon', 'evening')),
	points INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
	requires_approval INTEGER NOT NULL DEFAULT 0,
	routine_id INTEGER REFERENCES routine (id) ON DELETE SET NULL,
	created_by INTEGER REFERENCES person (id) ON DELETE SET NULL,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	UNIQUE (routine_id, due_date)
);

CREATE INDEX task_due ON task (due_date);

CREATE TABLE task_assignee (
	task_id INTEGER NOT NULL REFERENCES task (id) ON DELETE CASCADE,
	person_id INTEGER NOT NULL REFERENCES person (id) ON DELETE CASCADE,
	status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'approved')),
	done_at TEXT,
	PRIMARY KEY (task_id, person_id)
);

-- Punktekonto als Ledger: nur anfügen, nie ändern oder löschen. Saldo = SUM(delta).
CREATE TABLE points_ledger (
	id INTEGER PRIMARY KEY,
	person_id INTEGER NOT NULL REFERENCES person (id),
	delta INTEGER NOT NULL CHECK (delta <> 0),
	reason TEXT NOT NULL,
	ref_type TEXT NOT NULL CHECK (ref_type IN ('task', 'bonus', 'redemption')),
	ref_id INTEGER,
	created_by INTEGER REFERENCES person (id),
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX points_person ON points_ledger (person_id);
CREATE INDEX points_ref ON points_ledger (ref_type, ref_id, person_id);

CREATE TRIGGER points_ledger_no_update BEFORE UPDATE ON points_ledger
BEGIN
	SELECT RAISE(ABORT, 'points_ledger is append-only');
END;

CREATE TRIGGER points_ledger_no_delete BEFORE DELETE ON points_ledger
BEGIN
	SELECT RAISE(ABORT, 'points_ledger is append-only');
END;

CREATE TABLE reward (
	id INTEGER PRIMARY KEY,
	title TEXT NOT NULL,
	icon TEXT,
	cost INTEGER NOT NULL CHECK (cost > 0),
	weekly_limit INTEGER CHECK (weekly_limit > 0),
	active INTEGER NOT NULL DEFAULT 1,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE redemption (
	id INTEGER PRIMARY KEY,
	reward_id INTEGER NOT NULL REFERENCES reward (id),
	person_id INTEGER NOT NULL REFERENCES person (id),
	status TEXT NOT NULL DEFAULT 'requested'
		CHECK (status IN ('requested', 'approved', 'rejected', 'cancelled')),
	requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	decided_by INTEGER REFERENCES person (id),
	decided_at TEXT,
	ledger_id INTEGER REFERENCES points_ledger (id)
);

CREATE INDEX redemption_status ON redemption (status);
