<script lang="ts">
	import { onMount } from 'svelte';
	import { api, type Routine, type Task } from '#lib/api.ts';
	import { app } from '#lib/app.svelte.ts';
	import Avatar from '#lib/components/Avatar.svelte';
	import ParentGate from '#lib/components/ParentGate.svelte';
	import RoutineForm from '#lib/components/RoutineForm.svelte';
	import TaskForm from '#lib/components/TaskForm.svelte';
	import TaskTile from '#lib/components/TaskTile.svelte';
	import { SLOT_LABEL, WEEKDAYS } from '#lib/icons.ts';
	import { tasks } from '#lib/tasks.svelte.ts';

	let notice = $state('');
	let editTask = $state<Task | 'new' | null>(null);
	let editRoutine = $state<Routine | 'new' | null>(null);

	onMount(() => {
		void tasks.loadRoutines();
		return app.on('tasks.changed', () => void tasks.loadRoutines());
	});

	const SLOTS = [...(Object.keys(SLOT_LABEL) as (keyof typeof SLOT_LABEL)[]), null];
	const slotTasks = (personId: number, slot: Task['timeSlot']) =>
		tasks.forPerson(personId).filter((t) => t.timeSlot === slot);
	const name = (id: number) => app.persons.find((p) => p.id === id)?.name ?? '?';
	const oneOff = $derived(tasks.tasks.filter((t) => !t.availableFrom));
	const scheduleText = (r: Routine) =>
		r.schedule.type === 'daily'
			? 'täglich'
			: r.schedule.type === 'weekly'
				? 'wöchentlich'
				: r.schedule.days.map((d) => WEEKDAYS[d - 1]).join(', ');

	async function toggle(t: Task, personId: number) {
		notice = (await tasks.toggle(t, personId)) ?? '';
	}

	async function decide(taskId: number, personId: number, approve: boolean) {
		await api(`/tasks/${taskId}/approve`, { method: 'POST', json: { personId, approve } });
		await tasks.loadTasks();
	}
</script>

<h1>Aufgaben</h1>
{#if notice}<p class="notice" role="status">{notice}</p>{/if}

<div class="people">
	{#each app.persons as p (p.id)}
		{@const prog = tasks.progress(p.id)}
		<section class="card person" style="--c:{p.color}">
			<header>
				<Avatar person={p} size={44} />
				<h2>{p.name}</h2>
				<span class="star">⭐ {tasks.balances[p.id] ?? 0}</span>
			</header>
			{#if prog.total}
				<div class="bar" aria-label="{prog.done} von {prog.total} erledigt">
					<span style="width:{(prog.done / prog.total) * 100}%"></span>
				</div>
			{/if}
			{#each SLOTS as slot (slot)}
				{@const list = slotTasks(p.id, slot)}
				{#if list.length}
					<h3>{slot ? SLOT_LABEL[slot] : 'Irgendwann heute'}</h3>
					<div class="list">
						{#each list as t (t.id)}
							<TaskTile task={t} status={tasks.status(t, p.id)} onclick={() => toggle(t, p.id)} />
						{/each}
					</div>
				{/if}
			{/each}
			{#if !prog.total}<p class="muted">Heute nichts zu tun 🎉</p>{/if}
		</section>
	{/each}
</div>

{#if tasks.approvals.length}
	<section class="card block">
		<h2>Zu bestätigen</h2>
		<ParentGate label="Zum Bestätigen als Elternteil anmelden">
			<ul class="rows">
				{#each tasks.approvals as a (`${a.taskId}-${a.personId}`)}
					<li>
						<span>{a.icon ?? ''} <strong>{a.title}</strong> · {name(a.personId)} · +{a.points}</span
						>
						<span class="actions">
							<button class="btn" onclick={() => decide(a.taskId, a.personId, false)}
								>Nochmal</button
							>
							<button class="btn primary" onclick={() => decide(a.taskId, a.personId, true)}
								>Bestätigen</button
							>
						</span>
					</li>
				{/each}
			</ul>
		</ParentGate>
	</section>
{/if}

<section class="card block">
	<h2>Verwalten</h2>
	<ParentGate>
		<h3>Routinen</h3>
		<ul class="rows">
			{#each tasks.routines as r (r.id)}
				<li class:inactive={!r.active}>
					<span>
						{r.icon ?? ''} <strong>{r.title}</strong>
						<small class="muted">
							{scheduleText(r)} · {SLOT_LABEL[r.timeSlot]} · {r.assignees.map(name).join(', ')} · +{r.points}
							{r.active ? '' : ' · pausiert'}
						</small>
					</span>
					<button class="btn" onclick={() => (editRoutine = r)}>Bearbeiten</button>
				</li>
			{:else}
				<li class="muted">Noch keine Routinen.</li>
			{/each}
		</ul>
		<button class="btn primary" onclick={() => (editRoutine = 'new')}>+ Routine</button>

		<h3>Einmalige Aufgaben</h3>
		<ul class="rows">
			{#each oneOff as t (t.id)}
				<li>
					<span>
						{t.icon ?? ''} <strong>{t.title}</strong>
						<small class="muted">
							{t.dueDate ?? 'ohne Datum'} · {t.assignees.map((a) => name(a.personId)).join(', ')} · +{t.points}
						</small>
					</span>
					<button class="btn" onclick={() => (editTask = t)}>Bearbeiten</button>
				</li>
			{:else}
				<li class="muted">Keine offenen einmaligen Aufgaben für heute.</li>
			{/each}
		</ul>
		<button class="btn primary" onclick={() => (editTask = 'new')}>+ Aufgabe</button>
	</ParentGate>
</section>

{#if editTask}
	<TaskForm task={editTask === 'new' ? null : editTask} onclose={() => (editTask = null)} />
{/if}
{#if editRoutine}
	<RoutineForm
		routine={editRoutine === 'new' ? null : editRoutine}
		onclose={() => (editRoutine = null)}
	/>
{/if}

<style>
	h1 {
		margin: 0 0 12px;
	}
	.notice {
		background: #fef3c7;
		border-radius: 12px;
		padding: 8px 12px;
	}
	.people {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 12px;
	}
	.person {
		border-top: 8px solid var(--c);
	}
	.person header {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.person h2 {
		margin: 0;
		font-size: 20px;
		flex: 1;
	}
	.star {
		font-weight: 700;
		white-space: nowrap;
	}
	.bar {
		height: 10px;
		margin: 10px 0 4px;
		border-radius: 5px;
		background: var(--surface-2);
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		background: var(--ok);
	}
	h3 {
		font-size: 16px;
		color: var(--text-muted);
		margin: 12px 0 6px;
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.block {
		margin-top: 16px;
	}
	.block h2 {
		margin-top: 0;
	}
	.rows {
		list-style: none;
		padding: 0;
		margin: 0 0 12px;
	}
	.rows li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 0;
		border-bottom: 1px solid var(--surface-2);
	}
	.rows li > span:first-child {
		display: flex;
		flex-direction: column;
	}
	.rows .inactive {
		opacity: 0.6;
	}
	.actions {
		display: flex;
		gap: 8px;
	}
</style>
