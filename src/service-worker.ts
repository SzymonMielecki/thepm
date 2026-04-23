/// <reference lib="webworker" />
import { build, files, version } from '$service-worker';

const cache = `pm-cache-${version}`;

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(cache).then((c) => c.addAll([...build, ...files])).then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== cache).map((k) => caches.delete(k)))).then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (event) => {
	// Do not wrap `/api/*` in the service worker. Forwarding all GETs through
	// `fetch` breaks EventSource (SSE) streaming, and in some cases interferes
	// with the WebSocket upgrade handshake. Let those hit the network directly.
	const url = new URL(event.request.url);
	if (url.pathname.startsWith('/api/')) {
		return;
	}
	if (event.request.method !== 'GET') return;
	event.respondWith(
		fetch(event.request).catch(() => caches.match(event.request).then((r) => r ?? new Response('offline', { status: 503 })))
	);
});
