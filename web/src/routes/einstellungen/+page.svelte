<script lang="ts">
	import type { Person } from '#lib/api.ts';
	import { app } from '#lib/app.svelte.ts';
	import Avatar from '#lib/components/Avatar.svelte';
	import CalendarSettings from '#lib/components/CalendarSettings.svelte';
	import LoginDialog from '#lib/components/LoginDialog.svelte';
	import PersonForm from '#lib/components/PersonForm.svelte';

	let editing = $state<Person | 'new' | null>(null);
	let loginOpen = $state(false);
</script>

<h1>Einstellungen</h1>

{#if !app.me}
	<div class="card">
		<p>Zum Ändern der Einstellungen bitte anmelden.</p>
		<button class="btn primary" onclick={() => (loginOpen = true)}>Anmelden</button>
	</div>
	{#if loginOpen}
		<LoginDialog onclose={() => (loginOpen = false)} ondone={() => (loginOpen = false)} />
	{/if}
{:else if !app.isParent}
	<CalendarSettings />
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
	<CalendarSettings />
{/if}

<style>
	h1 {
		margin: 0 0 16px;
	}
	h2 {
		margin-top: 0;
	}
	section {
		margin-bottom: 16px;
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
