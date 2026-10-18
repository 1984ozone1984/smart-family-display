export type Check = { name: string; ok: boolean; detail?: string };
export type Group = { title: string; checks: Check[] };

function safe(fn: () => unknown): boolean {
	try {
		return Boolean(fn());
	} catch {
		return false;
	}
}

// Syntax wird zur Laufzeit geparst, damit ein fehlendes Feature nicht das ganze Bundle bricht.
function syntax(code: string): boolean {
	try {
		new Function(code);
		return true;
	} catch {
		return false;
	}
}

function css(prop: string, value: string): boolean {
	return safe(() => CSS.supports(prop, value));
}

function selector(sel: string): boolean {
	return safe(() => CSS.supports(`selector(${sel})`));
}

// `gap` bei Flexbox lässt sich nicht per CSS.supports erkennen, nur durch Messen.
function flexGap(): boolean {
	const el = document.createElement('div');
	el.style.cssText = 'display:flex;flex-direction:column;row-gap:1px;position:absolute';
	el.appendChild(document.createElement('div'));
	el.appendChild(document.createElement('div'));
	document.body.appendChild(el);
	const ok = el.scrollHeight === 1;
	el.remove();
	return ok;
}

function timeZone(): string | undefined {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone;
	} catch {
		return undefined;
	}
}

export function chromeVersion(ua: string): string | null {
	const m = /Chrome\/([\d.]+)/.exec(ua);
	return m ? m[1] : null;
}

export function runChecks(): Group[] {
	const w = window as unknown as Record<string, unknown>;
	const nav = navigator as unknown as Record<string, unknown>;

	return [
		{
			title: 'Kontext',
			checks: [
				{
					name: 'isSecureContext',
					ok: window.isSecureContext,
					detail: 'Ohne HTTPS: kein Service Worker, kein Push'
				},
				{ name: 'location', ok: true, detail: location.href }
			]
		},
		{
			title: 'JavaScript-Syntax',
			checks: [
				{ name: 'async/await', ok: syntax('async function f(){await 1}') },
				{ name: 'Object spread', ok: syntax('const a={...{}}') },
				{ name: 'Optional chaining ?.', ok: syntax('const a=null;a?.b') },
				{ name: 'Nullish ??', ok: syntax('const a=null??1') },
				{ name: 'Logische Zuweisung ??=', ok: syntax('let a;a??=1') },
				{ name: 'Class fields', ok: syntax('class A{x=1;static y=2}') },
				{ name: 'Private fields #x', ok: syntax('class A{#x=1;m(){return this.#x}}') },
				{ name: 'BigInt', ok: syntax('1n') },
				{ name: 'Numeric separators', ok: syntax('1_000') }
			]
		},
		{
			title: 'JavaScript-APIs',
			checks: [
				{ name: 'fetch', ok: 'fetch' in w },
				{ name: 'AbortController', ok: 'AbortController' in w },
				{ name: 'EventSource (SSE)', ok: 'EventSource' in w },
				{ name: 'Proxy', ok: 'Proxy' in w },
				{ name: 'queueMicrotask', ok: 'queueMicrotask' in w },
				{ name: 'structuredClone', ok: 'structuredClone' in w },
				{ name: 'WeakRef', ok: 'WeakRef' in w },
				{ name: 'Array.prototype.at', ok: safe(() => [1].at(0) === 1) },
				{ name: 'Object.hasOwn', ok: safe(() => Object.hasOwn({ a: 1 }, 'a')) },
				{ name: 'String.replaceAll', ok: safe(() => 'aa'.replaceAll('a', 'b') === 'bb') },
				{ name: 'Promise.allSettled', ok: safe(() => typeof Promise.allSettled === 'function') },
				{ name: 'IntersectionObserver', ok: 'IntersectionObserver' in w },
				{ name: 'ResizeObserver', ok: 'ResizeObserver' in w },
				{ name: 'Intl.RelativeTimeFormat', ok: safe(() => 'RelativeTimeFormat' in Intl) },
				{ name: 'Intl Zeitzone', ok: Boolean(timeZone()), detail: timeZone() },
				{ name: 'localStorage', ok: safe(() => (localStorage.setItem('p', '1'), localStorage.getItem('p') === '1')) },
				{ name: 'indexedDB', ok: 'indexedDB' in w }
			]
		},
		{
			title: 'PWA / Geräte-APIs',
			checks: [
				{ name: 'Service Worker', ok: 'serviceWorker' in navigator },
				{ name: 'PushManager', ok: 'PushManager' in w },
				{ name: 'Notification', ok: 'Notification' in w },
				{ name: 'Wake Lock', ok: 'wakeLock' in navigator },
				{ name: 'speechSynthesis (TTS)', ok: 'speechSynthesis' in w },
				{ name: 'AudioContext', ok: 'AudioContext' in w || 'webkitAudioContext' in w },
				{ name: 'Fullscreen API', ok: 'requestFullscreen' in document.documentElement },
				{ name: 'getBattery', ok: 'getBattery' in navigator },
				{
					name: 'deviceMemory / Kerne',
					ok: true,
					detail: `${String(nav.deviceMemory ?? '?')} GB / ${navigator.hardwareConcurrency ?? '?'} Kerne`
				}
			]
		},
		{
			title: 'CSS',
			checks: [
				{ name: 'Custom Properties', ok: css('--a', '1') },
				{ name: 'Grid', ok: css('display', 'grid') },
				{ name: 'Flex gap', ok: flexGap() },
				{ name: 'aspect-ratio', ok: css('aspect-ratio', '1') },
				{ name: 'inset', ok: css('inset', '0') },
				{ name: 'position: sticky', ok: css('position', 'sticky') },
				{ name: 'backdrop-filter', ok: css('backdrop-filter', 'blur(2px)') },
				{ name: 'dvh-Einheit', ok: css('height', '100dvh') },
				{ name: 'clamp()', ok: css('width', 'clamp(1px, 2px, 3px)') },
				{ name: 'color-mix()', ok: css('color', 'color-mix(in srgb, red, blue)') },
				{ name: 'Container Queries', ok: css('container-type', 'inline-size') },
				{ name: ':focus-visible', ok: selector(':focus-visible') },
				{ name: ':is()', ok: selector(':is(a)') },
				{ name: ':has()', ok: selector(':has(a)') },
				{ name: 'CSS Nesting', ok: selector('&') }
			]
		}
	];
}

