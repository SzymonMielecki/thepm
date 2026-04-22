-- Metadata
CREATE TABLE IF NOT EXISTS _migrations (
	id TEXT PRIMARY KEY,
	applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO _migrations (id) VALUES ('001_init');

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL DEFAULT 'Session',
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Transcript segments
CREATE TABLE IF NOT EXISTS transcripts (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
	speaker_id TEXT,
	text TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Drafts before Linear
CREATE TABLE IF NOT EXISTS ticket_drafts (
	id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
	title TEXT NOT NULL,
	description TEXT NOT NULL,
	assignee_hint TEXT,
	state TEXT NOT NULL DEFAULT 'pending',
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Created Linear issues
CREATE TABLE IF NOT EXISTS linear_tickets (
	id TEXT PRIMARY KEY,
	draft_id TEXT REFERENCES ticket_drafts (id),
	linear_identifier TEXT,
	url TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- PRD revision log
CREATE TABLE IF NOT EXISTS prd_revisions (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	session_id TEXT,
	summary TEXT,
	content_before TEXT,
	content_after TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Agent trace for UI
CREATE TABLE IF NOT EXISTS agent_traces (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	session_id TEXT,
	phase TEXT NOT NULL,
	detail TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transcripts_session ON transcripts (session_id);
CREATE INDEX IF NOT EXISTS idx_drafts_session ON ticket_drafts (session_id);
CREATE INDEX IF NOT EXISTS idx_traces_session ON agent_traces (session_id);
