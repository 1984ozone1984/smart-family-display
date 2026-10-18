<script lang="ts">
	import { onMount } from 'svelte';
	import {
		deviceInfo,
		fullyInfo,
		measureFps,
		runChecks,
		type FpsResult,
		type Group
	} from '#lib/probe.ts';

	let groups: Group[] = $state([]);
	let device: Record<string, unknown> = $state({});
	let fully: Record<string, unknown> | null = $state(null);
	let fps: FpsResult | null = $state(null);
	let running = $state(false);
	let offset = $state(0);
	let sendState = $state('');

	const BOXES = Array.from({ length: 24 }, (_, i) => i);
	const ROWS = Array.from({ length: 60 }, (_, i) => i);

	async function send() {
		sendState = 'sende …';
		try {
			const res = await fetch('/report', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					time: new Date().toISOString(),
					device,
					fully,
					fps,
					groups,
					errors: window.__probeErrors ?? []
				})
			});
			sendState = res.ok ? 'gesendet ✓' : `Fehler ${res.status}`;
		} catch (err) {
			sendState = `Fehler: ${String(err)}`;
		}
	}

	async function runFps() {
		running = true;
		fps = null;
		fps = await measureFps(8000, (t) => {
			offset = (t / 8) % 400;
		});
		running = false;
		await send();
	}

	onMount(() => {
		window.__probeMounted = true;
		device = deviceInfo();
		fully = fullyInfo();
		groups = runChecks();
		void send();
	});

	const failed = $derived(groups.flatMap((g) => g.checks.filter((c) => !c.ok)).length);
</script>

<main>
	<header>
		<h1>WebView-Probe</h1>
		<p class="big">Chrome {device.chrome ?? '?'}</p>
		<p class="muted">{device.userAgent}</p>
		<p>
			Bildschirm {device.screen} · Viewport {device.viewport} · DPR {device.devicePixelRatio}
		</p>
		<p>
			{failed} von {groups.reduce((n, g) => n + g.checks.length, 0)} Prüfungen nicht erfüllt
		</p>
		<div class="actions">
			<button onclick={runFps} disabled={running}>
				{running ? 'Messe 8 s …' : 'FPS-Test starten'}
			</button>
			<button onclick={send}>Bericht senden</button>
			<span>{sendState}</span>
		</div>
	</header>

	{#if running || fps}
		<section>
			<h2>Animation</h2>
			<div class="stage">
				{#each BOXES as i (i)}
					<div
						class="box"
						style="transform: translate({(offset + i * 17) % 400}px, {(i % 6) * 30}px)"
					></div>
				{/each}
			</div>
			{#if fps}
				<p class="big">
					Ø {fps.avg} fps · min {fps.min} fps · schlechtester Frame {fps.worstFrameMs} ms · {fps.jank} Ruckler
				</p>
			{/if}
		</section>
	{/if}

	<section>
		<h2>Fully Kiosk</h2>
		{#if fully}
			<table>
				<tbody>
					{#each Object.entries(fully) as [k, v] (k)}
						<tr><td>{k}</td><td>{String(v)}</td></tr>
					{/each}
				</tbody>
			</table>
		{:else}
			<p>Kein <code>fully</code>-Objekt (nicht in Fully Kiosk oder JS-Interface deaktiviert).</p>
		{/if}
	</section>

	{#each groups as g (g.title)}
		<section>
			<h2>{g.title}</h2>
			<table>
				<tbody>
					{#each g.checks as c (c.name)}
						<tr class:bad={!c.ok}>
							<td class="mark">{c.ok ? '✓' : '✗'}</td>
							<td>{c.name}</td>
							<td class="muted">{c.detail ?? ''}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>
	{/each}

	<section>
		<h2>Scroll-Test</h2>
		<div class="scroller">
			{#each ROWS as r (r)}
				<div class="row" style="border-left-color: hsl({r * 37}, 60%, 50%)">Zeile {r + 1}</div>
			{/each}
		</div>
	</section>
</main>

<style>
	:global(body) {
		margin: 0;
		font: 18px/1.4 system-ui, sans-serif;
		background: #f5f5f4;
		color: #1c1917;
	}
	main {
		max-width: 1200px;
		margin: 0 auto;
		padding: 16px;
	}
	h1 {
		margin: 0 0 8px;
	}
	h2 {
		font-size: 20px;
		margin: 24px 0 8px;
	}
	.big {
		font-size: 24px;
		font-weight: 600;
		margin: 4px 0;
	}
	.muted {
		color: #57534e;
		font-size: 16px;
		word-break: break-all;
	}
	.actions {
		display: flex;
		align-items: center;
		margin-top: 12px;
	}
	.actions > * {
		margin-right: 12px;
	}
	button {
		min-height: 48px;
		padding: 0 20px;
		font-size: 18px;
		border: 0;
		border-radius: 8px;
		background: #2563eb;
		color: #fff;
	}
	button:disabled {
		background: #93c5fd;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		background: #fff;
	}
	td {
		padding: 8px;
		border-bottom: 1px solid #e7e5e4;
		font-size: 16px;
	}
	.mark {
		width: 32px;
		color: #16a34a;
		font-weight: 700;
	}
	.bad .mark,
	.bad td {
		color: #b91c1c;
	}
	.stage {
		position: relative;
		height: 200px;
		overflow: hidden;
		background: #fff;
	}
	.box {
		position: absolute;
		width: 40px;
		height: 24px;
		border-radius: 6px;
		background: #f97316;
		will-change: transform;
	}
	.scroller {
		height: 300px;
		overflow-y: auto;
		background: #fff;
	}
	.row {
		height: 56px;
		line-height: 56px;
		padding-left: 12px;
		border-left: 8px solid;
		border-bottom: 1px solid #e7e5e4;
	}
</style>
