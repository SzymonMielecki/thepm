#!/usr/bin/env node
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};

// src/lib/server/config.ts
import { resolve as resolve2, dirname, join as join2 } from "node:path";
import { fileURLToPath } from "node:url";
function projectBaseDir() {
  return resolve2(process.env.THEPM_INVOCATION_CWD || process.env.PROJECT_ROOT || process.cwd());
}
function getProjectPaths() {
  const projectRoot = projectBaseDir();
  const prdPath = resolve2(projectRoot, process.env.PRD_PATH || "PRD.md");
  return { projectRoot, prdPath };
}
var __dirname, serverRoot;
var init_config = __esm({
  "src/lib/server/config.ts"() {
    "use strict";
    __dirname = dirname(fileURLToPath(import.meta.url));
    serverRoot = join2(__dirname, "../../../..");
  }
});

// src/bridge-cli.ts
import { parseArgs } from "node:util";
import { resolve as resolve3 } from "node:path";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { z } from "zod";

// src/lib/server/code-bridge/execute-op.ts
import { writeFileSync as writeFileSync2, existsSync as existsSync3, mkdirSync as mkdirSync2 } from "node:fs";
import { dirname as dirname3 } from "node:path";

// src/lib/server/fs-scoped.ts
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
function isPathInsideRoot(root, candidate) {
  const r = resolve(root);
  const t = resolve(candidate);
  const rel = relative(r, t);
  if (rel === "" || rel === ".") return true;
  return !rel.startsWith("..") && !resolve(r, rel).startsWith("..");
}
function readScopedFile(root, relPath) {
  const abs = join(root, relPath);
  if (!isPathInsideRoot(root, abs)) throw new Error("Path escapes PROJECT_ROOT");
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    throw new Error("File not found or not a file");
  }
  return readFileSync(abs, "utf-8");
}
function listScopedDir(root, relPath) {
  const abs = relPath ? join(root, relPath) : root;
  if (!isPathInsideRoot(root, abs)) throw new Error("Path escapes PROJECT_ROOT");
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    return [];
  }
  return readdirSync(abs).map((name) => ({
    name,
    isDir: statSync(join(abs, name)).isDirectory()
  }));
}

// src/lib/server/ripgrep.ts
init_config();
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
var pExec = promisify(execFile);
var warnedMissing = false;
async function ensureRipgrep() {
  try {
    await pExec("rg", ["--version"], { env: process.env, maxBuffer: 1024 * 1024 });
  } catch {
    if (!warnedMissing) {
      console.error(
        "[ripgrep] `rg` not found in PATH. Install: https://github.com/BurntSushi/ripgrep#installation"
      );
      warnedMissing = true;
    }
    throw new Error("`rg` (ripgrep) is not installed or not in PATH");
  }
}
async function runRipgrep(pattern, options) {
  await ensureRipgrep();
  const { projectRoot: rootFromConfig } = getProjectPaths();
  const projectRoot = options?.projectRoot ?? rootFromConfig;
  const max = options?.max ?? 40;
  const target = options?.path ?? ".";
  const args = [
    "--json",
    "--line-number",
    "--no-heading",
    "--max-count",
    String(max),
    pattern,
    target
  ];
  let stdout;
  try {
    const r = await pExec("rg", args, {
      cwd: projectRoot,
      maxBuffer: 8 * 1024 * 1024,
      env: process.env
    });
    stdout = r.stdout.toString();
  } catch (e) {
    const err = e;
    if (err.code === 1) return [];
    if (err.stdout) stdout = err.stdout.toString();
    else throw e;
  }
  const lines = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      if (j.type === "match" && j.data?.path?.text) {
        lines.push({
          path: j.data.path.text,
          line: j.data.line_number,
          text: (j.data.lines?.text ?? "").replace(/^\n?/, "")
        });
      }
    } catch {
    }
  }
  return lines;
}

// src/lib/server/prd/store.ts
import { readFileSync as readFileSync2, writeFileSync, existsSync as existsSync2, mkdirSync } from "node:fs";
import { dirname as dirname2 } from "node:path";
import chokidar from "chokidar";

