<script lang="ts">
	import { ExternalLink, X } from 'lucide-svelte';
	import type { LapseAfkStatus } from '$lib/review/lapseAfk.js';

	interface Props {
		timelapse: {
			name: string;
			playbackUrl: string;
			thumbnailUrl: string | null;
			duration: number;
		};
		lapseUrl: string;
		/** Background analysis status; undefined until the first poll returns. */
		status?: LapseAfkStatus;
		onclose?: () => void;
	}

	let { timelapse, lapseUrl, status, onclose }: Props = $props();

	let video: HTMLVideoElement | undefined = $state();
	let currentTime = $state(0);
	let videoDuration = $state(0);

	const analysis = $derived(status?.state === 'complete' ? status.analysis : null);
	const progress = $derived(status?.state === 'pending' ? status.progress : 0);

	// Interval times are in recording (real-world) seconds; the video is sped up.
	const recordingDuration = $derived(timelapse.duration);
	const playheadFraction = $derived(videoDuration > 0 ? Math.min(1, currentTime / videoDuration) : 0);

	function seekToRecordingSeconds(seconds: number) {
		if (!video || !(videoDuration > 0) || !(recordingDuration > 0)) return;
		video.currentTime = (seconds / recordingDuration) * videoDuration;
		void video.play();
	}

	function seekFromStrip(e: MouseEvent) {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
		seekToRecordingSeconds(fraction * recordingDuration);
	}

	function fmtDuration(seconds: number): string {
		const s = Math.max(0, Math.round(seconds));
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
		if (m > 0) return s % 60 > 0 ? `${m}m ${s % 60}s` : `${m}m`;
		return `${s}s`;
	}

	function fmtClock(seconds: number): string {
		const s = Math.max(0, Math.round(seconds));
		const h = Math.floor(s / 3600);
		const mm = String(Math.floor((s % 3600) / 60)).padStart(h > 0 ? 2 : 1, '0');
		const ss = String(s % 60).padStart(2, '0');
		return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
	}

	function pct(seconds: number): string {
		return `${(seconds / recordingDuration) * 100}%`;
	}
</script>

<div class="border border-border-card rounded-section overflow-hidden">
	<!-- svelte-ignore a11y_media_has_caption -->
	<video
		bind:this={video}
		bind:currentTime
		bind:duration={videoDuration}
		src={timelapse.playbackUrl}
		poster={timelapse.thumbnailUrl ?? undefined}
		controls
		playsinline
		preload="metadata"
		class="w-full aspect-video bg-black block"
	></video>

	<div class="px-3 py-2.5 flex flex-col gap-2">
		<div class="flex items-center justify-between gap-2">
			<p class="font-semibold text-sm text-text-primary truncate">{timelapse.name}</p>
			<div class="flex items-center gap-2 shrink-0">
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				<a
					href={lapseUrl}
					target="_blank"
					rel="noopener noreferrer"
					class="flex items-center gap-1 text-xs text-link hover:underline"
				>
					Open in Lapse <ExternalLink size={11} />
				</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{#if onclose}
					<button
						type="button"
						onclick={onclose}
						class="p-0.5 rounded text-text-tertiary hover:text-text-primary hover:bg-surface transition-colors cursor-pointer"
						aria-label="Close player"
					>
						<X size={14} />
					</button>
				{/if}
			</div>
		</div>

		<div class="flex items-center justify-between gap-2 text-xs">
			<span class="font-medium text-text-secondary">Inactivity</span>
			{#if !status}
				<span class="text-text-tertiary">Loading…</span>
			{:else if status.state === 'pending'}
				<span class="text-text-tertiary tabular-nums">
					{progress > 0 ? `Analyzing frames · ${Math.round(progress * 100)}%` : 'Queued for analysis'}
				</span>
			{:else if status.state === 'failed'}
				<span class="text-check-fail">Couldn't analyze</span>
			{:else if status.state === 'unavailable'}
				<span class="text-text-tertiary">Not analyzed</span>
			{:else if analysis && analysis.intervals.length > 0}
				<span class="font-medium text-check-fail tabular-nums">
					{fmtDuration(analysis.totalAfkSeconds)} inactive · {analysis.intervals.length}
					{analysis.intervals.length === 1 ? 'span' : 'spans'}
				</span>
			{:else}
				<span class="text-text-tertiary">None found</span>
			{/if}
		</div>

		<!-- Mouse users click anywhere to seek; keyboard users use the span list below. -->
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="relative h-3 rounded-full bg-surface overflow-hidden cursor-pointer" onclick={seekFromStrip}>
			{#if status?.state === 'pending'}
				<div
					class="absolute inset-y-0 left-0 bg-border-card transition-[width] duration-200"
					style="width: {progress * 100}%"
				></div>
			{/if}
			{#each analysis?.intervals ?? [] as interval (interval.startSeconds)}
				<div
					class="absolute inset-y-0 bg-check-fail/80 hover:bg-check-fail min-w-[2px]"
					style="left: {pct(interval.startSeconds)}; width: {pct(interval.durationSeconds)}"
					title="{fmtDuration(interval.durationSeconds)} without visible change, from {fmtClock(interval.startSeconds)}"
				></div>
			{/each}
			<div
				class="absolute inset-y-0 w-0.5 -ml-px bg-text-primary pointer-events-none"
				style="left: {playheadFraction * 100}%"
			></div>
		</div>
		<div class="flex justify-between text-[10px] text-text-faint tabular-nums -mt-1">
			<span>0:00</span>
			<span>{fmtClock(recordingDuration)} recorded</span>
		</div>

		{#if analysis && analysis.intervals.length > 0}
			<div class="flex flex-wrap gap-1.5">
				{#each analysis.intervals as interval (interval.startSeconds)}
					<button
						type="button"
						onclick={() => seekToRecordingSeconds(interval.startSeconds)}
						class="text-[11px] tabular-nums px-2 py-0.5 rounded-tag border border-check-fail/30 text-check-fail hover:bg-check-fail/5 cursor-pointer transition-colors"
						title="Jump to this span"
					>
						{fmtClock(interval.startSeconds)}–{fmtClock(interval.endSeconds)}
						<span class="text-check-fail/70">· {fmtDuration(interval.durationSeconds)}</span>
					</button>
				{/each}
			</div>
			<p class="text-[11px] text-text-tertiary">
				Red spans show no visible change on screen for over a minute of recording. Click one to jump there.
			</p>
		{:else if status?.state === 'failed'}
			<p class="text-[11px] text-text-tertiary break-words">{status.error}</p>
		{:else if status?.state === 'complete'}
			<p class="text-[11px] text-text-tertiary">No span of over a minute without visible change on screen.</p>
		{/if}
	</div>
</div>
