# thepm-bridge (local)

## Run

All **per-repo** settings are **required command-line flags** (no `~/.config` or env for hub URL / token / paths).

```bash
pnpm thepm-bridge --help
```

From the project you are exposing (paths resolve against the current working directory):

```bash
thepm-bridge \
  --hub-url https://your-hub.example.com \
  --token "$HUB_TOKEN" \
  --project-root . \
  --prd PRD.md \
  --workspace default
```

`--token` must match the hub’s `HUB_TOKEN`. `--workspace` must match the hub’s `CODE_BRIDGE_WORKSPACE_ID` (default: `default`).

## System-wide (`thepm-bridge` on your PATH)

You still need this **git checkout** and `node_modules` (the CLI runs `tsx` + `src/bridge-cli.ts` from the repo).

1. From the repo root, install deps once: `pnpm install`
2. Link the package globally: `pnpm link --global` (or `npm link`)

If you copy only [`bin/thepm-bridge.mjs`](../../bin/thepm-bridge.mjs) elsewhere, set **`THEPM_ROOT`** to the absolute path of this repository and pass the same flags as above.

The hub must use `CODE_BACKEND=bridge` and `HUB_TOKEN` matching `--token`. **`rg` (ripgrep)** must be on `PATH` on the machine running the bridge.

**Note:** Putting `--token` on the command line is visible in shell history and on some systems to other users via `ps`. Prefer a short-lived token or a wrapper that reads from a file if that matters for you.

## Ship as a standalone binary (optional)

The CLI is `src/bridge-cli.ts` and uses the same `executeCodeOp` as the hub. To produce a single executable without the full repo on disk, use a bundler (e.g. **esbuild**, **Bun** `bun build --compile`, or **pkg**) and document that **`rg` is required** (or ship a [ripgrep](https://github.com/BurntSushi/ripgrep) binary next to the tool).

**Per-OS build:** run the same bundler on each target (macOS, Linux, Windows) in CI, output `thepm-bridge-macos`, `thepm-bridge-linux`, etc.
