# Always-On AI Product Manager

Local-first SvelteKit hub: **dashboard** at `/`, **mobile PWA** at `/mobile`, **MCP** at `/api/mcp`, **SSE** at `/api/events`, and **WebSocket audio** at `/api/audio/stream`.

## Troubleshooting: `better-sqlite3` (“Could not locate the bindings file”)

`better-sqlite3` ships a **native** addon. After **changing Node version**, a fresh `pnpm install` / `npm install`, or if pnpm **blocked** the build, you must compile it for your current runtime:

```bash
pnpm rebuild better-sqlite3
# or: npm rebuild better-sqlite3
# or:  cd node_modules/better-sqlite3 && npm run build-release
```

You need a normal native toolchain (on macOS: Xcode CLT, `python3` for `node-gyp`). **Node 25** can work but **Node 20 LTS** has the widest prebuilt support.

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

Copy [`.env.example`](.env.example) to **`.env`** in the project root. Values are loaded into `process.env` via [`dotenv`](https://github.com/motdotla/dotenv) from [`src/lib/server/load-dotenv.ts`](src/lib/server/load-dotenv.ts) (imported by Vite, `hooks.server.ts`, and `server.ts`). **`.env.local`** is also read and overrides `.env` (for machine-specific secrets).

Restart the dev server after changing env files.

Important:

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

Funnel only **proxies** to your machine. You must (1) run the app in one terminal, and (2) run Funnel with the **same port** in another.

| How you run the app | Funnel command |
|---------------------|----------------|
| `npm run dev` (Vite, default **5173**) | `tailscale funnel 5173` |
| `npm run build && npm start` (Node, default **3000**) | `tailscale funnel 3000` |

```bash
# Terminal A — the hub
npm run dev
# or: PORT=3000 npm start   # after build

# Terminal B — expose HTTPS (Funnel must stay running)
tailscale funnel 5173
```

If the URL returns **“unable to handle this request”** or **502** / connection errors:

- Nothing is listening on the proxied port — start the app in Terminal A, or fix the Funnel port to match (see table).
- Check locally: `curl -I http://127.0.0.1:5173` should return `200` or `302` from SvelteKit.
- First-time Funnel: enable it for your tailnet (the `tailscale funnel` success message may link to [admin console](https://login.tailscale.com) → Funnel on).
- Ensure Tailscale is up: `tailscale status`.

Use the printed `https://…ts.net` URL on the phone (HTTPS lets the browser allow the microphone). Set the same `HUB_TOKEN` on the mobile page and desktop if you use one.

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
