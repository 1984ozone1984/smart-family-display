<script lang="ts">
	import type { Snippet } from 'svelte';
	import { app } from '../app.svelte.ts';
	import LoginDialog from './LoginDialog.svelte';

	/** Zeigt den Inhalt nur Eltern; sonst einen Knopf für die Eltern-Anmeldung (Eltern-PIN). */
	let { children, label = 'Als Elternteil anmelden' }: { children?: Snippet; label?: string } =
		$props();
	let open = $state(false);
</script>

{#if app.isParent}
	{@render children?.()}
{:else}
	<button class="btn" onclick={() => (open = true)}>🔒 {label}</button>
	{#if open}
		<LoginDialog
			parentsOnly
			title="Elternteil wählen"
			onclose={() => (open = false)}
			ondone={() => (open = false)}
		/>
	{/if}
{/if}
