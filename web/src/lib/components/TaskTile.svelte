<script lang="ts">
	import type { Task } from '../api.ts';

	let {
		task,
		status,
		onclick,
		compact = false
	}: {
		task: Task;
		status: 'open' | 'done' | 'approved';
		onclick: () => void;
		compact?: boolean;
	} = $props();

	const pending = $derived(status === 'done' && task.requiresApproval);
	const label = $derived(
		status === 'open' ? 'offen' : pending ? 'wartet auf Bestätigung' : 'erledigt'
	);
</script>

<button
	class="tile"
	class:done={status !== 'open'}
	class:compact
	{onclick}
	aria-pressed={status !== 'open'}
	aria-label="{task.title}, {label}"
>
	<span class="check" aria-hidden="true">{status === 'open' ? '' : pending ? '⏳' : '✓'}</span>
	{#if task.icon}<span class="icon" aria-hidden="true">{task.icon}</span>{/if}
	<span class="title">
		{task.title}
		{#if task.overdue}<small class="overdue">überfällig</small>{/if}
	</span>
	{#if task.points}<span class="points">+{task.points}</span>{/if}
</button>

<style>
	.tile {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		min-height: 56px;
		padding: 8px 12px;
		border-radius: 14px;
		background: var(--surface-2);
		text-align: left;
		font-weight: 600;
	}
	.tile.compact {
		min-height: 48px;
		padding: 4px 10px;
	}
	.tile.done {
		background: color-mix(in srgb, var(--ok) 16%, var(--surface));
	}
	.tile.done .title {
		color: var(--text-muted);
		text-decoration: line-through;
	}
	.check {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 32px;
		height: 32px;
		border-radius: 50%;
		border: 3px solid var(--border);
		background: var(--surface);
		color: var(--ok);
		font-size: 18px;
		font-weight: 800;
	}
	.done .check {
		border-color: var(--ok);
	}
	.icon {
		font-size: 26px;
	}
	.title {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow-wrap: anywhere;
	}
	.overdue {
		color: var(--danger);
		font-weight: 600;
		text-decoration: none;
	}
	.points {
		flex-shrink: 0;
		padding: 2px 10px;
		border-radius: 999px;
		background: #fef3c7;
		color: #92400e;
		font-size: 15px;
	}
</style>
