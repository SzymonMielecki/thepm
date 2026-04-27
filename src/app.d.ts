// See https://svelte.dev/docs/kit/types#app.d.ts
import type { AppDatabase } from '$lib/server/db';

declare global {
	/** Injected by Vite `define` for bundled code; absent when running TS sources via `tsx` (e.g. `server.ts`). */
	var __THEPM_INIT_SQL__: string | undefined;

	namespace App {
		interface Locals {
			db: AppDatabase;
		}
	}
}

export {};
