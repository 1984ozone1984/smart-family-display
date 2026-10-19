<script lang="ts">
	import type { FamilyList, ListItem, ShoppingItem } from '#lib/api.ts';
	import ListForm from '#lib/components/ListForm.svelte';
	import { lists } from '#lib/lists.svelte.ts';
	import { meals } from '#lib/meals.svelte.ts';

	/** Eigene Liste oder die Einkaufsliste aus Mealie (gleiche Bedienung, ohne Sortieren) */
	type View = {
		key: number | 'shopping';
		title: string;
		icon: string;
		items: (ListItem | ShoppingItem)[];
		list: FamilyList | null;
	};

	let selectedId = $state<number | 'shopping' | null>(null);
	let form = $state<FamilyList | 'new' | null>(null);
	let editing = $state(false);
	let text = $state('');
	let drafts = $state<Record<string, string>>({});

	const views = $derived<View[]>([
		...(meals.shoppingStatus === 'off'
			? []
			: [
					{
						key: 'shopping' as const,
						title: 'Einkaufsliste',
						icon: '🛒',
						items: meals.shopping,
						list: null
					}
				]),
		...lists.lists.map((l) => ({
			key: l.id,
			title: l.title,
			icon: l.icon ?? '📝',
			items: l.items,
			list: l
		}))
	]);
	// Ohne Auswahl (oder nach dem Löschen) die erste Liste zeigen
	const current = $derived(views.find((v) => v.key === selectedId) ?? views[0] ?? null);
	const shop = $derived(current?.key === 'shopping');
	// Offene zuerst, abgehakte darunter; beim Bearbeiten die echte Reihenfolge
	const shown = $derived(
		!current
			? []
			: editing
				? current.items
				: [...current.items.filter((i) => !i.done), ...current.items.filter((i) => i.done)]
	);
	const doneCount = $derived(current?.items.filter((i) => i.done).length ?? 0);
	const listIndex = (id: number) => lists.lists.findIndex((l) => l.id === id);

	function select(key: number | 'shopping') {
		selectedId = key;
		editing = false;
	}

	async function add(e: SubmitEvent) {
		e.preventDefault();
		if (!current || !text.trim()) return;
		const t = text.trim();
		text = '';
		await (current.list ? lists.add(current.list.id, t) : meals.add(t));
	}

	function toggle(item: ListItem | ShoppingItem) {
		if (current?.list) void lists.toggle(current.list.id, item as ListItem);
		else void meals.toggle(item as ShoppingItem);
	}

	function remove(item: ListItem | ShoppingItem) {
		if (current?.list) void lists.remove(current.list.id, item.id as number);
		else void meals.remove(item.id as string);
	}

	function clearDone() {
		if (current?.list) void lists.clearDone(current.list.id);
		else void meals.clearDone();
	}

	async function saveText(item: ListItem | ShoppingItem) {
		const t = drafts[item.id]?.trim();
		if (!current || !t || t === item.text) return;
		await (current.list
			? lists.edit(current.list.id, item.id as number, t)
			: meals.edit(item.id as string, t));
	}

	function startEdit() {
		drafts = Object.fromEntries(current?.items.map((i) => [i.id, i.text]) ?? []);
		editing = true;
	}
</script>

