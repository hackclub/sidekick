<script lang="ts">
	import { ScanSearch } from 'lucide-svelte';
</script>

<!-- Only seen on desktop, beside the list; on mobile the list fills the screen instead. -->
<div class="h-full flex items-center justify-center px-8">
	<div class="max-w-[440px] flex flex-col items-center gap-3 text-center">
		<ScanSearch size={28} class="text-text-tertiary" />
		<p class="font-semibold text-[15px] tracking-[-0.4px]">
			Pick a project to check its heartbeats
		</p>
	</div>
</div>
