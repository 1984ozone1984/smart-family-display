<script lang="ts">
	import { untrack } from 'svelte';
	import { api, type FamilyList } from '../api.ts';
	import { LIST_ICONS } from '../icons.ts';
	import { lists } from '../lists.svelte.ts';
	import IconPicker from './IconPicker.svelte';
	import Modal from './Modal.svelte';
	import ParentGate from './ParentGate.svelte';

	let {
		list = null,
		onclose,
		onsaved
	}: {
		list?: FamilyList | null;
		onclose: () => void;
		onsaved?: (id: number | null) => void;
	} = $props();
	const l = untrack(() => list);

	let title = $state(l?.title ?? '');
	let icon = $state<string | null>(l?.icon ?? null);
	let confirmDelete = $state(false);
	let error = $state('');
	let busy = $state(false);

	async function save(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		const json = { title: title.trim(), icon };
		try {
			if (l) {
				await api(`/lists/${l.id}`, { method: 'PATCH', json });
				onsaved?.(l.id);
			} else {
				const r = await api<{ list: FamilyList }>('/lists', { method: 'POST', json });
				onsaved?.(r.list.id);
			}
			await lists.load();
			onclose();
		} catch {
			error = 'Speichern fehlgeschlagen.';
		} finally {
			busy = false;
		}
	}

	async function remove() {
		if (!l) return;
		busy = true;
		try {
			await api(`/lists/${l.id}`, { method: 'DELETE' });
			await lists.load();
			onsaved?.(null);
			onclose();
		} catch {
			error = 'Löschen fehlgeschlagen.';
		} finally {
			busy = false;
		}
	}
</script>

<Modal title={l ? 'Liste bearbeiten' : 'Neue Liste'} {onclose}>
	{#if confirmDelete && l}
		<p>„{l.title}“ mit allen {l.items.length} Einträgen löschen?</p>
		<p class="error" role="alert">{error}</p>
		<div class="actions">
			<button class="btn" onclick={() => (confirmDelete = false)}>Abbrechen</button>
			<button class="btn danger" onclick={remove} disabled={busy}>Löschen</button>
		</div>
	{:else}
		<form onsubmit={save}>
			<label for="lf-title">Name</label>
			<input id="lf-title" type="text" bind:value={title} required maxlength="100" />
			<label for="lf-icon">Symbol</label>
			<IconPicker bind:value={icon} icons={LIST_ICONS} />
			<p class="error" role="alert">{error}</p>
			<div class="actions">
				<button class="btn" type="button" onclick={onclose}>Abbrechen</button>
				<button class="btn primary" type="submit" disabled={busy || !title.trim()}>Speichern</button
				>
			</div>
		</form>
		{#if l}
			<div class="danger-zone">
				<ParentGate label="Zum Löschen als Elternteil anmelden">
					<button class="btn danger" onclick={() => (confirmDelete = true)}>Liste löschen</button>
				</ParentGate>
			</div>
		{/if}
	{/if}
</Modal>

<style>
	.btn.danger {
		background: var(--danger);
		color: #fff;
	}
	.danger-zone {
		margin-top: 16px;
		padding-top: 12px;
		border-top: 1px solid var(--surface-2);
	}
</style>
