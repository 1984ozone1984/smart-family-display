<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { api, ApiError, type Person } from '#lib/api.ts';
	import { app, PALETTE } from '#lib/app.svelte.ts';
	import ColorPicker from '#lib/components/ColorPicker.svelte';
	import PinPad from '#lib/components/PinPad.svelte';

	let name = $state('');
	let color = $state(PALETTE[0]!);
	let email = $state('');
	let step = $state<'form' | 'pin' | 'confirm'>('form');
	let firstPin = '';
	let error = $state('');

	async function onPin(pin: string) {
		if (step === 'pin') {
			firstPin = pin;
			step = 'confirm';
			error = '';
			return;
		}
		if (pin !== firstPin) {
			step = 'pin';
			error = 'PINs stimmen nicht überein';
			return;
		}
		try {
			const { person } = await api<{ person: Person }>('/setup', {
				method: 'POST',
				json: { name, color, pin, email: email.trim() || undefined }
			});
			app.setupNeeded = false;
			app.me = person;
			await app.loadPersons();
			await goto(resolve('/'));
		} catch (err) {
			step = 'form';
			error =
				err instanceof ApiError && err.status === 403
					? 'Einrichtung ist nur im Heimnetz möglich.'
					: 'Einrichtung fehlgeschlagen.';
		}
	}
</script>

<div class="card setup">
	<h1>Willkommen</h1>
	{#if step === 'form'}
		<p class="muted">
			Lege zuerst einen Elternteil an. Weitere Personen folgen in den Einstellungen.
		</p>
		<form
			onsubmit={(e) => {
				e.preventDefault();
				step = 'pin';
			}}
		>
			<label for="name">Name</label>
			<input id="name" type="text" bind:value={name} required maxlength="40" />
			<label for="color">Farbe</label>
			<ColorPicker bind:value={color} />
			<label for="email">E-Mail (optional, für den Handy-Login)</label>
			<input id="email" type="email" bind:value={email} />
			<p class="error">{error}</p>
			<button class="btn primary" type="submit" disabled={!name.trim()}>Weiter zur PIN</button>
		</form>
	{:else}
		<p>{step === 'pin' ? 'Wähle eine 4-stellige PIN' : 'PIN wiederholen'}</p>
		{#key step}
			<PinPad onsubmit={onPin} {error} />
		{/key}
	{/if}
</div>

<style>
	.setup {
		max-width: 520px;
		margin: 24px auto;
		padding: 24px;
	}
	h1 {
		margin-top: 0;
	}
	.error {
		color: var(--danger);
		min-height: 24px;
	}
</style>
