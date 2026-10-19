<script lang="ts">
	import type { Task } from '../api.ts';
	import { fmtDayShort, fromIsoDate } from '../dates.ts';
	import { longpress } from '../longpress.ts';

	let {
		task,
		status,
		onclick,
		onlongpress
	}: {
		task: Task;
		status: 'open' | 'done' | 'approved';
		onclick: () => void;
		onlongpress?: () => void;
	} = $props();

	const pending = $derived(status === 'done' && task.requiresApproval);
	const label = $derived(
		status === 'open' ? 'offen' : pending ? 'wartet auf Bestätigung' : 'erledigt'
	);
</script>

<!-- Oben Häkchen, Symbol und Punkte, darunter der Titel über die volle Breite:
     so bleibt der Text auch in schmalen Spalten (Tablet, 4 Personen) lesbar. -->
<button
	class="tile"
	class:done={status !== 'open'}
	{onclick}
	{@attach onlongpress && longpress(onlongpress)}
	aria-pressed={status !== 'open'}
	aria-label="{task.title}, {label}"
>
	<span class="top">
		<span class="check" aria-hidden="true">{status === 'open' ? '' : pending ? '⏳' : '✓'}</span>
		{#if task.icon}<span class="icon" aria-hidden="true">{task.icon}</span>{/if}
		{#if task.points}<span class="points">+{task.points}</span>{/if}
	</span>
	<span class="title">{task.title}</span>
	{#if task.overdue}<small class="overdue">überfällig</small>
	{:else if task.dueToday && status === 'open'}<small class="overdue">heute fällig</small>
	{:else if task.dueDate && !task.availableFrom && !task.plannedFor && status === 'open'}
		<small class="due">zu erledigen bis {fmtDayShort(fromIsoDate(task.dueDate))}</small>
	{/if}
</button>

<style>
	.tile {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 4px;
		width: 100%;
		min-height: 48px;
		padding: 6px 10px 8px;
		border-radius: 14px;
		background: var(--surface-2);
		text-align: left;
		font-weight: 600;
	}
	.tile.done {
		background: color-mix(in srgb, var(--ok) 16%, var(--surface));
	}
	.top {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.check {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 30px;
		height: 30px;
		border-radius: 50%;
		border: 3px solid var(--border);
		background: var(--surface);
		color: var(--ok);
		font-size: 16px;
		font-weight: 800;
	}
	.done .check {
		border-color: var(--ok);
	}
	.icon {
		font-size: 24px;
		line-height: 1;
	}
	.points {
		margin-left: auto;
		padding: 1px 8px;
		border-radius: 999px;
		background: #fef3c7;
		color: #92400e;
		font-size: 15px;
	}
	.title {
		font-size: 17px;
		line-height: 1.25;
		/* nur an Silbengrenzen trennen (lang="de"), nicht mitten im Wort */
		hyphens: auto;
		overflow-wrap: break-word;
	}
	.done .title {
		color: var(--text-muted);
		text-decoration: line-through;
	}
	.overdue {
		color: var(--danger);
		font-size: 14px;
	}
	.due {
		color: var(--text-muted);
		font-size: 14px;
	}
</style>