// src/lib/server/bus.ts
var BUS_KEY = Symbol.for("thepm.hubEventBus");

// src/lib/server/prd/store.ts
init_config();
import { diffLines } from "diff";
function patchSection(markdown, sectionTitle, newBody) {
  const want = sectionTitle.replace(/^#+\s*/, "").trim();
  const lines = markdown.split("\n");
  let targetStart = -1;
  let targetLevel = 2;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#+)\s+(.+)$/.exec(lines[i] ?? "");
    if (m) {
      const level = m[1].length;
      const t = m[2].trim();
      if (t === want || t.toLowerCase() === want.toLowerCase()) {
        targetStart = i;
        targetLevel = level;
        break;
      }
    }
  }
  if (targetStart < 0) {
    const sep = markdown.trim().length ? "\n\n" : "";
    return { ok: true, out: `${markdown}${sep}## ${want}

${newBody.trim()}
` };
  }
  let end = lines.length;
  for (let j = targetStart + 1; j < lines.length; j++) {
    const m = /^(#+)\s/.exec(lines[j] ?? "");
    if (m) {
      const L = m[1].length;
      if (L <= targetLevel) {
        end = j;
        break;
      }
    }
  }
  const before = lines.slice(0, targetStart + 1).join("\n");
  const after = lines.slice(end).join("\n");
  const mid = newBody.trim();
  const newMd = [before, mid, after].filter(Boolean).join("\n\n");
  return { ok: true, out: newMd + (newMd.endsWith("\n") ? "" : "\n") };
}
function getPrdContent(path) {
  if (!existsSync2(path)) {
    const dir = dirname2(path);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path,
      "# Product Requirements (Root)\n\n## Vision\n\n## Goals\n\n## Decisions\n\n",
      "utf-8"
    );
  }
  return readFileSync2(path, "utf-8");
}

// src/lib/server/code-bridge/execute-op.ts
async function executeCodeOp(ctx, op, args) {
  switch (op) {
    case "read_file": {
      const rel = typeof args.path === "string" ? args.path : "";
      if (!rel) throw new Error("read_file: path required");
      return readScopedFile(ctx.projectRoot, rel);
    }
    case "list_dir": {
      const p = typeof args.path === "string" ? args.path : "";
      return listScopedDir(ctx.projectRoot, p);
    }
    case "ripgrep": {
      const pattern = typeof args.pattern === "string" ? args.pattern : "";
      if (pattern.length < 1) throw new Error("ripgrep: pattern required");
      const subpath = typeof args.subpath === "string" ? args.subpath : void 0;
      const max = typeof args.max === "number" ? args.max : 40;
      const hits = await runRipgrep(pattern, { path: subpath, max, projectRoot: ctx.projectRoot });
      return { hits };
    }
    case "prd_read": {
      return getPrdContent(ctx.prdPath);
    }
    case "prd_patch": {
      const section = typeof args.section === "string" ? args.section : "";
      const newBody = typeof args.newBody === "string" ? args.newBody : "";
      if (!section) throw new Error("prd_patch: section required");
      const before = getPrdContent(ctx.prdPath);
      const r = patchSection(before, section, newBody);
      if (!r.ok) {
        return { ok: false, error: r.error };
      }
      const prdDir = dirname3(ctx.prdPath);
      if (!existsSync3(prdDir)) {
        mkdirSync2(prdDir, { recursive: true });
      }
      writeFileSync2(ctx.prdPath, r.out, "utf-8");
      return { ok: true, before, after: r.out, content: r.out };
    }
    case "prd_write_full": {
      const content = typeof args.content === "string" ? args.content : "";
      const before = getPrdContent(ctx.prdPath);
      if (before === content) {
        return { before, after: content, skipped: true };
      }
      const prdDir = dirname3(ctx.prdPath);
      if (!existsSync3(prdDir)) {
        mkdirSync2(prdDir, { recursive: true });
      }
      writeFileSync2(ctx.prdPath, content, "utf-8");
      return { before, after: content };
    }
    default: {
      const _x = op;
      throw new Error(`Unknown op: ${String(_x)}`);
    }
  }
}

