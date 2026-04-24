# thepm – Product Requirements Document

## Vision
**thepm** is a bridge-backed SvelteKit hub that provides a unified dashboard and mobile PWA for managing project context, code, and PRD documents. It integrates with LLM providers (Anthropic, OpenAI) and Linear for issue tracking, enabling AI-assisted intent parsing, ticket drafting, and voice-based interaction via streaming audio.

## Goals
1. **Single unified interface** for project management across desktop and mobile
2. **Bridge-first architecture** enabling secure, token-based connections to remote repositories
3. **Voice-enabled mobile PWA** with streaming audio (STT/TTS via ElevenLabs)
4. **AI-powered workflows** (intent parsing, ticket drafting) via LangGraph
5. **Zero-copy deployment** options (Docker, global CLI, fixed install paths)
6. **Real-time sync** between hub and bridge via WebSocket and SSE

## Technical Overview
- **Frontend:** SvelteKit 5 + Svelte 5 + Tailwind CSS 4
- **Backend:** Node.js 20+ with custom `server.ts` (WebSocket audio, SSE events)
- **Database:** better-sqlite3 (native addon)
- **LLM/Agentic:** LangChain (Anthropic, OpenAI), LangGraph
- **File watching:** chokidar
- **CLI:** bin/thepm.mjs (entry point), bin/thepm-bridge.mjs (bridge runner)
- **Package manager:** pnpm (with onlyBuiltDependencies for better-sqlite3)

### Architecture
- **Hub process** (one per project context): serves `/` (dashboard), `/recorder` (PWA), `/api/events` (SSE), `/api/audio/stream` (WebSocket)
- **Bridge process** (per repository): runs `thepm bridge` from target repo, exposes code/PRD via secure token-based connection
- **No separate mobile host:** mobile PWA served by same Node process as dashboard

## Features / Scope (Inferred)

### Dashboard (`/`)
- Project context display
- PRD document viewer/editor
- Bridge connection management (token-based)
- Linear issue integration (create/view)
- Real-time event stream (SSE)

### Mobile PWA (`/recorder`; `/mobile` redirects for compatibility)
- Responsive interface for phone/tablet
- Microphone access (secure context: HTTPS or localhost)
- Streaming audio input (WebSocket `/api/audio/stream`)
- Same bridge token flow as desktop

### Voice & Audio
- **Streaming STT:** ElevenLabs WebSocket (configurable URL)
- **WebSocket endpoint:** `/api/audio/stream` (custom `server.ts`)
- **LAN/HTTPS:** Tailscale Funnel support for HTTPS on LAN devices

### LLM & Agentic
- **Intent parsing:** LangGraph workflow
- **Ticket drafting:** AI-assisted issue creation
- **Provider selection:** `LLM_PROVIDER` env (anthropic | openai)

### Bridge & Code Access
- **Token-based auth:** per-connection UUID or static `HUB_TOKEN`
- **File access:** ripgrep (`rg`) for code search
- **PRD bootstrap:** auto-generate PRD.md from repo scan (if_empty | always | off)
- **Linear credentials:** per-bridge override (--linear-api-key, --linear-team-id)

### Deployment Modes
1. **Docker:** no git checkout needed, env-based config
2. **Fixed install path:** `/opt/thepm` + `pnpm link -g` for global CLI
3. **Global CLI:** `npm link` from clone, run from app directory
4. **Loose bin/thepm.mjs:** set `THEPM_ROOT` env to full install path

## Non-Goals
- **Separate mobile backend:** mobile PWA is served by the same Node process
- **Published npm package:** currently private; no global `npm i -g thepm`
- **Multi-project hub:** one hub instance = one project/repository context
- **Persistent token storage in .env:** bridge-first flow uses per-connection tokens

## Decisions
1. **Native addon (better-sqlite3):** chosen for performance; requires rebuild on Node version change
2. **Bridge-first auth:** per-connection tokens over static HUB_TOKEN (legacy fallback retained)
3. **Unified process:** WebSocket + SSE + web UI in one Node server (no separate mobile host)
4. **Vite + SvelteKit:** modern, fast dev experience; Node adapter for production
5. **LangChain/LangGraph:** composable AI workflows over monolithic LLM calls
6. **ElevenLabs for STT:** configurable WebSocket URL for flexibility

## Risks
1. **better-sqlite3 native build:** breaks on Node version mismatch; requires user rebuild
2. **Microphone access:** browser security (HTTPS/localhost only); LAN users need Tailscale Funnel or HTTPS edge
3. **Bridge token leakage:** short-lived `bridge_session` URLs mitigate; static tokens less secure
4. **Single hub instance per project:** no multi-tenancy; users must run separate hubs for multiple projects
5. **ripgrep dependency:** external tool required on PATH; not bundled
6. **LLM API costs:** streaming audio + intent parsing + ticket drafting can incur significant charges

## Open Questions
1. **Persistence layer:** does better-sqlite3 store bridge sessions, intent history, or draft tickets? Schema not evident from repo structure.
2. **LangGraph workflows:** what are the exact intent parsing and ticket drafting graphs? (referenced but not detailed)
3. **Linear integration scope:** does the hub create issues, update them, or both? Permissions model?
4. **PRD bootstrap logic:** what triggers `if_empty` vs `always` vs `off`? How is the scan performed?
5. **Mobile PWA offline support:** is there a service worker? Sync strategy for offline edits?
6. **Scalability:** can one hub handle many concurrent `/recorder` clients? Any connection limits?
7. **Bridge reconnection:** what happens if a bridge disconnects? Auto-reconnect, or manual re-run?
8. **Audit/logging:** are bridge operations, LLM calls, or Linear changes logged? Where?
9. **Testing coverage:** what does `vitest run` cover? Unit, integration, or e2e?
10. **Tailscale Funnel requirement:** is this the only HTTPS option for LAN, or are other reverse proxies supported?