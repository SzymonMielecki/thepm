# Always-On AI Product Manager

Local-first SvelteKit hub: **dashboard** at `/`, **mobile PWA** at `/mobile`, **MCP** at `/api/mcp`, **SSE** at `/api/events`, and **WebSocket audio** at `/api/audio/stream`.

## Prerequisites

- **Node.js** 20+
- **`rg` (ripgrep)** on `PATH` — [install](https://github.com/BurntSushi/ripgrep#installation)
- API keys as below (the app surfaces clear banners if something is missing)

## Quick start

```bash
cp .env.example .env
# Edit .env with your keys

npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Set **HUB_TOKEN** in the UI (or leave empty if `HUB_TOKEN` is unset in `.env`) and use **Reconnect SSE** after changing the token.

Production (custom `server.ts` attaches the audio WebSocket):

```bash
npm run build
npm start
```

Default URL: `http://0.0.0.0:3000`.

## Environment variables

See [`.env.example`](.env.example). Important:

| Variable | Purpose |
|----------|---------|
| `HUB_TOKEN` | Optional shared secret. If set, required on `Authorization: Bearer`, `?token=`, `X-Hub-Token`, WebSocket query, and MCP. |
| `LLM_PROVIDER` | `anthropic` or `openai` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | LLM for LangGraph (intent, ticket draft) |
| `ELEVENLABS_API_KEY` | Streaming STT; override `ELEVENLABS_STT_URL` if your product uses a different WebSocket URL |
| `LINEAR_API_KEY` / `LINEAR_TEAM_ID` | Create issues when you **Approve** a draft |
| `PROJECT_ROOT` | Root for `read_file`, `ripgrep`, `list_dir` (defaults to cwd) |
| `PRD_PATH` | Path to root document (default `PRD.md` under `PROJECT_ROOT`) |

## Tailscale Funnel (HTTPS for the PWA mic)

```bash
tailscale funnel 3000
```

Use the printed `https://…` URL on the phone so the browser allows microphone access. Set the same `HUB_TOKEN` on the mobile page and desktop.

## MCP (Cursor, etc.)

Endpoint: **`POST` / `GET` / `DELETE` `https://<host>/api/mcp`** (Streamable HTTP via `@modelcontextprotocol/sdk`).

Tools: `read_file`, `list_dir`, `ripgrep`, `prd_read`, `prd_patch`, `list_tickets`.

If `HUB_TOKEN` is set, send it as `Authorization: Bearer <token>` or `?token=`.

## Development notes

- **Vite dev**: a small plugin attaches the same WebSocket upgrade as production (`src/lib/server/ws/ingest.ts`).
- **SQLite** database: `data/app.db` by default (`DATABASE_PATH` to override).
- **Tests**: `npm test` (Vitest).

## License

Private / your project.
