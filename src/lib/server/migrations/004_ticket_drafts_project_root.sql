-- Per-repo draft scoping: bridge and hub can share one hub.db; drafts must not leak across repositories.

ALTER TABLE ticket_drafts ADD COLUMN project_root TEXT;

CREATE INDEX IF NOT EXISTS idx_drafts_project_root ON ticket_drafts (project_root);

-- Rows created before this column cannot be attributed to a repository; remove so they are not shown for every connected repo.
DELETE FROM linear_tickets;
DELETE FROM ticket_drafts;

INSERT OR IGNORE INTO _migrations (id) VALUES ('004_ticket_drafts_project_root');
