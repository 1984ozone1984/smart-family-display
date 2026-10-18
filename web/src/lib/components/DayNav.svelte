<script lang="ts">
	let {
		label,
		onprev,
		onnext,
		ontoday,
		isToday
	}: {
		label: string;
		onprev: () => void;
		onnext: () => void;
		ontoday: () => void;
		isToday: boolean;
	} = $props();
</script>

<div class="nav">
	<button class="btn" onclick={onprev} aria-label="Zurück">‹</button>
	<button class="btn" onclick={ontoday} disabled={isToday}>Heute</button>
	<button class="btn" onclick={onnext} aria-label="Weiter">›</button>
	<strong>{label}</strong>
</div>

<style>
	.nav {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.nav .btn {
		min-width: 48px;
		font-size: 20px;
	}
	strong {
		margin-left: 8px;
		font-size: 20px;
	}
</style>
