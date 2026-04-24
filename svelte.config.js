import adapterNode from '@sveltejs/adapter-node';
import adapterVercel from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const adapter =
	process.env.VERCEL || process.env.ADAPTER === 'vercel'
		? adapterVercel()
		: adapterNode({ out: 'build' });

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	kit: {
		adapter,
		files: {
			serviceWorker: 'src/service-worker'
		},
		serviceWorker: {
			register: true
		}
	}
};

export default config;
