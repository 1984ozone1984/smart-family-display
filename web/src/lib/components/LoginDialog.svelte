<script lang="ts">
	import { onMount } from 'svelte';
	import { api, ApiError, type Person } from '../api.ts';
	import { app } from '../app.svelte.ts';
	import Avatar from './Avatar.svelte';
	import PinPad from './PinPad.svelte';

	let {
		parentsOnly = false,
		title = 'Wer bist du?',
		onclose,
		ondone
	}: {
		parentsOnly?: boolean;
		title?: string;
		onclose?: () => void;
		ondone?: () => void;
	} = $props();

	let all = $state<Person[]>([]);
	let selected = $state<Person | null>(null);
	let error = $state('');
	let busy = $state(false);
	const choices = $derived(all.filter((p) => !parentsOnly || p.role === 'parent'));

	onMount(async () => {
		const res = await api<{ persons: Person[]; suggestedId: number | null }>('/session/persons');
		all = res.persons;
		// Handy: Access-E-Mail passt zu einer Person, dann gleich zur PIN
		const suggested = choices.find((p) => p.id === res.suggestedId);
		if (suggested) selected = suggested;
	});

	async function submit(pin: string) {
		if (!selected) return;
		busy = true;
		error = '';
		try {
			await app.login(selected.id, pin);
			ondone?.();
		} catch (err) {
			if (err instanceof ApiError && err.status === 429) {
				const min = Math.ceil(Number(err.body.retryAfterSec ?? 60) / 60);
				error = `Zu viele Versuche – bitte ${min} min warten`;
			} else if (err instanceof ApiError && err.status === 401) {
				error = 'Falsche PIN';
			} else {
				error = 'Verbindung fehlgeschlagen';
			}
		} finally {
			busy = false;
		}
	}
</script>

<div
	class="backdrop"
	role="presentation"
	onclick={(e) => e.target === e.currentTarget && onclose?.()}
>
	<div class="dialog" role="dialog" aria-modal="true" aria-label={title}>
		{#if onclose}
			<button class="close" type="button" onclick={onclose} aria-label="Schließen">✕</button>
		{/if}
		{#if !selected}
			<h2>{title}</h2>
			<div class="people">
				{#each choices as p (p.id)}
					<button type="button" class="person" onclick={() => (selected = p)}>
						<Avatar person={p} size={88} />
						<span>{p.name}</span>
					</button>
				{/each}
			</div>
		{:else}
			<button type="button" class="back" onclick={() => ((selected = null), (error = ''))}>
				<Avatar person={selected} size={40} />
				<span>{selected.name} · andere Person</span>
			</button>
			<PinPad onsubmit={submit} {error} disabled={busy} />
		{/if}
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 10;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgb(15 23 42 / 0.6);
		padding: 16px;
	}
	.dialog {
		position: relative;
		background: var(--surface);
		border-radius: 24px;
		padding: 24px 32px;
		max-width: 100%;
		max-height: 100%;
		overflow: auto;
	}
	h2 {
		text-align: center;
		margin: 0 0 20px;
	}
	.close {
		position: absolute;
		top: 8px;
		right: 8px;
		width: 48px;
		height: 48px;
		font-size: 22px;
		background: none;
	}
	.people {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 16px;
	}
	.person {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 12px;
		min-width: 120px;
		border-radius: 16px;
		background: none;
		font-size: 18px;
		font-weight: 600;
	}
	.person:active {
		background: var(--surface-2);
	}
	.back {
		display: flex;
		align-items: center;
		gap: 12px;
		margin: 0 auto 16px;
		min-height: 48px;
		padding: 4px 16px 4px 4px;
		border-radius: 999px;
		background: var(--surface-2);
	}
</style>
