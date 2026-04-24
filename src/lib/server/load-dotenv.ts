/**
 * SvelteKit does not put arbitrary .env keys on process.env for getEnv() —
 * load explicitly so HUB_TOKEN, API keys, etc. are available in server code.
 * Imported first from hooks.server.ts; also run from vite.config.ts and server.ts.
 *
 * Order: install (hub package) .env, then the **project** directory (THEPM_INVOCATION_CWD
 * from global `thepm` first, else PROJECT_ROOT / cwd) so per-app .env is loaded for the right repo.
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyLinearCliEnvFromArgv } from './linear-cli-env';

const installRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

config({ path: resolve(installRoot, '.env') });
config({ path: resolve(installRoot, '.env.local'), override: true });

const projectBase = resolve(
	process.env.THEPM_INVOCATION_CWD || process.env.PROJECT_ROOT || process.cwd()
);
if (projectBase !== installRoot) {
	config({ path: resolve(projectBase, '.env') });
	config({ path: resolve(projectBase, '.env.local'), override: true });
}

/** Process working directory (e.g. `pnpm start` from the repo) wins over a wrong `import.meta` install path. */
const cwd = process.cwd();
config({ path: resolve(cwd, '.env') });
config({ path: resolve(cwd, '.env.local'), override: true });

applyLinearCliEnvFromArgv(process.argv);
