<script lang="ts">
	import { untrack } from 'svelte';
	import { api, ApiError, type CalEvent } from '../api.ts';
	import { app } from '../app.svelte.ts';
	import { cal } from '../calendar.svelte.ts';
	import { addDays, bounds, fmtDay, fmtRange, isoDate } from '../dates.ts';
	import LoginDialog from './LoginDialog.svelte';

	let {
		event = null,
		date = new Date(),
		personId = null,
		edit = false,
		onclose
	}: {
		event?: CalEvent | null;
		date?: Date;
		personId?: number | null;
		/** Vorhandenen Termin gleich zum Bearbeiten öffnen (langes Drücken) */
		edit?: boolean;
		onclose: () => void;
	} = $props();

	const initial = untrack(() => ({ event, date, personId, edit }));
	const ev = initial.event;
	const pad = (n: number) => String(n).padStart(2, '0');
	const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

	let mode = $state<'view' | 'edit' | 'login' | 'confirm-delete'>(
		!ev ? 'edit' : !initial.edit ? 'view' : app.me ? 'edit' : 'login'
	);
	let afterLogin: 'edit' | 'confirm-delete' = 'edit';
	let busy = $state(false);
	let error = $state('');

	// Formular
	let title = $state(ev?.title ?? '');
	let location = $state(ev?.location ?? '');
	let allDay = $state(ev?.allDay ?? false);
	let sourceId = $state<number | null>(ev?.sourceId ?? null);
	let startDate = $state('');
	let endDate = $state('');
	let startTime = $state('');
	let endTime = $state('');

	if (ev) {
		const { start, end } = bounds(ev);
		startDate = isoDate(start);
		endDate = isoDate(ev.allDay ? addDays(end, -1) : end);
		startTime = ev.allDay ? '15:00' : hm(start);
		endTime = ev.allDay ? '16:00' : hm(end);
	} else {
		const now = new Date();
		const h = Math.min(Math.max(now.getHours() + 1, 8), 22);
		startDate = endDate = isoDate(initial.date);
		startTime = `${pad(h)}:00`;
		endTime = `${pad(h + 1)}:00`;
	}

	const writable = $derived(cal.creatableFor(app.me, app.via));
	$effect(() => {
		// Neuer Termin: Kalender der vorgewählten Person, sonst „Alle“, sonst der erste
		if (sourceId !== null || writable.length === 0) return;
		sourceId =
			writable.find((c) => c.personId === initial.personId)?.id ??
			writable.find((c) => c.personId === null)?.id ??
			writable[0]!.id;
	});

	const canEdit = $derived(ev ? cal.canEdit(ev, app.me) : writable.length > 0);
	const owner = $derived(
		ev?.personId == null ? 'Alle' : (app.persons.find((p) => p.id === ev.personId)?.name ?? '')
	);
	const calName = (id: number) => {
		const c = cal.calendars.find((x) => x.id === id);
		if (!c) return '';
		const who = c.personId === null ? 'Alle' : app.persons.find((p) => p.id === c.personId)?.name;
		return who ? `${who} · ${c.summary}` : c.summary;
	};

	function requireLogin(next: 'edit' | 'confirm-delete') {
		if (app.me) return (mode = next);
		afterLogin = next;
		mode = 'login';
	}

	function message(err: unknown): string {
		if (!(err instanceof ApiError)) return 'Verbindung fehlgeschlagen.';
		if (err.status === 409)
			return 'Der Termin wurde inzwischen in Google geändert. Die aktuelle Version ist geladen.';
		if (err.status === 403 || err.status === 401) return 'Dafür fehlt die Berechtigung.';
		if (err.status === 422) return 'Bei Serien lässt sich „ganztägig“ nicht umstellen.';
		if (err.status === 400) return 'Bitte Beginn und Ende prüfen.';
		return 'Google ist gerade nicht erreichbar. Bitte später erneut versuchen.';
	}

	function times() {
		if (allDay)
			return { allDay: true, startDate, endDate: endDate < startDate ? startDate : endDate };
		const start = new Date(`${startDate}T${startTime}`);
		let end = new Date(`${endDate}T${endTime}`);
		// Ende vor Beginn am selben Tag: auf +1 h setzen statt Fehler
		if (end <= start) end = new Date(start.getTime() + 3_600_000);
		return { allDay: false, start: start.toISOString(), end: end.toISOString() };
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		if (!title.trim() || sourceId === null) return;
		busy = true;
		error = '';
		const payload = { title: title.trim(), location: location.trim() || null, ...times() };
		try {
			if (ev) await api(`/events/${ev.id}`, { method: 'PATCH', json: payload });
			else await api('/events', { method: 'POST', json: { sourceId, ...payload } });
			await cal.reload();
			onclose();
		} catch (err) {
			error = message(err);
			if (err instanceof ApiError && err.status === 409) await cal.reload();
		} finally {
			busy = false;
		}
	}

	async function remove() {
		if (!ev) return;
		busy = true;
		error = '';
		try {
			await api(`/events/${ev.id}`, { method: 'DELETE' });
			await cal.reload();
			onclose();
		} catch (err) {
			error = message(err);
			mode = 'view';
		} finally {
			busy = false;
		}
	}

	function onStartDate() {
		if (endDate < startDate) endDate = startDate;
	}
</script>

