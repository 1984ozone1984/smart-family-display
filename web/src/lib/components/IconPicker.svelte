<script lang="ts">
	let { value = $bindable(), icons }: { value: string | null; icons: string[] } = $props();
</script>

<div class="icons" role="radiogroup" aria-label="Symbol">
	<button
		type="button"
		role="radio"
		aria-checked={value === null}
		class:active={value === null}
		onclick={() => (value = null)}
	>
		–
	</button>
	{#each icons as i (i)}
		<button
			type="button"
			role="radio"
			aria-checked={value === i}
			class:active={value === i}
			onclick={() => (value = i)}
		>
			{i}
		</button>
	{/each}
</div>

<style>
	.icons {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	button {
		width: 48px;
		height: 48px;
		border-radius: 12px;
		background: var(--surface-2);
		font-size: 24px;
	}
	.active {
		box-shadow: 0 0 0 3px var(--accent);
		background: var(--surface);
	}
</style>
