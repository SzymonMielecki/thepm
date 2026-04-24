#!/usr/bin/env node
/**
 * Single entry for the product: the hub "runner" serves the web app, recorder PWA (`/recorder`),
 * WebSockets, and API from one process. Use `thepm bridge` when you need a separate repo
 * machine connected to this hub.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root =
	process.env.THEPM_ROOT?.replace(/\/$/, '') ||
	join(dirname(fileURLToPath(import.meta.url)), '..');
const node = process.execPath;
/** Resolve `tsx` when cwd is not the install (e.g. global `thepm` from another repo). —import must be a resolvable path. */
const tsxLoader = join(root, 'node_modules', 'tsx', 'dist', 'loader.mjs');
/** Shell cwd when `thepm` was invoked — passed as THEPM_INVOCATION_CWD for local project/PRD defaults. */
const invocationCwd = process.cwd();

const args = process.argv.slice(2);

function printHelp() {
	console.log(`Usage:
  thepm, thepm start   Run the hub (HTTP + /recorder PWA, WebSockets) — default http://0.0.0.0:5173 (override PORT)
  thepm bridge --…     Outbound code bridge to a remote hub (same flags as thepm-bridge)

Linear (optional; overrides LINEAR_* from .env):
  --linear-api-key <key>
  --linear-team-id <team>   (Linear team UUID)

Environment: set THEPM_ROOT to this repository if the script is copied outside the project.
When installed globally, the hub uses your current working directory as the project root for code/PRD unless PROJECT_ROOT is set.

For local development with Vite, use: npm run dev / pnpm dev
  Pass Linear flags after -- :  pnpm dev -- --linear-api-key … --linear-team-id …
For production: npm run build && thepm
`);
}

if (args[0] === 'help' || args[0] === '-h' || args[0] === '--help') {
	printHelp();
	process.exit(0);
}

const childEnv = {
	...process.env,
	THEPM_INVOCATION_CWD: invocationCwd
};

if (args[0] === 'bridge') {
	const cli = join(root, 'src', 'bridge-cli.ts');
	const p = spawn(node, ['--import', tsxLoader, cli, ...args.slice(1)], {
		cwd: invocationCwd,
		stdio: 'inherit',
		env: childEnv
	});
	p.on('exit', (code) => process.exit(code ?? 1));
} else {
	const startAliases = new Set(['start', 'run', 'serve']);
	const first = args[0];
	const rest = startAliases.has(first) ? args.slice(1) : args;
	const server = join(root, 'server.ts');
	/** Hub must run with install as cwd (./build, server imports); project root comes from THEPM_INVOCATION_CWD. */
	const p = spawn(node, ['--import', tsxLoader, server, ...rest], {
		cwd: root,
		stdio: 'inherit',
		env: childEnv
	});
	p.on('exit', (code) => process.exit(code ?? 1));
}