// src/bridge-cli.ts
var USAGE = `Usage: thepm bridge \\
  --hub-url <https://your-hub.example.com> \\
  --project-root <path> \\
  --prd <path-to-PRD.md> \\
  [--token <BRIDGE_TOKEN>] \\
  [--workspace <id>]     (default: default; must match hub CODE_BRIDGE_WORKSPACE_ID) \\
  [--linear-api-key <key>] [--linear-team-id <uuid>]  (override hub LINEAR_* for this connection; \\
                          alias: --lin-team-id)

Example (run from the repo you are exposing):
  thepm bridge \\
  --hub-url https://pm.example.com \\
  --project-root . \\
  --prd PRD.md \\
  --workspace default

(Older installs may still invoke \`thepm-bridge\` with the same flags.)

Options:
  -h, --help    Show this message

Requires: ripgrep (\`rg\`) on PATH. If \`--token\` is omitted, a UUID token is generated for this connection.
After a successful connect, the hub may auto-generate PRD.md from this repo (see hub env \`BRIDGE_PRD_BOOTSTRAP\`; requires an LLM configured on the hub).

Troubleshooting: If you see ECONNREFUSED, the hub is not listening on that URL/port \u2014 start the app from
this repo (e.g. pnpm dev) and use the exact origin Vite prints (port may not be 5173 if the port is busy).
`;
var flagsSchema = z.object({
  "hub-url": z.string().url(),
  token: z.string().min(1, "token must not be empty").optional(),
  "project-root": z.string().min(1, "project-root must not be empty"),
  prd: z.string().min(1, "prd must not be empty"),
  workspace: z.string().min(1).default("default"),
  "linear-api-key": z.string().optional(),
  "linear-team-id": z.string().optional()
});
function printUsage() {
  console.log(USAGE);
}
function parseBridgeCli() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "hub-url": { type: "string" },
      token: { type: "string" },
      "project-root": { type: "string" },
      prd: { type: "string" },
      workspace: { type: "string" },
      "linear-api-key": { type: "string" },
      "linear-team-id": { type: "string" },
      "lin-team-id": { type: "string" },
      help: { type: "boolean", short: "h" }
    },
    allowPositionals: false,
    strict: true
  });
  if (values.help) {
    printUsage();
    process.exit(0);
  }
  const errors = [];
  if (!values["hub-url"]) errors.push("--hub-url is required");
  if (!values["project-root"]) errors.push("--project-root is required");
  if (!values.prd) errors.push("--prd is required");
  if (errors.length) {
    console.error(errors.join("\n") + "\n");
    printUsage();
    process.exit(1);
  }
  const teamFromBridge = values["linear-team-id"]?.trim() || values["lin-team-id"]?.trim();
  const raw = {
    "hub-url": values["hub-url"].trim(),
    token: values.token?.trim(),
    "project-root": values["project-root"].trim(),
    prd: values.prd.trim(),
    workspace: (values.workspace ?? "default").trim() || "default",
    "linear-api-key": values["linear-api-key"]?.trim(),
    "linear-team-id": teamFromBridge
  };
  const f = flagsSchema.safeParse(raw);
  if (!f.success) {
    console.error("Invalid flags:", f.error.format());
    process.exit(1);
  }
  return f.data;
}
function isConnRefused(e) {
  if (!e) return false;
  const err = e;
  if (err.code === "ECONNREFUSED") return true;
  if (typeof err.message === "string" && err.message.includes("ECONNREFUSED")) return true;
  if (Array.isArray(err.errors)) {
    return err.errors.some((x) => isConnRefused(x));
  }
  return false;
}
function printConnRefusedHint(dialUrl) {
  console.error(
    `[thepm-bridge] Nothing accepted the WebSocket (TCP connection refused). Check:
  1) The hub is running in this project: \`pnpm dev\` (or \`pnpm start\` after \`pnpm build\`).
  2) \`--hub-url\` matches the origin Vite prints (e.g. http://127.0.0.1:5173) \u2014 if the port is taken, the port in the log changes.
  3) You are not pointing at another repo or a stopped process.
  Attempted: ${dialUrl}
`
  );
}
function uiUrlWithSession(hubUrl, routePath, sessionToken, token) {
  const u = new URL(routePath, hubUrl);
  u.searchParams.set("bridge_session", sessionToken);
  if (token) u.searchParams.set("token", token);
  return u.toString();
}
function uiUrlWithToken(hubUrl, routePath, token) {
  const u = new URL(routePath, hubUrl);
  u.searchParams.set("token", token);
  return u.toString();
}
async function main() {
  const f = parseBridgeCli();
  const hubUrl = f["hub-url"].replace(/\/$/, "");
  const projectRoot = resolve3(process.cwd(), f["project-root"]);
  const prdPath = resolve3(process.cwd(), f.prd);
  const workspace = f.workspace;
  const hubToken = f.token?.trim() || randomUUID();
  const ctx = { projectRoot, prdPath };
  const u = new URL(hubUrl);
  const protocol = u.protocol === "https:" ? "wss:" : u.protocol === "http:" ? "ws:" : u.protocol;
  const qp = { workspace };
  if (hubToken) qp.token = hubToken;
  const qs = new URLSearchParams(qp).toString();
  const url = `${protocol}//${u.host}/api/bridge?${qs}`;
  console.log(`[thepm-bridge] connecting to ${u.host}/api/bridge (workspace=${workspace})`);
  if (!f.token) {
    console.log(`[thepm-bridge] Generated bridge token: ${hubToken}`);
  }
  let reportedConnRefused = false;
  const ws = new WebSocket(url);
  const send = (o) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(o));
    }
  };
  ws.on("open", () => {
    const hello = {
      type: "bridge_hello",
      workspaceId: workspace,
      projectRoot,
      prdPath
    };
    const lk = f["linear-api-key"]?.trim();
    const lt = f["linear-team-id"]?.trim();
    if (lk) hello.linearApiKey = lk;
    if (lt) hello.linearTeamId = lt;
    send(hello);
  });
  ws.on("message", async (data) => {
    let j;
    try {
      j = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!j || typeof j !== "object") return;
    const t = j.type;
    if (t === "bridge_ack") {
      if (j.ok) {
        const sessionToken = j.uiSessionToken;
        const sessionExpiresAt = j.uiSessionExpiresAt;
        console.log("[thepm-bridge] ready");
        if (sessionToken) {
          console.log(
            `[thepm-bridge] Open dashboard: ${uiUrlWithSession(hubUrl, "/", sessionToken, hubToken)}`
          );
          console.log(
            `[thepm-bridge] Open mobile:    ${uiUrlWithSession(hubUrl, "/mobile", sessionToken, hubToken)}`
          );
          if (typeof sessionExpiresAt === "number" && Number.isFinite(sessionExpiresAt)) {
            console.log(
              `[thepm-bridge] Session expires: ${new Date(sessionExpiresAt).toISOString()}`
            );
          }
        }
        console.log(
          `[thepm-bridge] Open dashboard (token): ${uiUrlWithToken(hubUrl, "/", hubToken)}`
        );
        console.log(
          `[thepm-bridge] Open mobile (token):    ${uiUrlWithToken(hubUrl, "/mobile", hubToken)}`
        );
      } else {
        console.error("[thepm-bridge] refused:", j.error);
        process.exit(1);
      }
      return;
    }
    if (t === "code_req") {
      const req = j;
      try {
        const result = await executeCodeOp(ctx, req.op, req.args);
        send({ type: "code_res", id: req.id, ok: true, result });
      } catch (e) {
        const msg = e.message;
        send({ type: "code_res", id: req.id, ok: false, error: msg });
      }
    }
  });
  ws.on("close", (c, r) => {
    if (reportedConnRefused) {
      process.exit(1);
      return;
    }
    console.log("[thepm-bridge] closed", c, r?.toString());
    process.exit(c === 1e3 ? 0 : 1);
  });
  ws.on("error", (e) => {
    if (isConnRefused(e)) {
      reportedConnRefused = true;
      printConnRefusedHint(url);
    } else {
      console.error("[thepm-bridge]", e);
    }
  });
}
void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
