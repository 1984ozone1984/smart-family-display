<script lang="ts">
	import type { MealEntry } from '#lib/api.ts';
	import DayNav from '#lib/components/DayNav.svelte';
	import MealPlanDialog from '#lib/components/MealPlanDialog.svelte';
	import Modal from '#lib/components/Modal.svelte';
	import RecipeDialog from '#lib/components/RecipeDialog.svelte';
	import { addDays, fmtDayShort, fromIsoDate, isoDate } from '#lib/dates.ts';
	import { longpress } from '#lib/longpress.ts';
	import { meals } from '#lib/meals.svelte.ts';
	import { onMount } from 'svelte';

	const SLOTS = [
		{ type: 'breakfast', label: 'Frühstück' },
		{ type: 'lunch', label: 'Mittag' },
		{ type: 'dinner', label: 'Abend' }
	];
	const MAIN = SLOTS.map((s) => s.type);

	let open = $state<MealEntry | null>(null);
	let confirm = $state(false);
	/** Planen: Tag und Mahlzeit vom Ort des Drückens, ggf. vorhandener Eintrag zum Ersetzen */
	let planning = $state<{ date: string; type: string; entry?: MealEntry } | null>(null);

	onMount(() => void meals.loadWeek());

	const days = $derived(
		meals.weekStart
			? Array.from({ length: 7 }, (_, i) => isoDate(addDays(fromIsoDate(meals.weekStart), i)))
			: []
	);
	const recipes = $derived(new Set(meals.entries.flatMap((e) => (e.recipe ? [e.recipe.id] : []))));
	// Beilage, Snack, Dessert … nur zeigen, wenn es so etwas in der Woche gibt
	const hasOther = $derived(meals.entries.some((e) => !MAIN.includes(e.type)));
	const slots = $derived(hasOther ? [...SLOTS, { type: 'other', label: 'Weiteres' }] : SLOTS);
	const at = (date: string, type: string) =>
		meals.entries.filter(
			(e) => e.date === date && (type === 'other' ? !MAIN.includes(e.type) : e.type === type)
		);
	const shift = (weeks: number) =>
		void meals.showWeek(isoDate(addDays(fromIsoDate(meals.weekStart), weeks * 7)));
</script>

