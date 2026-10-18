<script lang="ts">
	import '../app.css';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount, type Snippet } from 'svelte';
	import { app } from '#lib/app.svelte.ts';
	import { cal } from '#lib/calendar.svelte.ts';
	import { lists } from '#lib/lists.svelte.ts';
	import { tasks } from '#lib/tasks.svelte.ts';
	import Avatar from '#lib/components/Avatar.svelte';
	import LoginDialog from '#lib/components/LoginDialog.svelte';

	let { children }: { children: Snippet } = $props();

	let failed = $state(false);
	let loginOpen = $state(false);
	let now = $state(new Date());

	onMount(() => {
		app.init().catch(() => (failed = true));
		const t = setInterval(() => (now = new Date()), 15_000);
		return () => clearInterval(t);
	});

	$effect(() => {
		if (app.ready && app.setupNeeded && page.url.pathname !== '/setup')
			void goto(resolve('/setup'));
	});

	$effect(() => {
		if (app.ready && !app.needsLogin && !app.setupNeeded) {
			cal.start();
			tasks.start();
			lists.start();
		}
	});

	const NAV = [
		{ path: '/', label: 'Heute' },
		{ path: '/woche', label: 'Woche' },
		{ path: '/agenda', label: 'Agenda' },
		{ path: '/aufgaben', label: 'Aufgaben' },
		{ path: '/belohnungen', label: 'Belohnungen' },
		{ path: '/listen', label: 'Listen' },
		{ path: '/einstellungen', label: '⚙︎', title: 'Einstellungen' }
	] as const;
	const time = $derived(now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }));
	const date = $derived(
		now.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' })
	);
</script>

{#if failed}
	<main class="center">
		<p>Server nicht erreichbar.</p>
		<button class="btn primary" onclick={() => location.reload()}>Neu laden</button>
	</main>
{:else if !app.ready}
	<main class="center muted">Lädt …</main>
{:else if app.needsLogin}
	<main class="center"><LoginDialog title="Anmelden" /></main>
{:else}
	<header>
		<div class="clock">
			<strong>{time}</strong>
			<span class="muted">{date}</span>
		</div>
		{#if !app.setupNeeded}
			<nav>
				{#each NAV as n (n.path)}
					<a
						href={resolve(n.path)}
						class:active={page.url.pathname === n.path}
						title={'title' in n ? n.title : undefined}
						aria-label={'title' in n ? n.title : undefined}>{n.label}</a
					>
				{/each}
			</nav>
		{/if}
		<div class="session">
			<span class="live {app.live}" title="Synchronisation: {app.live}"></span>
			{#if app.me}
				<!-- Antippen: schnell zu einer anderen Person wechseln (oder abmelden) -->
				<button class="me" onclick={() => (loginOpen = true)} aria-label="Person wechseln">
					<Avatar person={app.me} size={40} />
					<span class="name">{app.me.name}</span>
				</button>
			{:else if !app.setupNeeded}
				<button class="btn" onclick={() => (loginOpen = true)}>Anmelden</button>
			{/if}
		</div>
	</header>
	<main>{@render children()}</main>
	{#if loginOpen}
		<LoginDialog
			title={app.me ? 'Person wechseln' : 'Wer bist du?'}
			onclose={() => (loginOpen = false)}
			ondone={() => (loginOpen = false)}
			onlogout={app.me
				? () => {
						loginOpen = false;
						void app.logout();
					}
				: undefined}
		/>
	{/if}
	{#if tasks.pendingLogin}
		<LoginDialog
			personId={tasks.pendingLogin.personId}
			title="Wer hakt ab?"
			onclose={() => (tasks.pendingLogin = null)}
			ondone={() => tasks.resumeAfterLogin()}
		/>
	{/if}
	{#if tasks.notice || lists.notice}
		<p class="toast" role="status">{tasks.notice || lists.notice}</p>
	{/if}
{/if}

<style>
	header {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 8px 16px;
		background: var(--surface);
		border-bottom: 1px solid var(--border);
	}
	.clock {
		display: flex;
		align-items: baseline;
		gap: 10px;
		white-space: nowrap;
	}
	.clock strong {
		font-size: 28px;
	}
	nav {
		display: flex;
		gap: 4px;
		margin: 0 auto;
	}
	nav a {
		display: flex;
		align-items: center;
		min-height: 48px;
		padding: 0 12px;
		border-radius: 12px;
		color: inherit;
		text-decoration: none;
		font-weight: 600;
	}
	nav a.active {
		background: var(--surface-2);
	}
	.me {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 48px;
		padding: 4px 14px 4px 4px;
		border-radius: 999px;
		background: var(--surface-2);
		font-weight: 600;
	}
	.session {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-left: auto;
	}
	.live {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--danger);
	}
	.live.sse {
		background: var(--ok);
	}
	.live.polling {
		background: #d97706;
	}
	main {
		padding: 16px;
	}
	.toast {
		position: fixed;
		left: 50%;
		bottom: 24px;
		transform: translateX(-50%);
		z-index: 20;
		max-width: calc(100% - 32px);
		margin: 0;
		padding: 12px 20px;
		border-radius: 14px;
		background: var(--text);
		color: var(--surface);
		font-weight: 600;
	}
	.center {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 16px;
	}
	@media (max-width: 640px) {
		header {
			flex-wrap: wrap;
		}
		.clock span,
		.name {
			display: none;
		}
		nav {
			order: 3;
			width: 100%;
			margin: 0;
		}
	}
</style>
