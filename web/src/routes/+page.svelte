<script lang="ts">
	import { app } from '#lib/app.svelte.ts';
	import Avatar from '#lib/components/Avatar.svelte';
</script>

<div class="columns" style="--n:{Math.max(app.persons.length, 1)}">
	{#each app.persons as p (p.id)}
		<section class="column" style="--c:{p.color}">
			<header>
				<Avatar person={p} size={56} />
				<h2>{p.name}</h2>
			</header>
			<p class="muted">Termine und Aufgaben folgen.</p>
		</section>
	{:else}
		<p class="muted">Noch keine Personen angelegt.</p>
	{/each}
</div>

<style>
	.columns {
		display: grid;
		grid-template-columns: repeat(var(--n), minmax(0, 1fr));
		gap: 12px;
		min-height: calc(100vh - 100px);
	}
	.column {
		background: var(--surface);
		border-radius: var(--radius);
		border-top: 8px solid var(--c);
		padding: 12px;
	}
	.column header {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	h2 {
		margin: 0;
		font-size: 22px;
	}
	@media (max-width: 640px) {
		.columns {
			grid-template-columns: 1fr;
			min-height: 0;
		}
	}
</style>
