<script lang="ts">
	import type { Recipe } from '../api.ts';
	import { meals } from '../meals.svelte.ts';
	import Modal from './Modal.svelte';

	let {
		slug,
		title,
		mealieUrl = null,
		onclose
	}: {
		slug: string;
		title: string;
		/** Link zum Rezept in der Mealie-Oberfläche (nur im LAN) */
		mealieUrl?: string | null;
		onclose: () => void;
	} = $props();

	let recipe = $state<Recipe | null>(null);
	let failed = $state(false);

	$effect(() => {
		recipe = null;
		failed = false;
		meals.recipe(slug).then(
			(r) => (recipe = r),
			() => (failed = true)
		);
	});

	// Zwischenüberschrift nur anzeigen, wenn sie sich gegenüber dem Vorgänger ändert
	const heading = <T extends { section: string | null }>(list: T[], i: number) =>
		list[i]?.section && list[i]?.section !== list[i - 1]?.section ? list[i]!.section : null;
	const facts = $derived(
		recipe ? [recipe.yield, recipe.totalTime && `⏱ ${recipe.totalTime}`].filter(Boolean) : []
	);
</script>

<Modal title={recipe?.name ?? title} {onclose}>
	{#if failed}
		<p class="muted">Das Rezept konnte nicht geladen werden.</p>
	{:else if !recipe}
		<p class="muted">Lädt …</p>
	{:else}
		{#if recipe.image}
			<img src="/api/v1/recipes/{recipe.id}/image" alt="" />
		{/if}
		{#if facts.length}<p class="facts">{facts.join(' · ')}</p>{/if}
		{#if recipe.description}<p>{recipe.description}</p>{/if}

		{#if recipe.ingredients.length}
			<h3>Zutaten</h3>
			<ul class="ingredients">
				{#each recipe.ingredients as ing, i (i)}
					{@const h = heading(recipe.ingredients, i)}
					{#if h}<li class="section">{h}</li>{/if}
					<li>{ing.text}</li>
				{/each}
			</ul>
		{/if}

		{#if recipe.steps.length}
			<h3>Zubereitung</h3>
			<ol class="steps">
				{#each recipe.steps as step, i (i)}
					{@const h = heading(recipe.steps, i)}
					{#if h}<li class="section">{h}</li>{/if}
					<li class="step">{step.text}</li>
				{/each}
			</ol>
		{/if}
		{#if mealieUrl}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- externe Mealie-Adresse -->
			<a class="btn mealie" href={mealieUrl} target="_blank" rel="noopener">In Mealie bearbeiten</a>
		{/if}
	{/if}
</Modal>

<style>
	img {
		display: block;
		width: 100%;
		max-height: 260px;
		object-fit: cover;
		border-radius: 16px;
	}
	.facts {
		color: var(--text-muted);
		font-weight: 600;
	}
	h3 {
		margin: 20px 0 8px;
	}
	ul,
	ol {
		margin: 0;
		padding-left: 0;
		list-style: none;
		font-size: 18px;
		line-height: 1.4;
	}
	.ingredients li {
		padding: 6px 0;
		border-bottom: 1px solid var(--surface-2);
	}
	.steps {
		counter-reset: step;
	}
	.step {
		position: relative;
		padding: 8px 0 8px 40px;
		white-space: pre-line;
	}
	.step::before {
		counter-increment: step;
		content: counter(step);
		position: absolute;
		left: 0;
		top: 8px;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		background: var(--surface-2);
		text-align: center;
		font-weight: 700;
		line-height: 28px;
	}
	.mealie {
		display: flex;
		align-items: center;
		justify-content: center;
		margin-top: 20px;
		background: var(--surface-2);
		color: inherit;
		text-decoration: none;
	}
	li.section {
		padding-top: 12px;
		border: none;
		font-weight: 700;
		color: var(--text-muted);
	}
</style>
