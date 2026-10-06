<script lang="ts">
	import { fade } from 'svelte/transition';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import type { PresenceViewer } from '$lib/types.js';

	interface Props {
		programId: string;
		projectId: string;
		currentUserId: string | null;
	}

	let { programId, projectId, currentUserId }: Props = $props();

	// Must stay well under the server's PRESENCE_TTL_MS (30s) so one slow or
	// dropped request doesn't make an active viewer flicker out.
	const HEARTBEAT_MS = 10_000;
	// A tab nobody has touched in this long stops counting as "looking".
	const IDLE_MS = 5 * 60_000;
	const MAX_SHOWN = 4;

	let viewers = $state<PresenceViewer[]>([]);
	const others = $derived(viewers.filter((v) => v.id !== currentUserId));
	const shown = $derived(others.slice(0, MAX_SHOWN));
	const overflow = $derived(others.slice(MAX_SHOWN));

	$effect(() => {
		const url = `/api/programs/${programId}/projects/${encodeURIComponent(projectId)}/presence`;
		const tabId = crypto.randomUUID();
		const body = JSON.stringify({ tabId });
		const headers = { 'Content-Type': 'application/json' };
		let lastActivity = Date.now();
		let stopped = false;
		viewers = [];

		// Hidden or idle tabs just stop beating and age out server-side, so a
		// quick tab switch (e.g. to the project's repo) doesn't drop the viewer.
		async function beat() {
			if (stopped || document.visibilityState !== 'visible') return;
			if (Date.now() - lastActivity > IDLE_MS) return;
			try {
				const res = await fetch(url, { method: 'POST', headers, body });
				if (!res.ok || stopped) return;
				viewers = (await res.json()).viewers;
			} catch {
				// Offline or server restarting — the next beat retries.
			}
		}

		// `keepalive` lets the request outlive the page on tab close / reload.
		function sendLeave() {
			fetch(url, { method: 'DELETE', headers, body, keepalive: true }).catch(() => {});
		}

		function onActivity() {
			const wasIdle = Date.now() - lastActivity > IDLE_MS;
			lastActivity = Date.now();
			if (wasIdle) beat();
		}

		function onVisibilityChange() {
			if (document.visibilityState === 'visible') {
				lastActivity = Date.now();
				beat();
			}
		}

		function onPageHide() {
			sendLeave();
		}

		// Restored from the back/forward cache — rejoin.
		function onPageShow(e: PageTransitionEvent) {
			if (e.persisted) beat();
		}

		const activityEvents = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll'] as const;
		for (const ev of activityEvents) {
			window.addEventListener(ev, onActivity, { capture: true, passive: true });
		}
		document.addEventListener('visibilitychange', onVisibilityChange);
		window.addEventListener('pagehide', onPageHide);
		window.addEventListener('pageshow', onPageShow);

		beat();
		const interval = setInterval(beat, HEARTBEAT_MS);

		// Runs on in-app navigation away from this project (or to another one).
		return () => {
			stopped = true;
			clearInterval(interval);
			for (const ev of activityEvents) {
				window.removeEventListener(ev, onActivity, { capture: true });
			}
			document.removeEventListener('visibilitychange', onVisibilityChange);
			window.removeEventListener('pagehide', onPageHide);
			window.removeEventListener('pageshow', onPageShow);
			sendLeave();
		};
	});
</script>

{#if others.length > 0}
	<div
		class="flex items-center"
		role="group"
		aria-label="Also viewing: {others.map((v) => v.name).join(', ')}"
	>
		{#each shown as viewer (viewer.id)}
			<span
				class="-ml-1.5 first:ml-0 rounded-full ring-2 ring-page"
				title="{viewer.name} is viewing"
				transition:fade={{ duration: 150 }}
			>
				<Avatar name={viewer.name} url={viewer.avatarUrl} size="md" />
			</span>
		{/each}
		{#if overflow.length > 0}
			<span
				class="-ml-1.5 size-7 rounded-full ring-2 ring-page bg-surface flex items-center justify-center text-[10px] font-bold text-text-secondary"
				title={overflow.map((v) => v.name).join(', ')}
			>
				+{overflow.length}
			</span>
		{/if}
	</div>
{/if}
