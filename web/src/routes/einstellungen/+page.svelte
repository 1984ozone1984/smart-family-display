<script lang="ts">
	import type { Person } from '#lib/api.ts';
	import { app } from '#lib/app.svelte.ts';
	import Avatar from '#lib/components/Avatar.svelte';
	import LoginDialog from '#lib/components/LoginDialog.svelte';
	import PersonForm from '#lib/components/PersonForm.svelte';

	let editing = $state<Person | 'new' | null>(null);
	let loginOpen = $state(false);
</script>

<h1>Einstellungen</h1>

{#if !app.isParent}
	<div class="card">
		<p>Einstellungen sind nur für Eltern.</p>
		<button class="btn primary" onclick={() => (loginOpen = true)}>Als Elternteil anmelden</button>
	</div>
	{#if loginOpen}
		<LoginDialog
			parentsOnly
			title="Elternteil wählen"
			onclose={() => (loginOpen = false)}
			ondone={() => (loginOpen = false)}
		/>
	{/if}
{:else if editing}
	{#key editing}
		<PersonForm person={editing === 'new' ? null : editing} onclose={() => (editing = null)} />
	{/key}
{:else}
	<section class="card">
		<h2>Personen</h2>
		<ul>
			{#each app.persons as p (p.id)}
				<li>
					<Avatar person={p} size={48} />
					<span class="name">{p.name}</span>
					<span class="muted">{p.role === 'parent' ? 'Elternteil' : 'Kind'}</span>
					<button class="btn" onclick={() => (editing = p)}>Bearbeiten</button>
				</li>
			{/each}
		</ul>
		<button class="btn primary" onclick={() => (editing = 'new')}>Person hinzufügen</button>
	</section>
{/if}

<style>
	h1 {
		margin: 0 0 16px;
	}
	h2 {
		margin-top: 0;
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 0 0 16px;
	}
	li {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 0;
		border-bottom: 1px solid var(--surface-2);
	}
	.name {
		font-weight: 600;
		flex: 1;
	}
</style>
