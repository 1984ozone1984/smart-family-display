<script lang="ts">
	import { untrack } from 'svelte';
	import { api, type Reward } from '../api.ts';
	import { REWARD_ICONS } from '../icons.ts';
	import IconPicker from './IconPicker.svelte';
	import Modal from './Modal.svelte';
	import Stepper from './Stepper.svelte';

	let { reward = null, onclose }: { reward?: Reward | null; onclose: () => void } = $props();
	const r = untrack(() => reward);

	let title = $state(r?.title ?? '');
	let icon = $state<string | null>(r?.icon ?? null);
	let cost = $state(r?.cost ?? 10);
	let limited = $state(r?.weeklyLimit != null);
	let weeklyLimit = $state(r?.weeklyLimit ?? 1);
	let active = $state(r?.active ?? true);
	let error = $state('');
	let busy = $state(false);

	async function save(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		const json = {
			title: title.trim(),
			icon,
			cost,
			weeklyLimit: limited ? weeklyLimit : null,
			active
		};
		try {
			if (r) await api(`/rewards/${r.id}`, { method: 'PATCH', json });
			else await api('/rewards', { method: 'POST', json });
			onclose();
		} catch {
			error = 'Speichern fehlgeschlagen.';
		} finally {
			busy = false;
		}
	}
</script>

<Modal title={r ? 'Belohnung bearbeiten' : 'Neue Belohnung'} {onclose}>
	<form onsubmit={save}>
		<label for="wf-title">Titel</label>
		<input id="wf-title" type="text" bind:value={title} required maxlength="100" />
		<label for="wf-icon">Symbol</label>
		<IconPicker bind:value={icon} icons={REWARD_ICONS} />
		<label for="wf-cost">Kosten (Punkte)</label>
		<Stepper bind:value={cost} min={1} max={10000} step={5} label="Kosten" />
		<label class="check"><input type="checkbox" bind:checked={limited} /> Limit pro Woche</label>
		{#if limited}<Stepper bind:value={weeklyLimit} min={1} max={50} label="Limit pro Woche" />{/if}
		<label class="check"><input type="checkbox" bind:checked={active} /> aktiv</label>
		<p class="error" role="alert">{error}</p>
		<div class="actions">
			<button class="btn" type="button" onclick={onclose}>Abbrechen</button>
			<button class="btn primary" type="submit" disabled={busy || !title.trim()}>Speichern</button>
		</div>
	</form>
</Modal>
