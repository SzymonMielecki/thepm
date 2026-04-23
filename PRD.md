# Product Requirements (Root)

## Vision

The Always-On AI PM keeps your hackathon or fast-moving project documented and ticketed in sync with the live codebase.

## Goals

- Capture team discussion (audio → transcript → intent) with keyword highlighting for feature-related terms in the transcript display.
- Explore the repository with **ripgrep** and file reads, never stale RAG.
- Propose **Linear** tickets with intelligent priority assignment and assignee detection from transcripts, and update this **PRD** with human approval.

## Decisions

- **Single hub process (the "runner")** serves the full product: web dashboard, **mobile** capture at `/mobile` (PWA in the same build), and streaming APIs. One deployable binary/image; no separate mobile host. `thepm bridge` provides repository/PRD access from a different machine.
- Local-first hub on the developer machine; optional **Tailscale Funnel** for HTTPS to the PWA.
- **SQLite** for sessions, drafts, and transcript history; this file is the long-form root document.
