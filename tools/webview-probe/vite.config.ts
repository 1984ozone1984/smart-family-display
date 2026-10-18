import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			adapter: adapter({ fallback: undefined })
		})
	],
	build: {
		// Bewusst niedrig, damit die Testseite auch auf einer sehr alten WebView startet.
		target: 'chrome64',
		cssTarget: 'chrome64'
	}
});
