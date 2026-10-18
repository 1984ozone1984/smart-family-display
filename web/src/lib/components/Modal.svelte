<script lang="ts">
	import type { Snippet } from 'svelte';

	let { title, onclose, children }: { title: string; onclose: () => void; children: Snippet } =
		$props();
</script>

<div
	class="backdrop"
	role="presentation"
	onclick={(e) => e.target === e.currentTarget && onclose()}
>
	<div class="dialog" role="dialog" aria-modal="true" aria-label={title}>
		<button class="close" type="button" onclick={onclose} aria-label="Schließen">✕</button>
		<h2>{title}</h2>
		{@render children()}
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 10;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgb(15 23 42 / 0.6);
		padding: 16px;
	}
	.dialog {
		position: relative;
		width: 600px;
		max-width: 100%;
		max-height: 100%;
		overflow: auto;
		background: var(--surface);
		border-radius: 24px;
		padding: 24px;
	}
	.close {
		position: absolute;
		top: 8px;
		right: 8px;
		width: 48px;
		height: 48px;
		font-size: 22px;
		background: none;
	}
	h2 {
		margin: 0 48px 12px 0;
	}
	.dialog :global(.actions) {
		display: flex;
		justify-content: flex-end;
		gap: 12px;
		margin-top: 16px;
	}
	.dialog :global(.error) {
		color: var(--danger);
		min-height: 24px;
		margin: 8px 0 0;
	}
	.dialog :global(select),
	.dialog :global(input[type='date']) {
		min-height: 48px;
		padding: 0 12px;
		font: inherit;
		border: 2px solid var(--border);
		border-radius: 12px;
		background: var(--surface);
	}
	.dialog :global(.check) {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 48px;
		font-weight: 600;
	}
	.dialog :global(.check input) {
		width: 24px;
		height: 24px;
	}
</style>
