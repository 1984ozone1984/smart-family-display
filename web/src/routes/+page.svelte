<script lang="ts">
	import type { CalEvent } from '#lib/api.ts';
	import { app } from '#lib/app.svelte.ts';
	import { cal } from '#lib/calendar.svelte.ts';
	import { addDays, eventsOnDay, fmtDay, sameDay, startOfDay } from '#lib/dates.ts';
	import Avatar from '#lib/components/Avatar.svelte';
	import DayNav from '#lib/components/DayNav.svelte';
	import EventDialog from '#lib/components/EventDialog.svelte';
	import EventItem from '#lib/components/EventItem.svelte';
	import TaskTile from '#lib/components/TaskTile.svelte';
	import { tasks } from '#lib/tasks.svelte.ts';

	let day = $state(startOfDay(new Date()));
	let dialog = $state<{ event?: CalEvent; personId?: number | null } | null>(null);

	$effect(() => void cal.show(day, addDays(day, 1)));

	// Um Mitternacht auf den neuen Tag springen, wenn „Heute“ angezeigt wird
	$effect(() => {
		const t = setInterval(() => {
			const today = startOfDay(new Date());
			if (!sameDay(today, day) && sameDay(addDays(day, 1), today)) day = today;
		}, 60_000);
		return () => clearInterval(t);
	});

	const events = $derived(eventsOnDay(cal.events, day));
	const family = $derived(events.filter((e) => e.personId === null));
	const forPerson = (id: number) => events.filter((e) => e.personId === id);
	const isToday = $derived(sameDay(day, new Date()));
</script>

<div class="toolbar">
	<DayNav
		label={isToday ? `Heute, ${fmtDay(day)}` : fmtDay(day)}
		{isToday}
		onprev={() => (day = addDays(day, -1))}
		onnext={() => (day = addDays(day, 1))}
		ontoday={() => (day = startOfDay(new Date()))}
	/>
	<button class="btn primary" onclick={() => (dialog = { personId: null })}>+ Termin</button>
</div>

{#if family.length}
	<section class="family">
		<h2>Alle</h2>
		<div class="list">
			{#each family as e (e.id)}
				<EventItem event={e} {day} onclick={(event) => (dialog = { event })} />
			{/each}
		</div>
	</section>
{/if}

<div class="columns" style="--n:{Math.max(app.persons.length, 1)}">
	{#each app.persons as p (p.id)}
		<section class="column" style="--c:{p.color}">
			<header>
				<Avatar person={p} size={48} />
				<h2>{p.name}</h2>
				<span class="star" title="Punkte">⭐ {tasks.balances[p.id] ?? 0}</span>
				<button
					class="add"
					aria-label="Termin für {p.name}"
					onclick={() => (dialog = { personId: p.id })}
				>
					+
				</button>
			</header>
			<div class="list">
				{#each forPerson(p.id) as e (e.id)}
					<EventItem event={e} {day} onclick={(event) => (dialog = { event })} />
				{:else}
					<p class="muted empty">Keine Termine</p>
				{/each}
			</div>
			{#if isToday && tasks.forPerson(p.id).length}
				{@const prog = tasks.progress(p.id)}
				<div class="tasks">
					<div class="bar" aria-label="{prog.done} von {prog.total} Aufgaben erledigt">
						<span style="width:{(prog.done / prog.total) * 100}%"></span>
					</div>
					{#each tasks.forPerson(p.id) as t (t.id)}
						<TaskTile
							task={t}
							status={tasks.status(t, p.id)}
							compact
							onclick={() => tasks.tap(t, p.id)}
						/>
					{/each}
				</div>
			{/if}
		</section>
	{:else}
		<p class="muted">Noch keine Personen angelegt.</p>
	{/each}
</div>

{#if dialog}
	<EventDialog
		event={dialog.event ?? null}
		date={day}
		personId={dialog.personId ?? null}
		onclose={() => (dialog = null)}
	/>
{/if}

<style>
	.toolbar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		margin-bottom: 12px;
		flex-wrap: wrap;
	}
	.family {
		background: var(--surface);
		border-radius: var(--radius);
		padding: 8px 12px 12px;
		margin-bottom: 12px;
	}
	.family h2 {
		margin: 0 0 8px;
		font-size: 18px;
	}
	.family .list {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
	}
	.columns {
		display: grid;
		grid-template-columns: repeat(var(--n), minmax(0, 1fr));
		gap: 12px;
	}
	.column {
		background: var(--surface);
		border-radius: var(--radius);
		border-top: 8px solid var(--c);
		padding: 12px;
		min-height: 280px;
	}
	.column header {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 10px;
	}
	h2 {
		margin: 0;
		font-size: 20px;
	}
	.star {
		margin-left: auto;
		font-weight: 700;
		white-space: nowrap;
	}
	.tasks {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 12px;
		padding-top: 10px;
		border-top: 2px dashed var(--surface-2);
	}
	.bar {
		height: 8px;
		border-radius: 4px;
		background: var(--surface-2);
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		background: var(--ok);
	}
	.add {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		background: var(--surface-2);
		font-size: 26px;
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.family .list {
		gap: 8px;
	}
	.empty {
		margin: 4px 0;
	}
	@media (max-width: 640px) {
		.columns {
			grid-template-columns: 1fr;
		}
		.column {
			min-height: 0;
		}
	}
</style>
