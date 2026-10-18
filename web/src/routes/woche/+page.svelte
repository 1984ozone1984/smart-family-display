<script lang="ts">
	import type { CalEvent } from '#lib/api.ts';
	import { cal } from '#lib/calendar.svelte.ts';
	import { addDays, eventsOnDay, fmtDayShort, sameDay, startOfWeek } from '#lib/dates.ts';
	import DayNav from '#lib/components/DayNav.svelte';
	import EventDialog from '#lib/components/EventDialog.svelte';
	import EventItem from '#lib/components/EventItem.svelte';

	let week = $state(startOfWeek(new Date()));
	let dialog = $state<{ event?: CalEvent; date: Date } | null>(null);

	$effect(() => void cal.show(week, addDays(week, 7)));

	const days = $derived(Array.from({ length: 7 }, (_, i) => addDays(week, i)));
	const isThisWeek = $derived(sameDay(week, startOfWeek(new Date())));
	const kw = $derived.by(() => {
		// ISO-Kalenderwoche: Donnerstag der Woche bestimmt das Jahr
		const thu = addDays(week, 3);
		const jan4 = new Date(thu.getFullYear(), 0, 4);
		return 1 + Math.round((thu.getTime() - startOfWeek(jan4).getTime()) / (7 * 86_400_000));
	});
</script>

<div class="toolbar">
	<DayNav
		label="KW {kw} · {fmtDayShort(days[0]!)} – {fmtDayShort(days[6]!)}"
		isToday={isThisWeek}
		onprev={() => (week = addDays(week, -7))}
		onnext={() => (week = addDays(week, 7))}
		ontoday={() => (week = startOfWeek(new Date()))}
	/>
</div>

<div class="week">
	{#each days as d (d.getTime())}
		<section class="day" class:today={sameDay(d, new Date())}>
			<header>
				<span>{fmtDayShort(d)}</span>
				<button
					class="add"
					aria-label="Termin am {fmtDayShort(d)}"
					onclick={() => (dialog = { date: d })}>+</button
				>
			</header>
			<div class="list">
				{#each eventsOnDay(cal.events, d) as e (e.id)}
					<EventItem event={e} day={d} onclick={(event) => (dialog = { event, date: d })} />
				{/each}
			</div>
		</section>
	{/each}
</div>

{#if dialog}
	<EventDialog event={dialog.event ?? null} date={dialog.date} onclose={() => (dialog = null)} />
{/if}

<style>
	.toolbar {
		margin-bottom: 12px;
	}
	.week {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		gap: 8px;
	}
	.day {
		background: var(--surface);
		border-radius: var(--radius);
		padding: 8px;
		min-height: 360px;
	}
	.day.today {
		box-shadow: inset 0 0 0 3px var(--accent);
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-weight: 700;
		margin-bottom: 8px;
	}
	.add {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		background: var(--surface-2);
		font-size: 22px;
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.list :global(.item) {
		font-size: 16px;
	}
	@media (max-width: 640px) {
		.week {
			grid-template-columns: 1fr;
		}
		.day {
			min-height: 0;
		}
	}
</style>
