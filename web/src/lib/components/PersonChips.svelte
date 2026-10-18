<script lang="ts">
	import { app } from '../app.svelte.ts';
	import Avatar from './Avatar.svelte';

	/** Mehrfachauswahl von Personen */
	let { value = $bindable() }: { value: number[] } = $props();

	function toggle(id: number) {
		value = value.includes(id) ? value.filter((x) => x !== id) : [...value, id];
	}
</script>

<div class="chips" role="group" aria-label="Personen">
	{#each app.persons as p (p.id)}
		<button
			type="button"
			class:active={value.includes(p.id)}
			aria-pressed={value.includes(p.id)}
			onclick={() => toggle(p.id)}
		>
			<Avatar person={p} size={32} />
			{p.name}
		</button>
	{/each}
</div>

<style>
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	button {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 48px;
		padding: 4px 14px 4px 6px;
		border-radius: 999px;
		background: var(--surface-2);
		font-weight: 600;
	}
	.active {
		background: var(--accent);
		color: #fff;
	}
</style>
