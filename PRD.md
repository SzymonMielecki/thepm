# Product Requirements (Root)

## Vision

The Always-On AI PM keeps your hackathon or fast-moving project documented and ticketed in sync with the live codebase.

## Goals

- Capture team discussion (audio → transcript → intent).
- Explore the repository with **ripgrep** and file reads, never stale RAG.
- Propose **Linear** tickets and update this **PRD** with human approval.
- Expose the same context to Cursor and other tools via **MCP** at `/api/mcp`.

## Decisions

- Local-first hub on the developer machine; optional **Tailscale Funnel** for HTTPS to the PWA.
- **SQLite** for sessions, drafts, and transcript history; this file is the long-form root document.
