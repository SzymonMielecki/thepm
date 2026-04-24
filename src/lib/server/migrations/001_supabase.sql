-- Run once in the Supabase SQL Editor (Dashboard → SQL → New query).
-- Service-role server code bypasses RLS; tables stay private to your backend.

CREATE TABLE IF NOT EXISTS _migrations (
	id TEXT PRIMARY KEY,
	applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO _migrations (id) VALUES ('001_init') ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS sessions (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL DEFAULT 'Session',
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transcripts (
	id BIGSERIAL PRIMARY KEY,
	session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
	speaker_id TEXT,
	text TEXT NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ticket_drafts (
	id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
	title TEXT NOT NULL,
	description TEXT NOT NULL,
	assignee_hint TEXT,
	assignee_user_id TEXT,
	prd_section TEXT,
	prd_body TEXT,
	state TEXT NOT NULL DEFAULT 'pending',
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS session_speakers (
	id BIGSERIAL PRIMARY KEY,
	session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
	speaker_id TEXT NOT NULL,
	display_name TEXT,
	linear_user_id TEXT,
	linear_name TEXT,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	UNIQUE (session_id, speaker_id)
);

CREATE TABLE IF NOT EXISTS linear_tickets (
	id TEXT PRIMARY KEY,
	draft_id TEXT REFERENCES ticket_drafts (id),
	linear_identifier TEXT,
	url TEXT,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prd_revisions (
	id BIGSERIAL PRIMARY KEY,
	session_id TEXT,
	summary TEXT,
	content_before TEXT,
	content_after TEXT,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_traces (
	id BIGSERIAL PRIMARY KEY,
	session_id TEXT,
	phase TEXT NOT NULL,
	detail TEXT NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transcripts_session ON transcripts (session_id);
CREATE INDEX IF NOT EXISTS idx_drafts_session ON ticket_drafts (session_id);
CREATE INDEX IF NOT EXISTS idx_traces_session ON agent_traces (session_id);
CREATE INDEX IF NOT EXISTS idx_session_speakers_session ON session_speakers (session_id);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_speakers ENABLE ROW LEVEL SECURITY;
ALTER TABLE linear_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE prd_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_traces ENABLE ROW LEVEL SECURITY;
ALTER TABLE _migrations ENABLE ROW LEVEL SECURITY;
