#!/usr/bin/env node
/**
 * Global entry: run from any directory if the package is linked, or set THEPM_ROOT
 * to this repository when the script is copied/symlinked elsewhere.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root =
	process.env.THEPM_ROOT?.replace(/\/$/, '') ||
	join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'bridge-cli.ts');
const tsxLoader = join(root, 'node_modules', 'tsx', 'dist', 'loader.mjs');
const invocationCwd = process.cwd();

const p = spawn(process.execPath, ['--import', tsxLoader, cli, ...process.argv.slice(2)], {
	cwd: invocationCwd,
	stdio: 'inherit',
	env: { ...process.env, THEPM_INVOCATION_CWD: invocationCwd }
});
p.on('exit', (code) => process.exit(code ?? 1));
