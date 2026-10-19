<script lang="ts">
	import { app } from '../app.svelte.ts';
	import { tasks } from '../tasks.svelte.ts';
	import Modal from './Modal.svelte';

	const list = $derived(tasks.dueNotice);
	const names = (ids: number[]) =>
		ids
			.map((id) => app.persons.find((p) => p.id === id)?.name)
			.filter(Boolean)
			.join(', ');
</script>

<!-- Hinweis am Fälligkeitstag einmaliger Aufgaben (einmal pro Gerät und Tag wegklicken) -->
<Modal title="Heute fällig" onclose={() => tasks.dismissDue()}>
	<ul>
		{#each list as t (t.id)}
			<li>
				{#if t.icon}<span class="icon" aria-hidden="true">{t.icon}</span>{/if}
				<span>
					<strong>{t.title}</strong>
					<small class="muted"
						>{names(t.assignees.filter((a) => a.status === 'open').map((a) => a.personId))}</small
					>
				</span>
			</li>
		{/each}
	</ul>
	<button class="btn primary" onclick={() => tasks.dismissDue()}>Verstanden</button>
</Modal>

<style>
	ul {
		display: grid;
		gap: 10px;
		margin: 0 0 20px;
		padding: 0;
		list-style: none;
	}
	li {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 14px;
		border-radius: 14px;
		background: var(--surface-2);
		font-size: 19px;
	}
	li > span:last-child {
		display: grid;
	}
	.icon {
		font-size: 28px;
	}
	small {
		font-size: 15px;
	}
	button {
		width: 100%;
	}
</style>
