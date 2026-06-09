<script lang="ts">
	import type { PageData } from './$types.js';
	import { afterNavigate, goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import OrderTableRow from '$lib/components/fulfillment/OrderTableRow.svelte';
	import OrderDetailPane from '$lib/components/fulfillment/OrderDetailPane.svelte';
	import { UserSearch, Funnel, ChevronDown, ChevronUp, ChevronRight, ChevronLeft, RefreshCw } from 'lucide-svelte';
	import type { Order, ShopItem } from '$lib/server/protocol/types.js';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();
	let selectedOrder = $state<Order | null>(null);
	let searchInput = $state(data.searchUser);

	const selectedItem = $derived<ShopItem | null>(
		selectedOrder ? (data.items[selectedOrder.itemId] ?? null) : null
	);

	let dividerX = $state(60);
	let draggingDivider = $state(false);

	function startDividerDrag(e: MouseEvent) {
		draggingDivider = true;
		const startX = e.clientX;
		const startPercent = dividerX;

		function onMove(ev: MouseEvent) {
			const delta = ev.clientX - startX;
			dividerX = Math.max(30, Math.min(80, startPercent + (delta / window.innerWidth) * 100));
		}
		function onUp() {
			draggingDivider = false;
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
		}
		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
	}

	type SortKey = 'id' | 'user' | 'item' | 'qty' | 'date' | 'status';
	interface ColDef { key: SortKey; label: string; minWidth: number; defaultWidth: number }

	const columns: ColDef[] = [
		{ key: 'id', label: 'ID', minWidth: 50, defaultWidth: 70 },
		{ key: 'user', label: 'User', minWidth: 120, defaultWidth: 220 },
		{ key: 'item', label: 'Item', minWidth: 120, defaultWidth: 220 },
		{ key: 'qty', label: 'Qty', minWidth: 40, defaultWidth: 50 },
		{ key: 'date', label: 'Created on', minWidth: 100, defaultWidth: 170 },
		{ key: 'status', label: 'Status', minWidth: 70, defaultWidth: 110 },
	];

	const COL_STORAGE_KEY = 'sidekick:fulfillment:colWidths';

	function loadWidths(): number[] {
		if (typeof localStorage === 'undefined')
			return columns.map(c => c.defaultWidth);
		try {
			const saved = localStorage.getItem(COL_STORAGE_KEY);
			if (saved) {
				const parsed = JSON.parse(saved);
				if (Array.isArray(parsed) && parsed.length === columns.length)
					return parsed;
			}
		} catch { /* expected */ }
		return columns.map(c => c.defaultWidth);
	}

	let colWidths = $state(columns.map(c => c.defaultWidth));
	let resizingCol = $state(-1);

	onMount(() => {
		colWidths = loadWidths();
	});

	function saveWidths() {
		localStorage.setItem(COL_STORAGE_KEY, JSON.stringify(colWidths));
	}

	let tableEl = $state<HTMLTableElement | null>(null);
	let scrollContainerEl = $state<HTMLDivElement | null>(null);

	function startColResize(colIndex: number, e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		resizingCol = colIndex;
		const startX = e.clientX;

		const ths = tableEl?.querySelectorAll('thead th');
		if (!ths)
			return;
		const actualWidths = Array.from(ths).map(th => th.getBoundingClientRect().width);
		const startW = actualWidths[colIndex];
		const nextW = colIndex < columns.length - 1 ? actualWidths[colIndex + 1] : 0;

		colWidths = actualWidths;

		function onMove(ev: MouseEvent) {
			const delta = ev.clientX - startX;
			const newW = Math.max(columns[colIndex].minWidth, startW + delta);
			colWidths[colIndex] = newW;
			if (colIndex < columns.length - 1) {
				colWidths[colIndex + 1] = Math.max(columns[colIndex + 1].minWidth, nextW - (newW - startW));
			}
		}
		function onUp() {
			resizingCol = -1;
			saveWidths();
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
		}
		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
	}

	let sortKey = $state<SortKey>('date');
	let sortAsc = $state(true);

	function toggleSort(key: SortKey) {
		if (sortKey === key) {
			sortAsc = !sortAsc;
		} else {
			sortKey = key;
			sortAsc = true;
		}
	}

	const sortedOrders = $derived.by(() => {
		const orders = [...data.orders];
		const dir = sortAsc ? 1 : -1;
		orders.sort((a, b) => {
			switch (sortKey) {
				case 'id': return (parseInt(a.id) - parseInt(b.id)) * dir;
				case 'user': return a.userName.localeCompare(b.userName) * dir;
				case 'item': {
					const ai = data.items[a.itemId]?.name ?? a.itemId;
					const bi = data.items[b.itemId]?.name ?? b.itemId;
					return ai.localeCompare(bi) * dir;
				}
				case 'qty': return (a.quantity - b.quantity) * dir;
				case 'date': return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir;
				case 'status': return a.status.localeCompare(b.status) * dir;
				default: return 0;
			}
		});
		return orders;
	});

	const CURSOR_STACK_KEY = 'sidekick:fulfillment:cursorStack';

	function getCursorStack(): string[] {
		if (typeof sessionStorage === 'undefined')
			return [];
		try { return JSON.parse(sessionStorage.getItem(CURSOR_STACK_KEY) ?? '[]'); }
		catch { return []; }
	}

	let hasPrevPage = $state(false);
	let currentPage = $state(1);

	$effect(() => {
		void $page.url;
		const stack = getCursorStack();
		hasPrevPage = stack.length > 0;
		currentPage = stack.length + 1;
	});

	function clearCursorStack() {
		if (typeof sessionStorage !== 'undefined') { sessionStorage.removeItem(CURSOR_STACK_KEY); }
		hasPrevPage = false;
	}

	let shouldScrollToTop = false;

	afterNavigate(() => {
		if (shouldScrollToTop) {
			shouldScrollToTop = false;
			scrollContainerEl?.scrollTo({ top: 0, behavior: 'smooth' });
		}
	});

	function loadNextPage() {
		if (!data.nextCursor)
			return;
		const stack = getCursorStack();
		stack.push($page.url.searchParams.get('cursor') ?? '');
		sessionStorage.setItem(CURSOR_STACK_KEY, JSON.stringify(stack));
		const url = new URL($page.url);
		url.searchParams.set('cursor', data.nextCursor);
		shouldScrollToTop = true;
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(url.toString());
	}

	function loadPrevPage() {
		const stack = getCursorStack();
		if (stack.length === 0)
			return;
		const prevCursor = stack.pop()!;
		sessionStorage.setItem(CURSOR_STACK_KEY, JSON.stringify(stack));
		const url = new URL($page.url);
		if (prevCursor) { url.searchParams.set('cursor', prevCursor); }
		else { url.searchParams.delete('cursor'); }
		shouldScrollToTop = true;
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(url.toString());
	}

	let orderOverrides = $state<Record<string, { status?: string; reference?: string; adminNotes?: string }>>({});

	function handleStatusChange(orderId: string, newStatus: string) {
		orderOverrides[orderId] = { ...orderOverrides[orderId], status: newStatus };
	}

	function handleReferenceChange(orderId: string, newRef: string) {
		orderOverrides[orderId] = { ...orderOverrides[orderId], reference: newRef };
	}

	function getOrderStatus(order: Order): string {
		return orderOverrides[order.id]?.status ?? order.status;
	}

	function applyOverrides(order: Order): Order {
		const ov = orderOverrides[order.id];
		if (!ov)
			return order;
		const result = { ...order };
		if (ov.status !== undefined) { result.status = ov.status as Order['status']; }
		if (ov.reference !== undefined) { result.reference = ov.reference; }
		if (ov.adminNotes !== undefined) { result.adminNotes = ov.adminNotes; }
		return result;
	}

	const effectiveOrder = $derived<Order | null>(
		selectedOrder ? applyOverrides(selectedOrder) : null
	);

	function handleNotesChange(orderId: string, newNotes: string) {
		orderOverrides[orderId] = { ...orderOverrides[orderId], adminNotes: newNotes };
	}

	let itemOverrides = $state<Record<string, { fulfillerContext?: string }>>({});

	function handleContextChange(itemId: string, newContext: string) {
		itemOverrides[itemId] = { ...itemOverrides[itemId], fulfillerContext: newContext };
	}

	function applyItemOverrides(item: ShopItem): ShopItem {
		const ov = itemOverrides[item.id];
		if (!ov)
			return item;
		return { ...item, ...(ov.fulfillerContext !== undefined && { fulfillerContext: ov.fulfillerContext }) };
	}

	const effectiveItem = $derived<ShopItem | null>(
		selectedItem ? applyItemOverrides(selectedItem) : null
	);

	function selectOrder(order: Order) {
		selectedOrder = order;
	}

	function handleSearch() {
		clearCursorStack();
		const trimmed = searchInput.trim();
		const url = new URL($page.url);
		if (trimmed) { url.searchParams.set('search', trimmed); }
		else { url.searchParams.delete('search'); }
		url.searchParams.delete('cursor');
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(url.toString(), { replaceState: true });
	}

	let refreshing = $state(false);

	async function refresh() {
		refreshing = true;
		orderOverrides = {};
		itemOverrides = {};
		await invalidateAll();
		refreshing = false;
	}

	const isDragging = $derived(draggingDivider || resizingCol >= 0);
</script>

<div class="flex h-full overflow-hidden {isDragging ? 'select-none' : ''}">
	<div class="flex flex-col gap-3 p-6 min-w-0" style="width: {dividerX}%">
		<div class="flex items-center justify-between">
			<div class="flex gap-2 items-center">
				<form
					class="border border-border-input rounded-tag flex gap-2 items-center px-3 py-1.5 w-[220px]"
					onsubmit={(e) => { e.preventDefault(); handleSearch(); }}
				>
					<UserSearch size={14} class="text-text-placeholder shrink-0" />
					<input
						bind:value={searchInput}
						placeholder="Search by user..."
						class="flex-1 bg-transparent text-sm outline-none placeholder:text-text-placeholder font-medium"
					/>
				</form>
				<div class="relative">
					<button class="border border-border-input rounded-tag flex gap-2 items-center px-3 py-1.5 cursor-pointer hover:bg-surface">
						<Funnel size={14} class="text-text-dim" />
						<span class="font-medium text-sm text-text-dim capitalize">{data.statusFilter}</span>
					</button>
				</div>
			</div>
			<div class="flex items-center gap-2">
				<span class="font-medium text-sm text-text-muted">
					Showing {data.orders.length} of {data.totalCount} orders.
				</span>
				<button
					class="text-text-tertiary hover:text-text-primary cursor-pointer transition-colors"
					onclick={refresh}
					disabled={refreshing}
					title="Refresh"
				>
					<RefreshCw size={14} class={refreshing ? 'animate-spin' : ''} />
				</button>
			</div>
		</div>

		<div class="flex-1 min-h-0 flex flex-col border border-border-table rounded-input overflow-clip">
			<div bind:this={scrollContainerEl} class="flex-1 min-h-0 overflow-auto">
				<table bind:this={tableEl} class="w-full border-collapse table-fixed">
					<colgroup>
						{#each colWidths as w, i (i)}
							<col style="width: {w}px" />
						{/each}
					</colgroup>
					<thead class="sticky top-0 bg-page z-10 shadow-[0_1px_0_0_var(--color-border-table)]">
						<tr>
							{#each columns as col, i (col.key)}
								<th
									class="text-left text-sm font-bold px-3 py-2 select-none relative
										{i < columns.length - 1 ? 'border-r border-border-table' : ''}
										{sortKey === col.key ? 'text-accent' : ''}"
								>
									<button
										class="flex items-center gap-1.5 w-full cursor-pointer"
										onclick={() => toggleSort(col.key)}
									>
										{col.label}
										{#if sortKey === col.key}
											{#if sortAsc}
												<ChevronUp size={12} class="shrink-0" />
											{:else}
												<ChevronDown size={12} class="shrink-0" />
											{/if}
										{/if}
									</button>
									{#if i < columns.length - 1}
										<!-- svelte-ignore a11y_no_static_element_interactions -->
										<div
											class="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-accent/30 z-20"
											onmousedown={(e) => startColResize(i, e)}
										></div>
									{/if}
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each sortedOrders as order (order.id)}
							{@const item = data.items[order.itemId]}
							<OrderTableRow
								id="#{order.id}"
								userName={order.userName}
								userEmail={order.userEmail}
								userAvatarUrl={order.userAvatarUrl}
								itemName={item?.name ?? order.itemId}
								itemPrice={item?.unitPrice}
								itemThumbnailUrl={item?.thumbnailUrl}
								quantity={order.quantity}
								date={order.createdAt}
								status={getOrderStatus(order)}
								selected={selectedOrder?.id === order.id}
								onclick={() => selectOrder(order)}
							/>
						{/each}
					</tbody>
				</table>
			</div>

			<div class="shrink-0 border-t border-border-table bg-page px-3 py-2 flex items-center justify-between">
				<span class="text-sm text-text-muted">
					{data.orders.length} of {data.totalCount} orders
				</span>
				<div class="flex items-center gap-3">
					{#if hasPrevPage}
						<button
							class="flex items-center gap-1 text-sm font-medium text-text-primary hover:text-accent cursor-pointer"
							onclick={loadPrevPage}
						>
							<ChevronLeft size={14} />
							Previous
						</button>
					{/if}
					{#if hasPrevPage || data.nextCursor}
						<span class="text-sm text-text-muted">Page {currentPage}</span>
					{/if}
					{#if data.nextCursor}
						<button
							class="flex items-center gap-1 text-sm font-medium text-text-primary hover:text-accent cursor-pointer"
							onclick={loadNextPage}
						>
							Next
							<ChevronRight size={14} />
						</button>
					{/if}
				</div>
			</div>
		</div>
	</div>

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="relative flex-shrink-0 w-5 cursor-col-resize group"
		onmousedown={startDividerDrag}
	>
		<div class="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-px bg-border-card"></div>
		<div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-10 bg-white border border-border-card rounded-[5px] flex items-center justify-center shadow-sm group-hover:border-text-tertiary transition-colors">
			<div class="flex flex-col gap-[3px]">
				<div class="w-1.5 h-px rounded-full bg-border-card group-hover:bg-text-tertiary transition-colors"></div>
				<div class="w-1.5 h-px rounded-full bg-border-card group-hover:bg-text-tertiary transition-colors"></div>
				<div class="w-1.5 h-px rounded-full bg-border-card group-hover:bg-text-tertiary transition-colors"></div>
			</div>
		</div>
	</div>

	<div class="flex-1 min-w-0 overflow-auto">
		{#if effectiveOrder && effectiveItem}
			<OrderDetailPane
				order={effectiveOrder}
				item={effectiveItem}
				programId={data.program.id}
				cardGrantTemplate={data.cardGrantTemplates[effectiveOrder.itemId] ?? null}
				hcbOrganization={data.hcbOrganization}
				onclose={() => (selectedOrder = null)}
				onstatuschange={(newStatus) => handleStatusChange(selectedOrder!.id, newStatus)}
				onreferencechange={(newRef) => handleReferenceChange(selectedOrder!.id, newRef)}
				onnoteschange={(newNotes) => handleNotesChange(selectedOrder!.id, newNotes)}
				oncontextchange={(newCtx) => handleContextChange(effectiveItem!.id, newCtx)}
				onsendgrant={(ref) => handleReferenceChange(selectedOrder!.id, ref)}
			/>
		{:else}
			<div class="flex items-center justify-center h-full text-text-tertiary text-sm">
				Select an order to view details
			</div>
		{/if}
	</div>
</div>
