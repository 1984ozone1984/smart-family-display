<script lang="ts">
	import type { CalEvent } from '#lib/api.ts';
	import { cal } from '#lib/calendar.svelte.ts';
	import { addDays, eventsOnDay, fmtDay, sameDay, startOfDay } from '#lib/dates.ts';
	import EventDialog from '#lib/components/EventDialog.svelte';
	import EventItem from '#lib/components/EventItem.svelte';

	const DAYS = 30;
	const from = startOfDay(new Date());
	let dialog = $state<{ event?: CalEvent } | null>(null);

	$effect(() => void cal.show(from, addDays(from, DAYS)));

	const groups = $derived(
		Array.from({ length: DAYS }, (_, i) => addDays(from, i))
			.map((d) => ({ d, events: eventsOnDay(cal.events, d) }))
			.filter((g) => g.events.length > 0)
	);
</script>

<div class="toolbar">
	<h1>Die nächsten {DAYS} Tage</h1>
	<button class="btn primary" onclick={() => (dialog = {})}>+ Termin</button>
</div>

{#each groups as g (g.d.getTime())}
	<section>
		<h2>{sameDay(g.d, new Date()) ? 'Heute' : fmtDay(g.d)}</h2>
		<div class="list">
			{#each g.events as e (e.id)}
				<EventItem event={e} day={g.d} onclick={(event) => (dialog = { event })} />
			{/each}
		</div>
	</section>
{:else}
	<p class="muted">Keine Termine in den nächsten {DAYS} Tagen.</p>
{/each}

{#if dialog}
	<EventDialog event={dialog.event ?? null} onclose={() => (dialog = null)} />
{/if}

<style>
	.toolbar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 8px;
	}
	h1 {
		margin: 0;
		font-size: 24px;
	}
	section {
		max-width: 720px;
	}
	h2 {
		font-size: 18px;
		margin: 16px 0 8px;
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
</style>