const FULLY_GETTERS = [
	'getFullyVersion',
	'getWebviewVersion',
	'getAndroidVersion',
	'getAndroidSdk',
	'getDeviceModel',
	'getDeviceName',
	'getBatteryLevel',
	'isPlugged',
	'getScreenBrightness',
	'getDisplayWidth',
	'getDisplayHeight'
];

export function fullyInfo(): Record<string, unknown> | null {
	const f = window.fully;
	if (!f) return null;
	const out: Record<string, unknown> = {};
	for (const name of FULLY_GETTERS) {
		const fn = f[name];
		if (typeof fn !== 'function') {
			out[name] = '(nicht vorhanden)';
			continue;
		}
		try {
			out[name] = (fn as () => unknown).call(f);
		} catch (err) {
			out[name] = `Fehler: ${String(err)}`;
		}
	}
	return out;
}

export function deviceInfo(): Record<string, unknown> {
	return {
		userAgent: navigator.userAgent,
		chrome: chromeVersion(navigator.userAgent),
		screen: `${screen.width}×${screen.height}`,
		viewport: `${window.innerWidth}×${window.innerHeight}`,
		devicePixelRatio: window.devicePixelRatio,
		language: navigator.language
	};
}

export type FpsResult = { avg: number; min: number; worstFrameMs: number; jank: number };

// Misst Bildrate über `durationMs`; jank = Frames über 50 ms.
export function measureFps(durationMs: number, onFrame: (t: number) => void): Promise<FpsResult> {
	return new Promise((resolve) => {
		const deltas: number[] = [];
		let start = 0;
		let last = 0;
		const tick = (t: number) => {
			if (!start) {
				start = last = t;
			} else {
				deltas.push(t - last);
				last = t;
			}
			onFrame(t - start);
			if (t - start < durationMs) {
				requestAnimationFrame(tick);
				return;
			}
			const worst = Math.max(...deltas);
			const perSecond: number[] = [];
			let acc = 0;
			let frames = 0;
			for (const d of deltas) {
				acc += d;
				frames++;
				if (acc >= 1000) {
					perSecond.push(frames);
					acc = 0;
					frames = 0;
				}
			}
			resolve({
				avg: Math.round((deltas.length / (last - start)) * 1000),
				min: perSecond.length ? Math.min(...perSecond) : 0,
				worstFrameMs: Math.round(worst),
				jank: deltas.filter((d) => d > 50).length
			});
		};
		requestAnimationFrame(tick);
	});
}
