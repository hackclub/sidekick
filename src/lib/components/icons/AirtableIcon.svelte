<script lang="ts">
	interface Props {
		size?: number;
		class?: string;
	}

	let { size = 16, class: className = '' }: Props = $props();
</script>

<svg width={size} height={size} viewBox="0 0 200 170" fill="none" class={className}>
	<path d="M90.04 2.97L17.35 34.81a7.98 7.98 0 00-.2 14.55l73.63 33.03a24.06 24.06 0 0019.62-.1l70.47-33a7.98 7.98 0 00-.15-14.49L109.35 2.9a24.06 24.06 0 00-19.31.07z" fill="#FCB400"/>
	<path d="M104.5 95.13V166c0 4.56 4.86 7.5 8.9 5.4l78.42-43.22a3.98 3.98 0 002.08-3.52V53.73c0-4.68-5.1-7.6-9.1-5.22L105.96 90.9a8.06 8.06 0 00-1.46 4.23z" fill="#18BFFF"/>
	<path d="M88.64 90.74L67.2 79.57l-53.7 34.8A5.52 5.52 0 006 119.24v49.75a5.2 5.2 0 007.88 4.47L88.6 99.45c2.18-1.32 2.24-4.52.04-5.71V90.74z" fill="#F82B60"/>
</svg>
