# thepm

Bridge-backed SvelteKit hub: **dashboard** at `/`, **mobile PWA** at `/mobile`, **SSE** at `/api/events`, and **WebSocket audio** at `/api/audio/stream`. All of that (including the mobile PWA) is served by the **same Node process** when you run `npm start` or the `thepm` CLI — there is no separate mobile host.

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

Open [http://localhost:5173](http://localhost:5173). Run `thepm bridge` from the target repo, then either open the printed `bridge_session` URL or paste the printed bridge token into the hub UI.

Production (custom `server.ts` attaches the audio WebSocket; this process **hosts** the web UI and `/mobile`):

```bash
npm run build
npm start
# or: pnpm thepm
```

Default URL: `http://0.0.0.0:5173` (same default port as `npm run dev`; set `PORT` to change it). The [`bin/thepm.mjs`](./bin/thepm.mjs) entry is the same runner (`pnpm thepm` = `node --import tsx server.ts`). Run `pnpm thepm bridge` from the target repository so the hub can access files and `PRD.md` (see [`packages/bridge/README.md`](./packages/bridge/README.md)).

### Run it outside this repo (or from any working directory)

The hub is **one installed tree** (built `build/`, `node_modules/`, `server.ts`, and `src/` for `tsx`). It does not need to live in your *application* project.

`thepm` starts the hub process. To expose a specific repository, run [`thepm bridge`](./packages/bridge/README.md) from that repo with `--hub-url`, `--project-root`, `--prd`, and `--workspace` (plus optional `--token`). If `--token` is omitted, the bridge generates a UUID token for that connection. The bridge process is the only code/PRD backend.
Each bridge connection prints:
- short-lived dashboard/mobile links with `bridge_session` query parameters, and
- dashboard/mobile links with `?token=...` for direct token prefill in the hub UI.
If `--token` was omitted, the printed token URL uses the generated UUID token for that connection.

Local dev example (hub running at `http://127.0.0.1:5173`):

```bash
thepm bridge \
  --hub-url http://127.0.0.1:5173 \
  --project-root . \
  --prd PRD.md \
  --workspace default
```

Optional: pass Linear credentials from the bridge (overrides hub `LINEAR_*` for that connection): `--linear-api-key …` and `--linear-team-id …` (alias `--lin-team-id`).

The hub and bridge are scoped as:
- **One hub instance = one project/repository context**
- **Many `/mobile` clients** can connect to that same hub/project

| Approach | You need on disk at runtime |
|----------|-----------------------------|
| **Docker** | No git checkout: build the image (or use a prebuilt one), `docker run -p 5173:5173 -e PORT=5173 -v …` with env. See the [`Dockerfile`](./Dockerfile) header comment. |
| **Install in a fixed path** | Clone the hub once to e.g. `/opt/thepm`, then `pnpm install && pnpm build`, copy `.env`, `cd` to your app repo and run `thepm` (or set `PROJECT_ROOT` in `.env`). |
| **Global CLI** | From a clone: `pnpm link -g` (or `npm link`) so `thepm` is on your `PATH`. Run it from the **application** directory you want to manage; `thepm` still resolves runtime files from the linked install. |
| **Loose `bin/thepm.mjs` only** | Set **`THEPM_ROOT`** to the **absolute** path of a full install (same as above). The wrapper in [`bin/thepm.mjs`](./bin/thepm.mjs) uses it when the script is not next to the rest of the package. |

There is no published `npm i -g` for this `private` package today; for “no copy of the app code,” use **Docker** or a private registry + global install of your own image.

## Environment variables

Copy [`.env.example`](.env.example) to **`.env`** in the project root. Values are loaded into `process.env` via [`dotenv`](https://github.com/motdotla/dotenv) from [`src/lib/server/load-dotenv.ts`](src/lib/server/load-dotenv.ts) (imported by Vite, `hooks.server.ts`, and `server.ts`). **`.env.local`** is also read and overrides `.env` (for machine-specific secrets).

Restart the dev server after changing env files.

Important:

| Variable | Purpose |
|----------|---------|
| `HUB_TOKEN` | Optional legacy static token. In bridge-first flow, use per-connection bridge tokens generated/provided by `thepm bridge` instead of storing a shared token in `.env`. |
| `HUB_TOKEN_AUTO` | Legacy derived-token toggle. Bridge-first flow does not depend on this setting. |
| `LLM_PROVIDER` | `anthropic` or `openai` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | LLM for LangGraph (intent, ticket draft) |
| `ELEVENLABS_API_KEY` | Streaming STT; override `ELEVENLABS_STT_URL` if your product uses a different WebSocket URL |
| `LINEAR_API_KEY` / `LINEAR_TEAM_ID` | Create issues when you **Approve** a draft |
| `PROJECT_ROOT` | Root for hub-local defaults (token derivation and fallback path metadata). The bridge still controls real code/PRD access for operations. |
| `PRD_PATH` | Path to root document (default `PRD.md` under the resolved project root) |
| `PRD_BOOTSTRAP` (alias: `BRIDGE_PRD_BOOTSTRAP`) | After a bridge connects, the hub can **write PRD.md** from a repo scan (`if_empty` = only when the file is missing or the default stub; `always` = overwrite; `off` = never). |
| `THEPM_INVOCATION_CWD` | Set by [`bin/thepm.mjs`](./bin/thepm.mjs) to the directory where you ran the command. Takes precedence over `PROJECT_ROOT` defaults. |

## Microphone on a phone (LAN vs HTTPS)

Browsers only grant **getUserMedia** in **secure contexts** (HTTPS, or `http://localhost`). So:

- **On the same machine:** open `http://127.0.0.1:<PORT>/mobile` (see `[hub] Mobile PWA` in the server log after `thepm` / `npm start`).
- **On another device (LAN):** use the **On LAN (device)** lines printed at startup, or use **Tailscale Funnel** / another HTTPS edge so the phone loads **HTTPS** (plain `http://<lan-ip>:5173` may block the mic). The WebSocket for streaming audio upgrades on the same origin: `ws://…/api/audio/stream` (or `wss://` with HTTPS). Use the same active bridge token (or the same `bridge_session` URL flow) on phone and desktop.

## Tailscale Funnel (HTTPS for the PWA mic)

Funnel only **proxies** to your machine. You must (1) run the app in one terminal, and (2) run Funnel with the **same port** in another.

| How you run the app | Funnel command |
|---------------------|----------------|
| `npm run dev` (Vite, default **5173**) | `tailscale funnel 5173` |
| `npm run build && npm start` (Node, default **5173**) | `tailscale funnel 5173` |

```bash
# Terminal A — the hub
npm run dev
# or: PORT=8080 npm start   # after build, if you need a different port

# Terminal B — expose HTTPS (Funnel must stay running)
tailscale funnel 5173
```

If the URL returns **“unable to handle this request”** or **502** / connection errors:

- Nothing is listening on the proxied port — start the app in Terminal A, or fix the Funnel port to match (see table).
- Check locally: `curl -I http://127.0.0.1:5173` should return `200` or `302` from SvelteKit.
- First-time Funnel: enable it for your tailnet (the `tailscale funnel` success message may link to [admin console](https://login.tailscale.com) → Funnel on).
- Ensure Tailscale is up: `tailscale status`.

Use the printed `https://…ts.net` URL on the phone (HTTPS lets the browser allow the microphone). Use the same active bridge token on the mobile page and desktop (or open the bridge-provided `bridge_session` URL on each).

## Development notes

- **Vite dev**: a small plugin attaches the same WebSocket upgrade as production (`src/lib/server/ws/ingest.ts`).
- **SQLite** database: `data/app.db` by default (`DATABASE_PATH` to override).
- **Tests**: `npm test` (Vitest).

## License

Private / your project.
