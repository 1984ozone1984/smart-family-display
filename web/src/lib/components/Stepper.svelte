<script lang="ts">
	/** Zahl ohne Tippen einstellen */
	let {
		value = $bindable(),
		min = 0,
		max = 1000,
		step = 1,
		label
	}: { value: number; min?: number; max?: number; step?: number; label: string } = $props();
</script>

<div class="stepper" role="group" aria-label={label}>
	<button
		type="button"
		onclick={() => (value = Math.max(min, value - step))}
		disabled={value <= min}
		aria-label="weniger">−</button
	>
	<output>{value}</output>
	<button
		type="button"
		onclick={() => (value = Math.min(max, value + step))}
		disabled={value >= max}
		aria-label="mehr">+</button
	>
</div>

<style>
	.stepper {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	button {
		width: 48px;
		height: 48px;
		border-radius: 12px;
		background: var(--surface-2);
		font-size: 24px;
		font-weight: 700;
	}
	output {
		min-width: 48px;
		text-align: center;
		font-size: 22px;
		font-weight: 700;
	}
</style>
