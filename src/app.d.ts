// See https://svelte.dev/docs/kit/types#app.d.ts
import type { AppDatabase } from '$lib/server/db';

declare global {
	namespace App {
		interface Locals {
			db: AppDatabase;
			bridgeSessionActive: boolean;
		}
	}
}

export {};
