<script lang="ts">
	import { untrack } from 'svelte';
	import { api, type Routine, type Schedule, type Slot } from '../api.ts';
	import { SLOT_LABEL, TASK_ICONS, WEEKDAYS } from '../icons.ts';
	import IconPicker from './IconPicker.svelte';
	import Modal from './Modal.svelte';
	import PersonChips from './PersonChips.svelte';
	import Stepper from './Stepper.svelte';

	let { routine = null, onclose }: { routine?: Routine | null; onclose: () => void } = $props();
	const r = untrack(() => routine);

	let title = $state(r?.title ?? '');
	let icon = $state<string | null>(r?.icon ?? null);
	let assignees = $state<number[]>(r?.assignees ?? []);
	let kind = $state<Schedule['type']>(r?.schedule.type ?? 'daily');
	let days = $state<number[]>(r?.schedule.type === 'weekdays' ? r.schedule.days : [1, 2, 3, 4, 5]);
	let timeSlot = $state<Slot>(r?.timeSlot ?? 'morning');
	let points = $state(r?.points ?? 1);
	let requiresApproval = $state(r?.requiresApproval ?? false);
	let active = $state(r?.active ?? true);
	let error = $state('');
	let busy = $state(false);

	function toggleDay(d: number) {
		days = days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort();
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		if (!assignees.length) return (error = 'Bitte mindestens eine Person wählen.');
		if (kind === 'weekdays' && !days.length) return (error = 'Bitte mindestens einen Tag wählen.');
		busy = true;
		const schedule: Schedule = kind === 'weekdays' ? { type: 'weekdays', days } : { type: kind };
		const json = {
			title: title.trim(),
			icon,
			assignees,
			schedule,
			timeSlot,
			points,
			requiresApproval,
			active
		};
		try {
			if (r) await api(`/routines/${r.id}`, { method: 'PATCH', json });
			else await api('/routines', { method: 'POST', json });
			onclose();
		} catch {
			error = 'Speichern fehlgeschlagen.';
		} finally {
			busy = false;
		}
	}
</script>

<Modal title={r ? 'Routine bearbeiten' : 'Neue Routine'} {onclose}>
	<form onsubmit={save}>
		<label for="rf-title">Titel</label>
		<input id="rf-title" type="text" bind:value={title} required maxlength="100" />
		<label for="rf-icon">Symbol</label>
		<IconPicker bind:value={icon} icons={TASK_ICONS} />
		<label for="rf-who">Für wen</label>
		<PersonChips bind:value={assignees} />

		<label for="rf-kind">Wie oft</label>
		<select id="rf-kind" bind:value={kind}>
			<option value="daily">jeden Tag</option>
			<option value="weekdays">an bestimmten Tagen</option>
			<option value="weekly">einmal pro Woche (Mo–So)</option>
		</select>
		{#if kind === 'weekdays'}
			<div class="days" role="group" aria-label="Wochentage">
				{#each WEEKDAYS as d, i (d)}
					<button
						type="button"
						class:active={days.includes(i + 1)}
						aria-pressed={days.includes(i + 1)}
						onclick={() => toggleDay(i + 1)}>{d}</button
					>
				{/each}
			</div>
		{/if}

		<label for="rf-slot">Tageszeit</label>
		<select id="rf-slot" bind:value={timeSlot}>
			{#each Object.entries(SLOT_LABEL) as [k, v] (k)}<option value={k}>{v}</option>{/each}
		</select>
		<label for="rf-points">Punkte</label>
		<Stepper bind:value={points} label="Punkte" />
		<label class="check"
			><input type="checkbox" bind:checked={requiresApproval} /> Eltern müssen bestätigen</label
		>
		<label class="check"><input type="checkbox" bind:checked={active} /> aktiv</label>
		{#if r}<p class="muted">Änderungen gelten ab der nächsten erzeugten Aufgabe.</p>{/if}
		<p class="error" role="alert">{error}</p>
		<div class="actions">
			<button class="btn" type="button" onclick={onclose}>Abbrechen</button>
			<button class="btn primary" type="submit" disabled={busy || !title.trim()}>Speichern</button>
		</div>
	</form>
</Modal>

<style>
	.days {
		display: flex;
		gap: 6px;
		margin-top: 8px;
		flex-wrap: wrap;
	}
	.days button {
		width: 52px;
		height: 48px;
		border-radius: 12px;
		background: var(--surface-2);
		font-weight: 700;
	}
	.days .active {
		background: var(--accent);
		color: #fff;
	}
</style>
