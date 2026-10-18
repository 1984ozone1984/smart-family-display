/// <reference lib="webworker" />
import { version } from '$app/env';
import { assets, immutable } from '$app/manifest';
import { self } from '$app/service-worker';

// Nur die App-Shell wird gecacht; API-Daten kommen immer frisch (Offline-Lesen folgt später).
const CACHE = `shell-${version}`;
const SHELL = ['/', ...immutable.map((f) => f.path), ...assets.map((f) => f.path)];

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((c) => c.addAll(SHELL))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (event) => {
	const req = event.request;
	const url = new URL(req.url);
	if (
		req.method !== 'GET' ||
		url.origin !== self.location.origin ||
		url.pathname.startsWith('/api/')
	)
		return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);
			// Navigation: Netz zuerst (neue Version), offline die gecachte Shell
			if (req.mode === 'navigate') {
				try {
					return await fetch(req);
				} catch {
					return (await cache.match('/')) ?? Response.error();
				}
			}
			return (await cache.match(req)) ?? fetch(req);
		})()
	);
});
