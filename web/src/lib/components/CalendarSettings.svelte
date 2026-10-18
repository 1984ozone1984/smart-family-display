<script lang="ts">
	import { onMount } from 'svelte';
	import { api, ApiError, type Calendar, type GoogleAccount } from '../api.ts';
	import { app } from '../app.svelte.ts';
	import { cal } from '../calendar.svelte.ts';

	let accounts = $state<GoogleAccount[]>([]);
	let busy = $state(false);
	let notice = $state('');

	const NOTICES: Record<string, string> = {
		ok: 'Google-Konto verbunden. Die Kalender werden jetzt abgeglichen.',
		denied: 'Verbindung abgebrochen – bei Google wurde nicht zugestimmt.',
		error: 'Verbindung fehlgeschlagen. Bitte erneut versuchen.'
	};

	async function loadAccounts() {
		accounts = (await api<{ accounts: GoogleAccount[] }>('/google/accounts')).accounts;
	}

	onMount(() => {
		const result = new URL(location.href).searchParams.get('google');
		if (result) {
			notice = NOTICES[result] ?? '';
			history.replaceState(null, '', location.pathname);
		}
		void loadAccounts();
		void cal.loadCalendars();
		return app.on('calendars.changed', () => void loadAccounts());
	});

	const mine = $derived(accounts.filter((a) => a.personId === app.me?.id));
	const personName = (id: number | null) =>
		id === null ? 'Alle' : (app.persons.find((p) => p.id === id)?.name ?? '?');

	async function run(fn: () => Promise<unknown>) {
		busy = true;
		notice = '';
		try {
			await fn();
		} catch (err) {
			notice =
				err instanceof ApiError && err.status === 403
					? 'Nur für Eltern.'
					: 'Das hat nicht geklappt.';
		} finally {
			busy = false;
		}
	}

	const patch = (c: Calendar, body: { enabled?: boolean; personId?: number | null }) =>
		run(() =>
			api(`/calendars/${c.id}`, { method: 'PATCH', json: body }).then(() => cal.loadCalendars())
		);

	const disconnect = (a: GoogleAccount) =>
		run(async () => {
			if (
				!confirm(
					`Verbindung zu ${a.email} trennen? Die Termine dieses Kontos verschwinden aus der App (in Google bleiben sie).`
				)
			)
				return;
			await api(`/google/accounts/${a.id}`, { method: 'DELETE' });
			await Promise.all([loadAccounts(), cal.loadCalendars()]);
		});
</script>

<section class="card">
	<h2>Kalender</h2>
	{#if notice}<p class="notice" role="status">{notice}</p>{/if}

	{#if !cal.googleConfigured}
		<p class="muted">Google ist auf dem Server noch nicht eingerichtet (GOOGLE_CLIENT_ID fehlt).</p>
	{:else}
		<h3>Mein Google-Konto</h3>
		{#each mine as a (a.id)}
			<div class="account">
				<span>{a.email}</span>
				{#if a.status === 'revoked'}<span class="bad">Zugriff widerrufen – neu verbinden</span>{/if}
				<button class="btn" onclick={() => disconnect(a)} disabled={busy}>Trennen</button>
			</div>
		{/each}
		{#if cal.connectHere}
			<!-- Ganze Seite wechselt zu Google und kommt zurück -->
			<button class="btn primary" onclick={() => location.assign('/api/v1/google/connect')}>
				{mine.length ? 'Weiteres Konto verbinden' : 'Google-Konto verbinden'}
			</button>
		{:else}
			<p class="muted">
				Google verbinden geht nur über die Internet-Adresse (am Handy oder PC), nicht am Tablet.
			</p>
		{/if}

		{#if app.isParent}
			<h3>Alle Konten</h3>
			{#each accounts as a (a.id)}
				<div class="account">
					<span>{a.email}</span>
					<span class="muted">{personName(a.personId)}</span>
					{#if a.status === 'revoked'}<span class="bad">widerrufen</span>{/if}
					{#if a.personId !== app.me?.id}
						<button class="btn" onclick={() => disconnect(a)} disabled={busy}>Trennen</button>
					{/if}
				</div>
			{:else}
				<p class="muted">Noch kein Konto verbunden.</p>
			{/each}

			<h3>Kalender zuordnen</h3>
			<p class="muted">
				Jeden Kalender einer Person zuordnen oder „Alle“ (Familienkalender). Nur eingeschaltete
				Kalender erscheinen in der App.
			</p>
			<ul class="cals">
				{#each cal.calendars as c (c.id)}
					<li>
						<span class="dot" style="background:{c.color ?? '#94a3b8'}"></span>
						<span class="name">
							{c.summary}
							<small class="muted">{c.account}{c.writable ? '' : ' · nur lesen'}</small>
							{#if c.lastError}<small class="bad">Fehler: {c.lastError}</small>{/if}
						</span>
						<select
							value={c.personId === null ? '' : String(c.personId)}
							onchange={(e) => {
								const v = e.currentTarget.value;
								void patch(c, { personId: v === '' ? null : Number(v) });
							}}
							disabled={busy}
							aria-label="Zuordnung {c.summary}"
						>
							<option value="">Alle</option>
							{#each app.persons as p (p.id)}
								<option value={String(p.id)}>{p.name}</option>
							{/each}
						</select>
						<label class="toggle">
							<input
								type="checkbox"
								checked={c.enabled}
								onchange={(e) => patch(c, { enabled: e.currentTarget.checked })}
								disabled={busy}
							/>
							anzeigen
						</label>
					</li>
				{:else}
					<li class="muted">Noch keine Kalender – zuerst ein Google-Konto verbinden.</li>
				{/each}
			</ul>
			<div class="actions">
				<button
					class="btn"
					disabled={busy}
					onclick={() =>
						run(() =>
							api('/calendars/discover', { method: 'POST' }).then(() => cal.loadCalendars())
						)}
				>
					Kalenderliste neu laden
				</button>
				<button
					class="btn"
					disabled={busy}
					onclick={() => run(() => cal.syncNow().then(() => cal.loadCalendars()))}
				>
					Jetzt abgleichen
				</button>
			</div>
		{/if}
	{/if}
</section>

<style>
	h2 {
		margin-top: 0;
	}
	h3 {
		font-size: 18px;
		margin: 20px 0 8px;
	}
	.notice {
		background: var(--surface-2);
		border-radius: 12px;
		padding: 8px 12px;
	}
	.account {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 6px 0;
	}
	.bad {
		color: var(--danger);
	}
	.cals {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.cals li {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 0;
		border-bottom: 1px solid var(--surface-2);
	}
	.dot {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.name {
		flex: 1;
		display: flex;
		flex-direction: column;
	}
	select {
		min-height: 48px;
		padding: 0 8px;
		font: inherit;
		border: 2px solid var(--border);
		border-radius: 12px;
		background: var(--surface);
	}
	.toggle {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0;
		font-weight: 400;
	}
	.toggle input {
		width: 24px;
		height: 24px;
	}
	.actions {
		display: flex;
		gap: 12px;
		margin-top: 12px;
		flex-wrap: wrap;
	}
</style>
