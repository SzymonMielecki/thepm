-- Editable agent catalog + ad-hoc teams (overrides built-in defaults when present)

CREATE TABLE IF NOT EXISTS delegation_catalog_agents (
	name TEXT PRIMARY KEY,
	description TEXT NOT NULL DEFAULT '',
	tools TEXT NOT NULL DEFAULT '',
	model TEXT NOT NULL DEFAULT '',
	body TEXT NOT NULL,
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agent_teams_adhoc (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL UNIQUE,
	description TEXT,
	dispatch_mode TEXT NOT NULL DEFAULT 'parallel' CHECK (dispatch_mode IN ('parallel', 'sequential')),
	members_json TEXT NOT NULL,
	prompt_template TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO _migrations (id) VALUES ('003_catalog');
