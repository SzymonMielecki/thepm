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

const p = spawn(process.execPath, ['--import', 'tsx', cli, ...process.argv.slice(2)], {
	cwd: root,
	stdio: 'inherit',
	env: { ...process.env }
});
p.on('exit', (code) => process.exit(code ?? 1));