{#if mode === 'login'}
	<LoginDialog onclose={() => (mode = 'view')} ondone={() => (mode = afterLogin)} />
{:else}
	<div
		class="backdrop"
		role="presentation"
		onclick={(e) => e.target === e.currentTarget && onclose()}
	>
		<div class="dialog" role="dialog" aria-modal="true" aria-label={ev?.title ?? 'Neuer Termin'}>
			<button class="close" type="button" onclick={onclose} aria-label="Schließen">✕</button>

			{#if mode === 'view' && ev}
				<div class="bar" style="background:{cal.colorOf(ev)}"></div>
				<h2>{ev.title}</h2>
				<p class="when">
					{fmtDay(bounds(ev).start)} · {fmtRange(ev)}
					{#if ev.recurring}<span class="muted"> · Serie</span>{/if}
				</p>
				<p class="muted">{owner}{ev.location ? ` · ${ev.location}` : ''}</p>
				{#if ev.description}<p class="desc">{ev.description}</p>{/if}
				<p class="error" role="alert">{error}</p>
				{#if canEdit || !app.me}
					<div class="actions">
						<button class="btn danger" onclick={() => requireLogin('confirm-delete')}
							>Löschen</button
						>
						<button class="btn primary" onclick={() => requireLogin('edit')}>Bearbeiten</button>
					</div>
				{/if}
			{:else if mode === 'confirm-delete' && ev}
				<h2>Termin löschen?</h2>
				<p>
					„{ev.title}“ wird auch in Google gelöscht.
					{#if ev.recurring}<strong>Das löscht die ganze Serie.</strong>{/if}
				</p>
				<div class="actions">
					<button class="btn" onclick={() => (mode = 'view')}>Abbrechen</button>
					<button class="btn danger" onclick={remove} disabled={busy}>Löschen</button>
				</div>
			{:else if !canEdit && app.me}
				<h2>{ev ? 'Termin bearbeiten' : 'Neuer Termin'}</h2>
				<p>Du kannst {ev ? 'diesen Termin nicht ändern' : 'in keinen Kalender schreiben'}.</p>
				<div class="actions"><button class="btn" onclick={onclose}>OK</button></div>
			{:else}
				<form onsubmit={save}>
					<h2>{ev ? 'Termin bearbeiten' : 'Neuer Termin'}</h2>
					{#if ev?.recurring}
						<p class="hint">Änderungen gelten für die ganze Serie.</p>
					{/if}

					<label for="ev-title">Titel</label>
					<input id="ev-title" type="text" bind:value={title} required maxlength="200" />

					<label for="ev-cal">Kalender</label>
					{#if ev}
						<p id="ev-cal" class="muted">{calName(ev.sourceId)}</p>
					{:else}
						<select id="ev-cal" bind:value={sourceId}>
							{#each writable as c (c.id)}
								<option value={c.id}>{calName(c.id)}</option>
							{/each}
						</select>
					{/if}

					<label class="check">
						<input type="checkbox" bind:checked={allDay} /> ganztägig
					</label>

					<div class="row">
						<div>
							<label for="ev-sd">Beginn</label>
							<input
								id="ev-sd"
								type="date"
								bind:value={startDate}
								onchange={onStartDate}
								required
							/>
						</div>
						{#if !allDay}
							<div>
								<label for="ev-st">&nbsp;</label>
								<input id="ev-st" type="time" bind:value={startTime} required />
							</div>
						{/if}
					</div>
					<div class="row">
						<div>
							<label for="ev-ed">Ende</label>
							<input id="ev-ed" type="date" bind:value={endDate} min={startDate} required />
						</div>
						{#if !allDay}
							<div>
								<label for="ev-et">&nbsp;</label>
								<input id="ev-et" type="time" bind:value={endTime} required />
							</div>
						{/if}
					</div>

					<label for="ev-loc">Ort (optional)</label>
					<input id="ev-loc" type="text" bind:value={location} maxlength="200" />

					<p class="error" role="alert">{error}</p>
					<div class="actions">
						{#if ev}
							<button class="btn danger" type="button" onclick={() => (mode = 'confirm-delete')}>
								Löschen
							</button>
						{/if}
						<button class="btn" type="button" onclick={() => (ev ? (mode = 'view') : onclose())}>
							Abbrechen
						</button>
						<button
							class="btn primary"
							type="submit"
							disabled={busy || !title.trim() || sourceId === null}
						>
							Speichern
						</button>
					</div>
				</form>
			{/if}
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 10;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgb(15 23 42 / 0.6);
		padding: 16px;
	}
	.dialog {
		position: relative;
		width: 520px;
		max-width: 100%;
		max-height: 100%;
		overflow: auto;
		background: var(--surface);
		border-radius: 24px;
		padding: 24px;
	}
	.close {
		position: absolute;
		top: 8px;
		right: 8px;
		width: 48px;
		height: 48px;
		font-size: 22px;
		background: none;
	}
	.bar {
		height: 8px;
		width: 64px;
		border-radius: 4px;
	}
	h2 {
		margin: 12px 48px 8px 0;
	}
	.when {
		font-weight: 600;
		margin: 0 0 4px;
	}
	.desc {
		white-space: pre-wrap;
	}
	.hint {
		background: var(--surface-2);
		border-radius: 12px;
		padding: 8px 12px;
	}
	.row {
		display: flex;
		gap: 12px;
	}
	.row > div {
		flex: 1;
	}
	select,
	input[type='date'],
	input[type='time'] {
		width: 100%;
		min-height: 48px;
		padding: 0 12px;
		font: inherit;
		border: 2px solid var(--border);
		border-radius: 12px;
		background: var(--surface);
	}
	.check {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 48px;
		margin: 8px 0 0;
	}
	.check input {
		width: 24px;
		height: 24px;
	}
	.error {
		color: var(--danger);
		min-height: 24px;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 12px;
	}
	:global(.btn.danger) {
		background: var(--danger);
		color: #fff;
	}
</style>
