-- Delegations to Claude Code via bridge mux (single fixed team is hardcoded in the hub)

CREATE TABLE IF NOT EXISTS delegations (
	id TEXT PRIMARY KEY,
	draft_id TEXT NOT NULL REFERENCES ticket_drafts (id) ON DELETE CASCADE,
	target_kind TEXT NOT NULL CHECK (target_kind IN ('agent', 'team')),
	target_name TEXT NOT NULL,
	dispatch_mode TEXT,
	branch_base TEXT,
	status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
	summary TEXT,
	started_at TEXT,
	finished_at TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS delegation_runs (
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

CREATE TABLE IF NOT EXISTS delegation_events (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	delegation_id TEXT NOT NULL REFERENCES delegations (id) ON DELETE CASCADE,
	run_id TEXT REFERENCES delegation_runs (id) ON DELETE SET NULL,
	phase TEXT NOT NULL,
	detail TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_delegations_draft ON delegations (draft_id);
CREATE INDEX IF NOT EXISTS idx_delegation_runs_del ON delegation_runs (delegation_id);
CREATE INDEX IF NOT EXISTS idx_delegation_events_del ON delegation_events (delegation_id);

INSERT OR IGNORE INTO _migrations (id) VALUES ('002_agents');
