/**
 * SvelteKit does not put arbitrary .env keys on process.env for getEnv() —
 * load explicitly so HUB_TOKEN, API keys, etc. are available in server code.
 * Imported first from hooks.server.ts; also run from vite.config.ts and server.ts.
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

config({ path: resolve(root, '.env') });
config({ path: resolve(root, '.env.local'), override: true });
