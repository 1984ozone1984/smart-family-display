<script lang="ts">
	import type { Person } from '../api.ts';

	let {
		person,
		size = 56
	}: { person: Pick<Person, 'name' | 'color' | 'avatarUrl'>; size?: number } = $props();
</script>

<span
	class="avatar"
	style="width:{size}px;height:{size}px;background:{person.color};font-size:{size * 0.42}px"
>
	{#if person.avatarUrl}
		<img src={person.avatarUrl} alt="" />
	{:else}
		{person.name.slice(0, 1).toUpperCase()}
	{/if}
</span>

<style>
	.avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		border-radius: 50%;
		overflow: hidden;
		color: #fff;
		font-weight: 700;
		box-shadow: 0 0 0 3px var(--surface);
	}
	img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
</style>
