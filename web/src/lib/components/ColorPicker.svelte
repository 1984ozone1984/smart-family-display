<script lang="ts">
	import { PALETTE } from '../app.svelte.ts';

	let { value = $bindable() }: { value: string } = $props();
</script>

<div class="swatches" role="radiogroup" aria-label="Farbe">
	{#each PALETTE as c (c)}
		<button
			type="button"
			role="radio"
			aria-checked={value === c}
			aria-label={c}
			class:active={value === c}
			style="background:{c}"
			onclick={() => (value = c)}
		></button>
	{/each}
</div>

<style>
	.swatches {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}
	button {
		width: 48px;
		height: 48px;
		border-radius: 50%;
	}
	.active {
		box-shadow:
			0 0 0 3px var(--surface),
			0 0 0 6px var(--text);
	}
</style>
