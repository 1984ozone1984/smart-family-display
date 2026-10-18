<script lang="ts">
	import type { CalEvent } from '../api.ts';
	import { cal } from '../calendar.svelte.ts';
	import { fmtRange } from '../dates.ts';
	import { longpress } from '../longpress.ts';

	let {
		event,
		day,
		onclick,
		onlongpress
	}: {
		event: CalEvent;
		day?: Date;
		onclick: (e: CalEvent) => void;
		onlongpress?: (e: CalEvent) => void;
	} = $props();
</script>

<button
	class="item"
	class:allday={event.allDay}
	style="--c:{cal.colorOf(event)}"
	onclick={() => onclick(event)}
	{@attach onlongpress && longpress(() => onlongpress(event))}
>
	<span class="time">{fmtRange(event, day)}</span>
	<span class="title">{event.title}</span>
</button>

<style>
	.item {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		width: 100%;
		min-height: 48px;
		padding: 6px 10px;
		border-left: 6px solid var(--c);
		border-radius: 10px;
		background: var(--surface-2);
		text-align: left;
	}
	.item.allday {
		background: color-mix(in srgb, var(--c) 18%, var(--surface));
	}
	.time {
		font-size: 15px;
		color: var(--text-muted);
	}
	.title {
		font-weight: 600;
		hyphens: auto;
		overflow-wrap: break-word;
	}
</style>
