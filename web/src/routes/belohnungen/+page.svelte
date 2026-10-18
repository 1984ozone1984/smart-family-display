<script lang="ts">
	import { api, ApiError, type LedgerEntry, type Reward } from '#lib/api.ts';
	import { app } from '#lib/app.svelte.ts';
	import Avatar from '#lib/components/Avatar.svelte';
	import Modal from '#lib/components/Modal.svelte';
	import ParentGate from '#lib/components/ParentGate.svelte';
	import RewardForm from '#lib/components/RewardForm.svelte';
	import Stepper from '#lib/components/Stepper.svelte';
	import { tasks } from '#lib/tasks.svelte.ts';

	let notice = $state('');
	let picking = $state<Reward | null>(null);
	let editReward = $state<Reward | 'new' | null>(null);

	// Bonus/Abzug
	let bonusPerson = $state<number | null>(null);
	let bonusAmount = $state(5);
	let bonusSign = $state<1 | -1>(1);
	let bonusReason = $state('');

	// Verlauf
	let historyPerson = $state<number | null>(null);
	let historyEntries = $state<LedgerEntry[]>([]);

	const name = (id: number) => app.persons.find((p) => p.id === id)?.name ?? '?';
	const active = $derived(tasks.rewards.filter((r) => r.active));
	// Am Handy ist klar, wer anfragt; am Tablet wird die Person angetippt
	const self = $derived(app.via === 'public' ? app.me : null);

	const ERRORS: Record<string, string> = {
		insufficient: 'Dafür reichen die Punkte noch nicht.',
		'weekly limit': 'Diese Woche schon so oft eingelöst, wie erlaubt.'
	};

	async function redeem(r: Reward, personId: number) {
		picking = null;
		try {
			await api(`/rewards/${r.id}/redeem`, { method: 'POST', json: { personId } });
			notice = `${name(personId)} möchte „${r.title}“ – jetzt müssen Mama oder Papa freigeben.`;
		} catch (err) {
			notice =
				(err instanceof ApiError && ERRORS[String(err.body.error)]) || 'Das hat nicht geklappt.';
		}
	}

	async function decide(id: number, approve: boolean) {
		try {
			await api(`/redemptions/${id}/decide`, { method: 'POST', json: { approve } });
		} catch (err) {
			notice =
				(err instanceof ApiError && ERRORS[String(err.body.error)]) || 'Das hat nicht geklappt.';
		}
	}

	async function cancel(id: number) {
		await api(`/redemptions/${id}/cancel`, { method: 'POST' }).catch(
			() => (notice = 'Das hat nicht geklappt.')
		);
	}

	async function bonus(e: SubmitEvent) {
		e.preventDefault();
		if (bonusPerson === null || !bonusReason.trim()) return;
		await api('/points', {
			method: 'POST',
			json: { personId: bonusPerson, delta: bonusSign * bonusAmount, reason: bonusReason.trim() }
		});
		notice = `${bonusSign > 0 ? '+' : '−'}${bonusAmount} Punkte für ${name(bonusPerson)} gebucht.`;
		bonusReason = '';
		if (historyPerson === bonusPerson) await loadHistory(bonusPerson);
	}

	async function loadHistory(id: number) {
		historyPerson = id;
		historyEntries = (await api<{ history: LedgerEntry[] }>(`/points/${id}`)).history;
	}

	const fmt = (iso: string) =>
		new Date(iso).toLocaleString('de-DE', {
			day: 'numeric',
			month: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
</script>

<h1>Belohnungen</h1>
{#if notice}<p class="notice" role="status">{notice}</p>{/if}

<div class="balances">
	{#each app.persons as p (p.id)}
		<button class="balance" onclick={() => loadHistory(p.id)} aria-label="Verlauf von {p.name}">
			<Avatar person={p} size={44} />
			<span>{p.name}</span>
			<strong>⭐ {tasks.balances[p.id] ?? 0}</strong>
		</button>
	{/each}
</div>

<div class="catalog">
	{#each active as r (r.id)}
		<div class="card reward">
			<span class="icon">{r.icon ?? '🎁'}</span>
			<strong>{r.title}</strong>
			<span class="cost">⭐ {r.cost}</span>
			{#if r.weeklyLimit}<small class="muted">max. {r.weeklyLimit}× pro Woche</small>{/if}
			<button class="btn primary" onclick={() => (self ? redeem(r, self.id) : (picking = r))}
				>Einlösen</button
			>
		</div>
	{:else}
		<p class="muted">Noch keine Belohnungen angelegt.</p>
	{/each}
</div>

{#if tasks.requests.length}
	<section class="card block">
		<h2>Offene Wünsche</h2>
		<ul class="rows">
			{#each tasks.requests as d (d.id)}
				<li>
					<span>{d.icon ?? '🎁'} <strong>{d.title}</strong> · {name(d.personId)} · ⭐ {d.cost}</span
					>
					<span class="actions">
						{#if app.via === 'lan' || app.me?.id === d.personId}
							<button class="btn" onclick={() => cancel(d.id)}>Zurückziehen</button>
						{/if}
						{#if app.isParent}
							<button class="btn" onclick={() => decide(d.id, false)}>Ablehnen</button>
							<button class="btn primary" onclick={() => decide(d.id, true)}>Freigeben</button>
						{/if}
					</span>
				</li>
			{/each}
		</ul>
		{#if !app.isParent}<ParentGate label="Zum Freigeben als Elternteil anmelden" />{/if}
	</section>
{/if}

{#if historyPerson !== null}
	<section class="card block">
		<h2>Verlauf {name(historyPerson)}</h2>
		<ul class="rows">
			{#each historyEntries as h (h.id)}
				<li>
					<span>{h.reason} <small class="muted">{fmt(h.createdAt)}</small></span>
					<strong class:minus={h.delta < 0}>{h.delta > 0 ? '+' : ''}{h.delta}</strong>
				</li>
			{:else}
				<li class="muted">Noch keine Buchungen.</li>
			{/each}
		</ul>
	</section>
{/if}

<section class="card block">
	<h2>Verwalten</h2>
	<ParentGate>
		<h3>Belohnungen</h3>
		<ul class="rows">
			{#each tasks.rewards as r (r.id)}
				<li class:inactive={!r.active}>
					<span
						>{r.icon ?? '🎁'} <strong>{r.title}</strong> · ⭐ {r.cost}{r.active
							? ''
							: ' · inaktiv'}</span
					>
					<button class="btn" onclick={() => (editReward = r)}>Bearbeiten</button>
				</li>
			{/each}
		</ul>
		<button class="btn primary" onclick={() => (editReward = 'new')}>+ Belohnung</button>

		<h3>Bonus oder Abzug</h3>
		<form class="bonus" onsubmit={bonus}>
			<select bind:value={bonusPerson} aria-label="Person" required>
				<option value={null} disabled>Person …</option>
				{#each app.persons as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
			</select>
			<div class="sign" role="group" aria-label="Bonus oder Abzug">
				<button type="button" class:active={bonusSign === 1} onclick={() => (bonusSign = 1)}
					>+ Bonus</button
				>
				<button type="button" class:active={bonusSign === -1} onclick={() => (bonusSign = -1)}
					>− Abzug</button
				>
			</div>
			<Stepper bind:value={bonusAmount} min={1} max={1000} label="Punkte" />
			<input type="text" bind:value={bonusReason} placeholder="Grund" maxlength="200" required />
			<button
				class="btn primary"
				type="submit"
				disabled={bonusPerson === null || !bonusReason.trim()}>Buchen</button
			>
		</form>
	</ParentGate>
</section>

{#if picking}
	{@const r = picking}
	<Modal title="Wer möchte „{r.title}“?" onclose={() => (picking = null)}>
		<div class="pick">
			{#each app.persons as p (p.id)}
				<button onclick={() => redeem(r, p.id)} disabled={(tasks.balances[p.id] ?? 0) < r.cost}>
					<Avatar person={p} size={72} />
					<span>{p.name}</span>
					<small>⭐ {tasks.balances[p.id] ?? 0}</small>
				</button>
			{/each}
		</div>
	</Modal>
{/if}

{#if editReward}
	<RewardForm
		reward={editReward === 'new' ? null : editReward}
		onclose={() => (editReward = null)}
	/>
{/if}

<style>
	h1 {
		margin: 0 0 12px;
	}
	.notice {
		background: #fef3c7;
		border-radius: 12px;
		padding: 8px 12px;
	}
	.balances {
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
		margin-bottom: 16px;
	}
	.balance {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 56px;
		padding: 6px 16px 6px 6px;
		border-radius: 999px;
		background: var(--surface);
		font-weight: 600;
	}
	.catalog {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 12px;
	}
	.reward {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		text-align: center;
	}
	.reward .icon {
		font-size: 48px;
	}
	.cost {
		font-size: 20px;
		font-weight: 700;
	}
	.block {
		margin-top: 16px;
	}
	.block h2 {
		margin-top: 0;
	}
	h3 {
		font-size: 16px;
		color: var(--text-muted);
		margin: 12px 0 6px;
	}
	.rows {
		list-style: none;
		padding: 0;
		margin: 0 0 12px;
	}
	.rows li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 0;
		border-bottom: 1px solid var(--surface-2);
	}
	.rows .inactive {
		opacity: 0.6;
	}
	.minus {
		color: var(--danger);
	}
	.actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.bonus {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 12px;
	}
	.bonus select {
		min-height: 48px;
		padding: 0 12px;
		font: inherit;
		border: 2px solid var(--border);
		border-radius: 12px;
		background: var(--surface);
	}
	.bonus input {
		flex: 1;
		min-width: 160px;
	}
	.sign {
		display: inline-flex;
		background: var(--surface-2);
		border-radius: 12px;
		padding: 4px;
	}
	.sign button {
		min-height: 44px;
		padding: 0 14px;
		border-radius: 10px;
		background: none;
		font-weight: 600;
	}
	.sign .active {
		background: var(--surface);
	}
	.pick {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 12px;
	}
	.pick button {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 12px;
		min-width: 120px;
		border-radius: 16px;
		background: none;
		font-weight: 600;
	}
</style>
