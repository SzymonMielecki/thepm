import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { attachAudioWssToHttpServer } from './src/lib/server/ws/ingest.ts';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		{
			name: 'pm-audio-ws',
			configureServer(s) {
				const h = s.httpServer;
				if (h) {
					if (h.listening) attachAudioWssToHttpServer(h);
					else h.once('listening', () => attachAudioWssToHttpServer(h!));
				}
			}
		}
	],
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}'],
		environment: 'node'
	},
	optimizeDeps: {
		exclude: ['better-sqlite3', '@sveltejs/kit']
	},
	ssr: {
		external: ['better-sqlite3', 'ws', 'chokidar', '@modelcontextprotocol/sdk'],
		noExternal: []
	}
});
