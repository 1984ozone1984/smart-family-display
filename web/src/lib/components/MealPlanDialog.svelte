<script lang="ts">
	import { untrack } from 'svelte';
	import type { MealEntry, RecipeRef } from '../api.ts';
	import { fmtDayShort, fromIsoDate } from '../dates.ts';
	import { meals } from '../meals.svelte.ts';
	import Modal from './Modal.svelte';

	let {
		date,
		type: initialType,
		entry = null,
		onclose
	}: {
		date: string;
		type: string;
		/** Vorhandener Eintrag: wird ersetzt bzw. kann entfernt werden */
		entry?: MealEntry | null;
		onclose: () => void;
	} = $props();

	const TYPES = [
		{ type: 'breakfast', label: 'Frühstück' },
		{ type: 'lunch', label: 'Mittag' },
		{ type: 'dinner', label: 'Abend' },
		{ type: 'side', label: 'Beilage' },
		{ type: 'snack', label: 'Snack' },
		{ type: 'dessert', label: 'Dessert' },
		{ type: 'drink', label: 'Getränk' }
	];

	// Vorauswahl aus dem Ort des Drückens; „Weiteres“ startet mit Beilage
	const start = untrack(() => initialType);
	let type = $state(start === 'other' ? 'side' : start);
	let query = $state('');
	let results = $state<RecipeRef[]>([]);
	let searching = $state(false);
	let text = $state('');
	let busy = $state(false);
	let error = $state('');

	// Suche mit kurzer Verzögerung, damit nicht jeder Tastendruck Mealie fragt
	$effect(() => {
		const q = query;
		const t = setTimeout(async () => {
			searching = true;
			try {
				const r = await meals.search(q);
				if (q === query) results = r;
			} catch {
				error = 'Mealie ist gerade nicht erreichbar.';
			} finally {
				searching = false;
			}
		}, 250);
		return () => clearTimeout(t);
	});

	async function save(what: { recipeId: string } | { title: string } | { random: true }) {
		busy = true;
		error = '';
		const msg = await meals.plan({
			date,
			type,
			...what,
			...(entry ? { replace: entry.id } : {})
		});
		busy = false;
		if (msg) error = msg;
		else onclose();
	}

	async function remove() {
		if (!entry) return;
		busy = true;
		await meals.unplan(entry.id);
		onclose();
	}

	const label = $derived(TYPES.find((t) => t.type === type)?.label ?? '');
</script>

<Modal
	title="{entry ? 'Ändern' : 'Essen planen'} – {fmtDayShort(fromIsoDate(date))}, {label}"
	{onclose}
>
	{#if entry}
		<p class="current">Bisher: <strong>{entry.title || entry.text}</strong></p>
	{/if}

	<div class="types" role="radiogroup" aria-label="Mahlzeit">
		{#each TYPES as t (t.type)}
			<button
				class="chip"
				class:active={type === t.type}
				role="radio"
				aria-checked={type === t.type}
				onclick={() => (type = t.type)}>{t.label}</button
			>
		{/each}
	</div>

	<div class="row">
		<input
			type="search"
			bind:value={query}
			placeholder="Rezept suchen …"
			aria-label="Rezept suchen"
			maxlength="100"
		/>
		<button class="btn" disabled={busy} onclick={() => save({ random: true })}>🎲 Zufällig</button>
	</div>

	{#if error}<p class="error" role="alert">{error}</p>{/if}

	<div class="results" aria-busy={searching}>
		{#each results as r (r.id)}
			<button class="recipe" disabled={busy} onclick={() => save({ recipeId: r.id })}>
				{#if r.image}
					<img src="/api/v1/recipes/{r.id}/image" alt="" loading="lazy" />
				{:else}
					<span class="noimg" aria-hidden="true">🍽️</span>
				{/if}
				<span>{r.name}</span>
			</button>
		{:else}
			{#if !searching}
				<p class="muted">
					{query ? 'Kein Rezept gefunden.' : 'Noch keine Rezepte in Mealie.'}
				</p>
			{/if}
		{/each}
	</div>

	<form
		class="row"
		onsubmit={(e) => {
			e.preventDefault();
			if (text.trim()) void save({ title: text.trim() });
		}}
	>
		<input
			type="text"
			bind:value={text}
			placeholder="Oder nur Text, z. B. Reste"
			aria-label="Nur Text"
			maxlength="100"
		/>
		<button class="btn" type="submit" disabled={busy || !text.trim()}>Eintragen</button>
	</form>

	{#if entry}
		<button class="btn danger remove" disabled={busy} onclick={remove}>Entfernen</button>
	{/if}
</Modal>

<style>
	.current {
		margin-top: 0;
	}
	.types {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 12px;
	}
	.chip {
		min-height: 40px;
		padding: 0 14px;
		border-radius: 999px;
		background: var(--surface-2);
		font-weight: 600;
	}
	.chip.active {
		background: var(--accent);
		color: #fff;
	}
	.row {
		display: flex;
		gap: 8px;
		margin: 8px 0;
	}
	.row input {
		flex: 1;
		min-width: 0;
	}
	.results {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
		gap: 8px;
		max-height: 340px;
		overflow-y: auto;
		margin: 8px 0;
	}
	.recipe {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 6px;
		border-radius: 12px;
		background: var(--surface-2);
		text-align: left;
		font-weight: 600;
		font-size: 15px;
		hyphens: auto;
		overflow-wrap: break-word;
	}
	.recipe img,
	.noimg {
		width: 100%;
		aspect-ratio: 4 / 3;
		object-fit: cover;
		border-radius: 8px;
	}
	.noimg {
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--surface);
		font-size: 32px;
	}
	.error {
		color: var(--danger);
	}
	.btn.danger {
		background: var(--danger);
		color: #fff;
	}
	.remove {
		width: 100%;
		margin-top: 8px;
	}
</style>