<div class="page">
	<aside class="overview" aria-label="Listen">
		{#each views as v (v.key)}
			<div class="entry" class:active={current?.key === v.key}>
				<button class="pick" onclick={() => select(v.key)}>
					<span class="icon" aria-hidden="true">{v.icon}</span>
					<span class="name">{v.title}</span>
					<span class="count">{v.items.filter((x) => !x.done).length}</span>
				</button>
				{#if editing && current?.key === v.key && v.list}
					{@const i = listIndex(v.list.id)}
					<span class="order">
						<button
							aria-label="Liste nach oben"
							disabled={i === 0}
							onclick={() => lists.moveList(v.list!.id, i - 1)}>↑</button
						>
						<button
							aria-label="Liste nach unten"
							disabled={i === lists.lists.length - 1}
							onclick={() => lists.moveList(v.list!.id, i + 1)}>↓</button
						>
					</span>
				{/if}
			</div>
		{/each}
		<button class="btn new" onclick={() => (form = 'new')}>+ Liste</button>
	</aside>

	<section class="card list">
		{#if current}
			<header>
				<h1><span aria-hidden="true">{current.icon}</span> {current.title}</h1>
				<div class="tools">
					{#if editing}
						{#if current.list}
							<button class="btn" onclick={() => (form = current.list)}>Name & Symbol</button>
						{/if}
						<button class="btn primary" onclick={() => (editing = false)}>Fertig</button>
					{:else}
						<button class="btn" onclick={startEdit}>Bearbeiten</button>
					{/if}
				</div>
			</header>

			{#if shop && meals.shoppingStatus === 'error'}
				<p class="muted">Mealie ist gerade nicht erreichbar.</p>
			{/if}

			{#if !editing}
				<form class="add" onsubmit={add}>
					<input
						type="text"
						bind:value={text}
						placeholder="Neuer Eintrag …"
						maxlength="200"
						aria-label="Neuer Eintrag"
						enterkeyhint="done"
					/>
					<button class="btn primary" type="submit" disabled={!text.trim()}>Hinzufügen</button>
				</form>
			{/if}

			<ul class="items">
				{#each shown as item, i (item.id)}
					<li class:done={item.done}>
						{#if editing}
							<input
								type="text"
								bind:value={drafts[item.id]}
								onblur={() => saveText(item)}
								onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
								maxlength="200"
								aria-label="Eintrag bearbeiten"
							/>
							<span class="order">
								{#if current.list}
									{@const listId = current.list.id}
									<button
										aria-label="Nach oben"
										disabled={i === 0}
										onclick={() => lists.move(listId, item.id as number, i - 1)}>↑</button
									>
									<button
										aria-label="Nach unten"
										disabled={i === shown.length - 1}
										onclick={() => lists.move(listId, item.id as number, i + 1)}>↓</button
									>
								{/if}
								<button class="del" aria-label="Löschen" onclick={() => remove(item)}>✕</button>
							</span>
						{:else}
							<button class="item" aria-pressed={item.done} onclick={() => toggle(item)}>
								<span class="box" aria-hidden="true">{item.done ? '✓' : ''}</span>
								<span class="text">{item.text}</span>
							</button>
						{/if}
					</li>
				{:else}
					<li class="muted empty">Noch keine Einträge.</li>
				{/each}
			</ul>

			{#if !editing && doneCount}
				<button class="btn clear" onclick={clearDone}>
					{doneCount} erledigte entfernen
				</button>
			{/if}
		{:else}
			<p class="muted">Noch keine Listen. Lege mit „+ Liste“ die erste an.</p>
		{/if}
	</section>
</div>

{#if form}
	<ListForm
		list={form === 'new' ? null : form}
		onclose={() => (form = null)}
		onsaved={(id) => {
			selectedId = id;
			if (id === null) editing = false;
		}}
	/>
{/if}

<style>
	.page {
		display: grid;
		grid-template-columns: minmax(200px, 280px) 1fr;
		gap: 16px;
		align-items: start;
	}
	.overview {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.entry {
		display: flex;
		align-items: center;
		gap: 4px;
		border-radius: 14px;
		background: var(--surface);
	}
	.entry.active {
		outline: 3px solid var(--accent);
	}
	.pick {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 56px;
		padding: 6px 12px;
		border-radius: 14px;
		background: none;
		font-weight: 600;
		text-align: left;
	}
	.pick .icon {
		font-size: 24px;
	}
	.pick .name {
		flex: 1;
		hyphens: auto;
		overflow-wrap: break-word;
	}
	.count {
		min-width: 28px;
		padding: 2px 8px;
		border-radius: 999px;
		background: var(--surface-2);
		text-align: center;
		font-size: 14px;
	}
	.list header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}
	h1 {
		margin: 0;
		font-size: 24px;
	}
	.tools {
		display: flex;
		gap: 8px;
	}
	.add {
		display: flex;
		gap: 8px;
		margin: 12px 0;
	}
	.add input {
		flex: 1;
		min-width: 0;
	}
	.items {
		list-style: none;
		padding: 0;
		margin: 12px 0 0;
	}
	.items li {
		display: flex;
		align-items: center;
		gap: 8px;
		border-bottom: 1px solid var(--surface-2);
	}
	.items li.empty {
		padding: 12px 0;
	}
	.items li input {
		flex: 1;
		min-width: 0;
		margin: 6px 0;
	}
	.item {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 56px;
		padding: 6px 4px;
		background: none;
		text-align: left;
		font-size: 18px;
	}
	.box {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border: 2px solid var(--border);
		border-radius: 8px;
		font-weight: 700;
	}
	.text {
		hyphens: auto;
		overflow-wrap: break-word;
	}
	.done .box {
		background: var(--surface-2);
	}
	.done .text {
		color: var(--text-muted);
		text-decoration: line-through;
	}
	.order {
		display: flex;
		gap: 4px;
	}
	.order button {
		width: 44px;
		height: 44px;
		border-radius: 10px;
		background: var(--surface-2);
		font-size: 18px;
	}
	.order .del {
		color: var(--danger);
	}
	.clear {
		margin-top: 12px;
	}
	@media (max-width: 700px) {
		.page {
			grid-template-columns: 1fr;
		}
		.overview {
			flex-direction: row;
			overflow-x: auto;
			padding: 4px;
		}
		.entry {
			flex: none;
		}
	}
</style>
