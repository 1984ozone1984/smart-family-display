<script lang="ts">
	import { untrack } from 'svelte';
	import { api, ApiError, type Person, type Role } from '../api.ts';
	import { PALETTE } from '../app.svelte.ts';
	import Avatar from './Avatar.svelte';
	import ColorPicker from './ColorPicker.svelte';

	let { person, onclose }: { person: Person | null; onclose: () => void } = $props();

	// Formular startet mit den Werten der Person und wird danach lokal bearbeitet.
	const initial = untrack(() => person);
	let name = $state(initial?.name ?? '');
	let color = $state(initial?.color ?? PALETTE[5]!);
	let role = $state<Role>(initial?.role ?? 'child');
	let email = $state(initial?.email ?? '');
	let pin = $state('');
	let error = $state('');
	let busy = $state(false);

	const MESSAGES: Record<string, string> = {
		'last parent': 'Mindestens ein Elternteil muss bleiben.',
		'only jpeg, png, webp': 'Nur JPEG, PNG oder WebP.'
	};

	function message(err: unknown) {
		if (err instanceof ApiError) {
			if (err.status === 401 || err.status === 403) return 'Bitte als Elternteil anmelden.';
			return MESSAGES[String(err.body.error)] ?? 'Speichern fehlgeschlagen.';
		}
		return 'Verbindung fehlgeschlagen.';
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		if (!person && !/^\d{4}$/.test(pin)) return (error = 'PIN muss 4 Ziffern haben.');
		if (pin && !/^\d{4}$/.test(pin)) return (error = 'PIN muss 4 Ziffern haben.');
		busy = true;
		error = '';
		const json = {
			name: name.trim(),
			color,
			role,
			email: email.trim() || null,
			...(pin ? { pin } : {})
		};
		try {
			if (person) await api(`/persons/${person.id}`, { method: 'PATCH', json });
			else await api('/persons', { method: 'POST', json });
			onclose();
		} catch (err) {
			error = message(err);
		} finally {
			busy = false;
		}
	}

	async function upload(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (!file || !person) return;
		const body = new FormData();
		body.append('file', file);
		busy = true;
		try {
			await api(`/persons/${person.id}/avatar`, { method: 'POST', body });
		} catch (err) {
			error = message(err);
		} finally {
			busy = false;
		}
	}
</script>

<form class="card" onsubmit={save}>
	<h2>{person ? `${person.name} bearbeiten` : 'Person hinzufügen'}</h2>

	{#if person}
		<div class="avatar-row">
			<Avatar person={{ name, color, avatarUrl: person.avatarUrl }} size={72} />
			<label class="btn upload">
				Foto wählen
				<input type="file" accept="image/jpeg,image/png,image/webp" onchange={upload} hidden />
			</label>
		</div>
	{/if}

	<label for="pf-name">Name</label>
	<input id="pf-name" type="text" bind:value={name} required maxlength="40" />

	<label for="pf-color">Farbe</label>
	<ColorPicker bind:value={color} />

	<label for="pf-role">Rolle</label>
	<div class="segmented" id="pf-role">
		<button type="button" class:active={role === 'child'} onclick={() => (role = 'child')}
			>Kind</button
		>
		<button type="button" class:active={role === 'parent'} onclick={() => (role = 'parent')}>
			Elternteil
		</button>
	</div>

	<label for="pf-email">E-Mail (für Handy-Login, optional)</label>
	<input id="pf-email" type="email" bind:value={email} />

	<label for="pf-pin">{person ? 'Neue PIN (leer = unverändert)' : 'PIN (4 Ziffern)'}</label>
	<input
		id="pf-pin"
		type="password"
		inputmode="numeric"
		autocomplete="off"
		maxlength="4"
		bind:value={pin}
	/>

	<p class="error" role="alert">{error}</p>
	<div class="actions">
		<button class="btn" type="button" onclick={onclose}>Abbrechen</button>
		<button class="btn primary" type="submit" disabled={busy || !name.trim()}>Speichern</button>
	</div>
</form>

<style>
	form {
		max-width: 560px;
	}
	h2 {
		margin-top: 0;
	}
	.avatar-row {
		display: flex;
		align-items: center;
		gap: 16px;
	}
	.upload {
		display: inline-flex;
		align-items: center;
		margin: 0;
	}
	.segmented {
		display: inline-flex;
		background: var(--surface-2);
		border-radius: 12px;
		padding: 4px;
	}
	.segmented button {
		min-height: 44px;
		padding: 0 20px;
		border-radius: 10px;
		background: none;
		font-weight: 600;
	}
	.segmented .active {
		background: var(--surface);
	}
	.error {
		color: var(--danger);
		min-height: 24px;
	}
	.actions {
		display: flex;
		gap: 12px;
		justify-content: flex-end;
	}
</style>
