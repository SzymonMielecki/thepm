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
	if (event.request.method !== 'GET') return;
	event.respondWith(
		fetch(event.request).catch(() => caches.match(event.request).then((r) => r ?? new Response('offline', { status: 503 })))
	);
});
