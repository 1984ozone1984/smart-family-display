<script lang="ts">
	import { untrack } from 'svelte';
	import { api, type Slot, type Task } from '../api.ts';
	import { SLOT_LABEL, TASK_ICONS } from '../icons.ts';
	import IconPicker from './IconPicker.svelte';
	import Modal from './Modal.svelte';
	import PersonChips from './PersonChips.svelte';
	import Stepper from './Stepper.svelte';

	let { task = null, onclose }: { task?: Task | null; onclose: () => void } = $props();
	const t = untrack(() => task);

	let title = $state(t?.title ?? '');
	let icon = $state<string | null>(t?.icon ?? null);
	let assignees = $state<number[]>(t?.assignees.map((a) => a.personId) ?? []);
	let dueDate = $state(t?.dueDate ?? '');
	let timeSlot = $state<Slot | ''>(t?.timeSlot ?? '');
	let points = $state(t?.points ?? 1);
	let requiresApproval = $state(t?.requiresApproval ?? false);
	let error = $state('');
	let busy = $state(false);

	async function save(e: SubmitEvent) {
		e.preventDefault();
		if (!assignees.length) return (error = 'Bitte mindestens eine Person wählen.');
		busy = true;
		const json = {
			title: title.trim(),
			icon,
			assignees,
			dueDate: dueDate || null,
			timeSlot: timeSlot || null,
			points,
			requiresApproval
		};
		try {
			if (t) await api(`/tasks/${t.id}`, { method: 'PATCH', json });
			else await api('/tasks', { method: 'POST', json });
			onclose();
		} catch {
			error = 'Speichern fehlgeschlagen.';
		} finally {
			busy = false;
		}
	}

	async function remove() {
		if (!t || !confirm(`„${t.title}“ löschen? Bereits gutgeschriebene Punkte bleiben.`)) return;
		await api(`/tasks/${t.id}`, { method: 'DELETE' });
		onclose();
	}
</script>

<Modal title={t ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'} {onclose}>
	<form onsubmit={save}>
		<label for="tf-title">Titel</label>
		<input id="tf-title" type="text" bind:value={title} required maxlength="100" />
		<label for="tf-icon">Symbol</label>
		<IconPicker bind:value={icon} icons={TASK_ICONS} />
		<label for="tf-who">Für wen</label>
		<PersonChips bind:value={assignees} />
		<div class="row">
			<div>
				<label for="tf-date">Fällig am (optional)</label>
				<input id="tf-date" type="date" bind:value={dueDate} />
			</div>
			<div>
				<label for="tf-slot">Tageszeit</label>
				<select id="tf-slot" bind:value={timeSlot}>
					<option value="">egal</option>
					{#each Object.entries(SLOT_LABEL) as [k, v] (k)}<option value={k}>{v}</option>{/each}
				</select>
			</div>
		</div>
		<label for="tf-points">Punkte</label>
		<Stepper bind:value={points} label="Punkte" />
		<label class="check"
			><input type="checkbox" bind:checked={requiresApproval} /> Eltern müssen bestätigen</label
		>
		<p class="error" role="alert">{error}</p>
		<div class="actions">
			{#if t}<button class="btn danger" type="button" onclick={remove}>Löschen</button>{/if}
			<button class="btn" type="button" onclick={onclose}>Abbrechen</button>
			<button class="btn primary" type="submit" disabled={busy || !title.trim()}>Speichern</button>
		</div>
	</form>
</Modal>

<style>
	.row {
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
	}
</style>
