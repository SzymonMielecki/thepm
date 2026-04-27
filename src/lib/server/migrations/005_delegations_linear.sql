-- Allow delegations sourced from a Linear issue without a hub ticket_draft (nullable draft_id).

PRAGMA foreign_keys = OFF;

CREATE TABLE _delegations_backup AS SELECT * FROM delegations;
CREATE TABLE _runs_backup AS SELECT * FROM delegation_runs;
CREATE TABLE _events_backup AS SELECT * FROM delegation_events;

DROP TABLE delegation_events;
DROP TABLE delegation_runs;
DROP TABLE delegations;

CREATE TABLE delegations (
	id TEXT PRIMARY KEY,
	draft_id TEXT REFERENCES ticket_drafts (id) ON DELETE CASCADE,
	linear_issue_id TEXT,
	target_kind TEXT NOT NULL CHECK (target_kind IN ('agent', 'team')),
	target_name TEXT NOT NULL,
	dispatch_mode TEXT,
	branch_base TEXT,
	status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
	summary TEXT,
	started_at TEXT,
	finished_at TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now')),
	CHECK (draft_id IS NOT NULL OR linear_issue_id IS NOT NULL)
);

INSERT INTO delegations (id, draft_id, linear_issue_id, target_kind, target_name, dispatch_mode, branch_base, status, summary, started_at, finished_at, created_at, updated_at)
SELECT id, draft_id, NULL, target_kind, target_name, dispatch_mode, branch_base, status, summary, started_at, finished_at, created_at, updated_at
FROM _delegations_backup;

CREATE TABLE delegation_runs (
	id TEXT PRIMARY KEY,
	delegation_id TEXT NOT NULL REFERENCES delegations (id) ON DELETE CASCADE,
	agent_name TEXT NOT NULL,
	position INTEGER NOT NULL,
	worktree_path TEXT,
	branch_name TEXT,
	mux_window_id TEXT,
	pid INTEGER,
	status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
	exit_code INTEGER,
	result_summary TEXT,
	started_at TEXT,
	finished_at TEXT
);

INSERT INTO delegation_runs SELECT * FROM _runs_backup;

CREATE TABLE delegation_events (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	delegation_id TEXT NOT NULL REFERENCES delegations (id) ON DELETE CASCADE,
	run_id TEXT REFERENCES delegation_runs (id) ON DELETE SET NULL,
	phase TEXT NOT NULL,
	detail TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO delegation_events SELECT * FROM _events_backup;

DROP TABLE _delegations_backup;
DROP TABLE _runs_backup;
DROP TABLE _events_backup;

CREATE INDEX IF NOT EXISTS idx_delegations_draft ON delegations (draft_id);
CREATE INDEX IF NOT EXISTS idx_delegations_linear_issue ON delegations (linear_issue_id);
CREATE INDEX IF NOT EXISTS idx_delegation_runs_del ON delegation_runs (delegation_id);
CREATE INDEX IF NOT EXISTS idx_delegation_events_del ON delegation_events (delegation_id);

PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO _migrations (id) VALUES ('005_delegations_linear');