<div class="toolbar">
	{#if days.length}
		<DayNav
			label="{fmtDayShort(fromIsoDate(days[0]!))} – {fmtDayShort(fromIsoDate(days[6]!))}"
			isToday={days.includes(meals.today)}
			onprev={() => shift(-1)}
			onnext={() => shift(1)}
			ontoday={() => void meals.showWeek(null)}
		/>
	{/if}
	{#if meals.mealsStatus === 'ok'}
		<div class="actions">
			{#if meals.links}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- externe Mealie-Adresse -->
				<a class="btn" href={meals.links.planner} target="_blank" rel="noopener">In Mealie öffnen</a
				>
			{/if}
			<button class="btn" disabled={!recipes.size} onclick={() => (confirm = true)}>
				🛒 Zutaten der Woche auf die Einkaufsliste
			</button>
		</div>
	{/if}
</div>

{#if meals.mealsStatus === 'off'}
	<p class="card muted">Mealie ist nicht eingerichtet (siehe docs/mealie-setup.md).</p>
{:else if meals.mealsStatus === 'error'}
	<p class="card muted">Mealie ist gerade nicht erreichbar.</p>
{:else if meals.mealsStatus === 'ok'}
	<div class="week">
		{#each days as d (d)}
			<section class="day" class:today={d === meals.today}>
				<header>{fmtDayShort(fromIsoDate(d))}</header>
				{#each slots as s (s.type)}
					<!-- Langes Drücken plant für diesen Tag und diese Mahlzeit; leere Mahlzeit: Antippen reicht -->
					{@const list = at(d, s.type)}
					<div class="slot" {@attach longpress(() => (planning = { date: d, type: s.type }))}>
						{#if list.length}
							<small class="muted">{s.label}</small>
						{:else}
							<button
								class="empty-slot"
								onclick={() => (planning = { date: d, type: s.type })}
								aria-label="{s.label} am {fmtDayShort(fromIsoDate(d))} planen"
								><small class="muted">{s.label}</small><span aria-hidden="true">+</span></button
							>
						{/if}
						{#each list as e (e.id)}
							{#if e.recipe}
								<button
									class="meal"
									onclick={() => (open = e)}
									{@attach longpress(() => (planning = { date: d, type: e.type, entry: e }))}
								>
									{#if e.recipe.image}
										<img src="/api/v1/recipes/{e.recipe.id}/image" alt="" loading="lazy" />
									{/if}
									<span>{e.title}</span>
								</button>
							{:else}
								<button
									class="meal note"
									onclick={() => (planning = { date: d, type: e.type, entry: e })}
									{@attach longpress(() => (planning = { date: d, type: e.type, entry: e }))}
								>
									<span>{e.title || e.text}</span>
								</button>
							{/if}
						{/each}
					</div>
				{/each}
			</section>
		{/each}
	</div>
	{#if !meals.entries.length}
		<p class="muted empty">
			Für diese Woche ist noch nichts geplant. Der Plan wird in Mealie gepflegt.
		</p>
	{/if}
{/if}

{#if open?.recipe}
	<RecipeDialog
		slug={open.recipe.slug}
		title={open.title}
		mealieUrl={meals.links?.recipe ? meals.links.recipe + open.recipe.slug : null}
		onclose={() => (open = null)}
	/>
{/if}

{#if planning}
	<MealPlanDialog
		date={planning.date}
		type={planning.type}
		entry={planning.entry ?? null}
		onclose={() => (planning = null)}
	/>
{/if}

{#if confirm}
	<Modal title="Auf die Einkaufsliste?" onclose={() => (confirm = false)}>
		<p>
			Die Zutaten von {recipes.size}
			{recipes.size === 1 ? 'Rezept' : 'Rezepten'} dieser Woche kommen auf die Einkaufsliste. Gleiche
			Zutaten fasst Mealie zusammen.
		</p>
		<div class="actions">
			<button class="btn" onclick={() => (confirm = false)}>Abbrechen</button>
			<button
				class="btn primary"
				onclick={() => {
					confirm = false;
					void meals.addWeekToShopping();
				}}>Hinzufügen</button
			>
		</div>
	</Modal>
{/if}

<style>
	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 12px;
		margin-bottom: 12px;
	}
	.week {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		gap: 8px;
	}
	.day {
		display: flex;
		flex-direction: column;
		gap: 6px;
		background: var(--surface);
		border-radius: var(--radius);
		padding: 8px;
	}
	.day.today {
		box-shadow: inset 0 0 0 3px var(--accent);
	}
	header {
		font-weight: 700;
	}
	.actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	a.btn {
		display: inline-flex;
		align-items: center;
		background: var(--surface-2);
		color: inherit;
		text-decoration: none;
	}
	.slot {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-height: 120px;
		/* Langes Drücken soll nicht Text markieren */
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}
	.empty-slot {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
		padding: 0;
		background: none;
		text-align: left;
	}
	.empty-slot span {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		flex: 1;
		min-height: 40px;
		border: 2px dashed var(--surface-2);
		border-radius: 12px;
		color: var(--text-muted);
		font-size: 22px;
	}
	.meal {
		display: flex;
		flex-direction: column;
		gap: 4px;
		width: 100%;
		padding: 6px;
		border-radius: 12px;
		background: var(--surface-2);
		text-align: left;
		font-weight: 600;
		font-size: 15px;
		line-height: 1.25;
		hyphens: auto;
		overflow-wrap: break-word;
	}
	.meal.note {
		font-weight: 500;
		color: var(--text-muted);
	}
	.meal img {
		width: 100%;
		aspect-ratio: 4 / 3;
		object-fit: cover;
		border-radius: 8px;
	}
	.empty {
		margin-top: 12px;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
	@media (max-width: 640px) {
		.week {
			grid-template-columns: 1fr;
		}
		.slot {
			min-height: 0;
		}
		.empty-slot {
			flex-direction: row;
			align-items: center;
		}
		.empty-slot span {
			min-height: 36px;
		}
		.meal {
			flex-direction: row;
			align-items: center;
		}
		.meal img {
			width: 64px;
		}
	}
</style>
