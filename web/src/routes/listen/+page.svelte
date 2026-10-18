<script lang="ts">
	import type { FamilyList } from '#lib/api.ts';
	import ListForm from '#lib/components/ListForm.svelte';
	import { lists } from '#lib/lists.svelte.ts';

	let selectedId = $state<number | null>(null);
	let form = $state<FamilyList | 'new' | null>(null);
	let editing = $state(false);
	let text = $state('');
	let drafts = $state<Record<number, string>>({});

	// Ohne Auswahl (oder nach dem Löschen) die erste Liste zeigen
	const current = $derived(lists.lists.find((l) => l.id === selectedId) ?? lists.lists[0] ?? null);
	// Offene zuerst, abgehakte darunter; beim Bearbeiten die echte Reihenfolge
	const shown = $derived(
		!current
			? []
			: editing
				? current.items
				: [...current.items.filter((i) => !i.done), ...current.items.filter((i) => i.done)]
	);
	const doneCount = $derived(current?.items.filter((i) => i.done).length ?? 0);

	function select(id: number) {
		selectedId = id;
		editing = false;
	}

	async function add(e: SubmitEvent) {
		e.preventDefault();
		if (!current || !text.trim()) return;
		const t = text.trim();
		text = '';
		await lists.add(current.id, t);
	}

	async function saveText(itemId: number) {
		const t = drafts[itemId]?.trim();
		const item = current?.items.find((i) => i.id === itemId);
		if (!current || !item || !t || t === item.text) return;
		await lists.edit(current.id, itemId, t);
	}

	function startEdit() {
		drafts = Object.fromEntries(current?.items.map((i) => [i.id, i.text]) ?? []);
		editing = true;
	}
</script>

<div class="page">
	<aside class="overview" aria-label="Listen">
		{#each lists.lists as l, i (l.id)}
			<div class="entry" class:active={current?.id === l.id}>
				<button class="pick" onclick={() => select(l.id)}>
					<span class="icon" aria-hidden="true">{l.icon ?? '📝'}</span>
					<span class="name">{l.title}</span>
					<span class="count">{l.items.filter((x) => !x.done).length}</span>
				</button>
				{#if editing && current?.id === l.id}
					<span class="order">
						<button
							aria-label="Liste nach oben"
							disabled={i === 0}
							onclick={() => lists.moveList(l.id, i - 1)}>↑</button
						>
						<button
							aria-label="Liste nach unten"
							disabled={i === lists.lists.length - 1}
							onclick={() => lists.moveList(l.id, i + 1)}>↓</button
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
				<h1><span aria-hidden="true">{current.icon ?? '📝'}</span> {current.title}</h1>
				<div class="tools">
					{#if editing}
						<button class="btn" onclick={() => (form = current)}>Name & Symbol</button>
						<button class="btn primary" onclick={() => (editing = false)}>Fertig</button>
					{:else}
						<button class="btn" onclick={startEdit}>Bearbeiten</button>
					{/if}
				</div>
			</header>

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
								onblur={() => saveText(item.id)}
								onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
								maxlength="200"
								aria-label="Eintrag bearbeiten"
							/>
							<span class="order">
								<button
									aria-label="Nach oben"
									disabled={i === 0}
									onclick={() => lists.move(current.id, item.id, i - 1)}>↑</button
								>
								<button
									aria-label="Nach unten"
									disabled={i === shown.length - 1}
									onclick={() => lists.move(current.id, item.id, i + 1)}>↓</button
								>
								<button
									class="del"
									aria-label="Löschen"
									onclick={() => lists.remove(current.id, item.id)}>✕</button
								>
							</span>
						{:else}
							<button
								class="item"
								aria-pressed={item.done}
								onclick={() => lists.toggle(current.id, item)}
							>
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
				<button class="btn clear" onclick={() => lists.clearDone(current.id)}>
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
