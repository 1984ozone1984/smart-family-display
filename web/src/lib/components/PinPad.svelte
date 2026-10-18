<script lang="ts">
	let {
		onsubmit,
		error = '',
		disabled = false
	}: { onsubmit: (pin: string) => void; error?: string; disabled?: boolean } = $props();

	let pin = $state('');
	const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

	function press(k: string) {
		if (disabled) return;
		if (k === '⌫') pin = pin.slice(0, -1);
		else if (k && pin.length < 4) pin += k;
		if (pin.length === 4) {
			onsubmit(pin);
			pin = '';
		}
	}

	function onkeydown(e: KeyboardEvent) {
		if (/^\d$/.test(e.key)) press(e.key);
		else if (e.key === 'Backspace') press('⌫');
	}
</script>

<svelte:window {onkeydown} />

<div class="pinpad">
	<div class="dots" class:shake={!!error} aria-label="PIN, {pin.length} von 4 Ziffern">
		{#each [0, 1, 2, 3] as i (i)}
			<span class:filled={i < pin.length}></span>
		{/each}
	</div>
	<p class="error" role="alert">{error}</p>
	<div class="keys">
		{#each KEYS as k, i (i)}
			{#if k}
				<button
					type="button"
					onclick={() => press(k)}
					{disabled}
					aria-label={k === '⌫' ? 'Löschen' : k}
				>
					{k}
				</button>
			{:else}
				<span></span>
			{/if}
		{/each}
	</div>
</div>

<style>
	.pinpad {
		display: flex;
		flex-direction: column;
		align-items: center;
	}
	.dots {
		display: flex;
		gap: 16px;
	}
	.dots span {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		border: 3px solid var(--text-muted);
	}
	.dots span.filled {
		background: var(--text);
		border-color: var(--text);
	}
	.shake {
		animation: shake 0.3s;
	}
	@keyframes shake {
		25% {
			transform: translateX(-6px);
		}
		75% {
			transform: translateX(6px);
		}
	}
	.error {
		min-height: 24px;
		margin: 8px 0;
		color: var(--danger);
	}
	.keys {
		display: grid;
		grid-template-columns: repeat(3, 72px);
		gap: 12px;
	}
	.keys button {
		height: 64px;
		font-size: 28px;
		font-weight: 600;
		border-radius: 16px;
		background: var(--surface-2);
	}
	.keys button:active {
		background: var(--border);
	}
</style>
