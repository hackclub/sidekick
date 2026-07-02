<script lang="ts">
	import type { PageData } from './$types.js';
	import { afterNavigate, goto, invalidateAll } from '$app/navigation';
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import OrderTableRow from '$lib/components/fulfillment/OrderTableRow.svelte';
	import OrderDetailPane from '$lib/components/fulfillment/OrderDetailPane.svelte';
	import StatusLight from '$lib/components/ui/StatusLight.svelte';
	import { UserSearch, Funnel, Package, Search, ChevronDown, ChevronUp, ChevronRight, ChevronLeft, RefreshCw, Check, Download, TriangleAlert, X, Send, ListChecks, ClipboardList, Loader2, Pencil, Unlink } from 'lucide-svelte';
	import type { Order, ShopItem } from '$lib/server/protocol/types.js';
	import CsvExportModal from '$lib/components/ui/CsvExportModal.svelte';

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
	interface ColDef { key: SortKey; label: string; minWidth: number; maxWidth: number }

	const columns: ColDef[] = [
		{ key: 'id', label: 'ID', minWidth: 50, maxWidth: 100 },
		{ key: 'user', label: 'User', minWidth: 120, maxWidth: 300 },
		{ key: 'item', label: 'Item', minWidth: 120, maxWidth: 300 },
		{ key: 'qty', label: 'Qty', minWidth: 40, maxWidth: 70 },
		{ key: 'date', label: 'Created on', minWidth: 100, maxWidth: 220 },
		{ key: 'status', label: 'Status', minWidth: 70, maxWidth: 140 },
	];

	let colWidths = $state(columns.map(c => c.minWidth));
	let resizingCol = $state(-1);
	let manuallyResized = false;

	function autoFitColumns() {
		if (!tableEl) return;
		const cols = tableEl.querySelectorAll<HTMLTableColElement>('colgroup col');
		const prevWidths = Array.from(cols).map(c => c.style.width);
		cols.forEach(c => (c.style.width = ''));

		const prevLayout = tableEl.style.tableLayout;
		const prevW = tableEl.style.width;
		tableEl.style.tableLayout = 'auto';
		tableEl.style.width = 'auto';

		const cells = tableEl.querySelectorAll<HTMLElement>('th, td');
		const prevWhitespace: string[] = [];
		cells.forEach(c => {
			prevWhitespace.push(c.style.whiteSpace);
			c.style.whiteSpace = 'nowrap';
		});

		const ths = tableEl.querySelectorAll('thead th');
		const measured = Array.from(ths).map(th => th.getBoundingClientRect().width);

		cells.forEach((c, i) => (c.style.whiteSpace = prevWhitespace[i]));
		tableEl.style.tableLayout = prevLayout;
		tableEl.style.width = prevW;
		cols.forEach((c, i) => (c.style.width = prevWidths[i]));

		colWidths = measured.map((w, i) =>
			Math.max(columns[i].minWidth, Math.min(Math.ceil(w), columns[i].maxWidth))
		);
	}

	onMount(() => {
		autoFitColumns();
	});

	function saveWidths() {
		manuallyResized = true;
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

	const sortKeyToParam: Record<SortKey, string> = {
		id: 'id', user: 'user', item: 'item', qty: 'quantity', date: 'date', status: 'status'
	};
	const paramToSortKey: Record<string, SortKey> = {
		id: 'id', user: 'user', item: 'item', quantity: 'qty', date: 'date', status: 'status'
	};

	const sortKey = $derived<SortKey>(paramToSortKey[data.sortBy] ?? 'date');
	const sortAsc = $derived(data.sortOrder === 'asc');

	function toggleSort(key: SortKey) {
		clearCursorStack();
		const url = new URL($page.url);
		const param = sortKeyToParam[key];
		if (sortKey === key) {
			url.searchParams.set('sortOrder', sortAsc ? 'desc' : 'asc');
		} else {
			url.searchParams.set('sort', param);
			url.searchParams.set('sortOrder', 'asc');
		}
		url.searchParams.delete('cursor');
		goto(url.toString(), { replaceState: true });
	}

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
		if (!manuallyResized) {
			queueMicrotask(() => autoFitColumns());
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

	let orderOverrides = $state<Record<string, { status?: string; reference?: string; adminNotes?: string; userNotes?: string }>>({});

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
		if (ov.userNotes !== undefined) { result.userNotes = ov.userNotes; }
		return result;
	}

	const effectiveOrder = $derived<Order | null>(
		selectedOrder ? applyOverrides(selectedOrder) : null
	);

	function handleNotesChange(orderId: string, newNotes: string) {
		orderOverrides[orderId] = { ...orderOverrides[orderId], adminNotes: newNotes };
	}

	function handleUserNotesChange(orderId: string, newNotes: string) {
		orderOverrides[orderId] = { ...orderOverrides[orderId], userNotes: newNotes };
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

	let statusDropdownOpen = $state(false);
	let itemDropdownOpen = $state(false);

	function setStatusFilter(value: string) {
		clearCursorStack();
		statusDropdownOpen = false;
		const url = new URL($page.url);
		if (value === 'pending') { url.searchParams.delete('status'); }
		else { url.searchParams.set('status', value); }
		url.searchParams.delete('cursor');
		goto(url.toString(), { replaceState: true });
	}

	function setItemFilter(value: string) {
		clearCursorStack();
		itemDropdownOpen = false;
		const url = new URL($page.url);
		if (value) { url.searchParams.set('item', value); }
		else { url.searchParams.delete('item'); }
		url.searchParams.delete('cursor');
		goto(url.toString(), { replaceState: true });
	}

	function handleFilterWindowClick(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('[data-filter-status]')) statusDropdownOpen = false;
		if (!target.closest('[data-filter-item]')) itemDropdownOpen = false;
	}

	$effect(() => {
		if (statusDropdownOpen || itemDropdownOpen) {
			window.addEventListener('click', handleFilterWindowClick, true);
			return () => window.removeEventListener('click', handleFilterWindowClick, true);
		}
	});

	const statusFilterLabel = $derived(
		data.statusFilter === 'all' ? 'All statuses' :
		data.statusFilter.charAt(0).toUpperCase() + data.statusFilter.slice(1)
	);

	const itemFilterLabel = $derived.by(() => {
		if (!data.itemFilter) return 'All items';
		const item = data.allShopItems.find(i => i.id === data.itemFilter);
		return item?.name ?? data.itemFilter;
	});

	let itemSearchQuery = $state('');

	const filteredShopItems = $derived(
		itemSearchQuery
			? data.allShopItems.filter(i => i.name.toLowerCase().includes(itemSearchQuery.toLowerCase()))
			: data.allShopItems
	);

	function slugify(name: string): string {
		return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
	}

	type ExportFormat = 'theseus' | 'generic';

	interface ExportOrder {
		id: string;
		row: string;
		// theseus
		firstName?: string;
		lastName?: string;
		city?: string;
		stateProvince?: string;
		country?: string;
		// generic
		userName?: string;
		userEmail?: string;
		itemName?: string;
		quantity?: number;
		status?: string;
	}

	interface ExportData {
		format: ExportFormat;
		csvHeader: string;
		orders: ExportOrder[];
		skippedOrders: { id: string; userName: string }[];
		totalOrders: number;
		programName: string;
		itemName: string | null;
	}

	const CSV_FORMAT_STORAGE_KEY = 'sidekick_csv_export_format';

	const exportFormats: { value: ExportFormat; label: string; description: string }[] = [
		{ value: 'theseus', label: 'Theseus', description: 'Shipping addresses' },
		{ value: 'generic', label: 'Generic', description: 'Full order data' },
	];

	let csvDropdownOpen = $state(false);
	let formatDropdownOpen = $state(false);
	let exporting = $state(false);
	let exportMode = $state<'download' | 'dinobox'>('download');
	let exportFormat = $state<ExportFormat>(
		browser && localStorage.getItem(CSV_FORMAT_STORAGE_KEY) === 'generic' ? 'generic' : 'theseus'
	);
	let exportResult = $state<ExportData | null>(null);
	let excludedOrderIds = $state(new Set<string>());
	let dinoboxSending = $state(false);
	let dinoboxSent = $state(false);

	const includedOrders = $derived(
		exportResult?.orders.filter(o => !excludedOrderIds.has(o.id)) ?? []
	);

	async function fetchExport(): Promise<ExportData> {
		const url = new URL($page.url);
		url.pathname = url.pathname.replace(/\/?$/, '/export-csv');
		url.searchParams.delete('cursor');
		url.searchParams.set('format', exportFormat);
		const res = await fetch(url.toString(), { method: 'POST' });
		if (!res.ok) throw new Error('Export failed');
		return await res.json();
	}

	async function startExport(mode: 'download' | 'dinobox') {
		csvDropdownOpen = false;
		exportMode = mode;
		exporting = true;
		exportResult = null;
		excludedOrderIds = new Set();
		dinoboxSent = false;
		try {
			exportResult = await fetchExport();
		} catch {
			alert('Failed to export CSV. Please try again.');
		} finally {
			exporting = false;
		}
	}

	async function setExportFormat(format: ExportFormat) {
		formatDropdownOpen = false;
		if (format === exportFormat || exporting) return;
		exportFormat = format;
		if (browser) localStorage.setItem(CSV_FORMAT_STORAGE_KEY, format);
		if (!exportResult) return;
		exporting = true;
		try {
			exportResult = await fetchExport();
			excludedOrderIds = new Set();
		} catch {
			alert('Failed to export CSV. Please try again.');
		} finally {
			exporting = false;
		}
	}

	function buildCsv(result: ExportData, excluded: Set<string>): string {
		const rows = [result.csvHeader];
		for (const order of result.orders) {
			if (!excluded.has(order.id)) rows.push(order.row);
		}
		return rows.join('\r\n') + '\r\n';
	}

	function buildFilename(result: { programName: string; itemName: string | null; format: ExportFormat }): string {
		const date = new Date().toISOString().slice(0, 10);
		let name = slugify(result.programName);
		if (result.itemName) name += `-${slugify(result.itemName)}`;
		return `${name}-${date}-sidekick-${result.format}.csv`;
	}

	function executeExport() {
		const result = exportResult!;
		const csv = buildCsv(result, excludedOrderIds);
		if (exportMode === 'download') {
			downloadCsv(csv, result);
		} else {
			sendToDinobox(csv, result);
		}
	}

	function downloadCsv(csv: string, result: ExportData) {
		const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = buildFilename(result);
		a.click();
		URL.revokeObjectURL(url);
		exportResult = null;
	}

	async function sendToDinobox(csv: string, result: ExportData) {
		dinoboxSending = true;
		exportResult = null;
		try {
			const url = new URL($page.url);
			url.pathname = url.pathname.replace(/\/?$/, '/send-dinobox');
			const res = await fetch(url.toString(), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					csv,
					filename: buildFilename(result),
					itemName: result.itemName,
					programName: result.programName
				})
			});
			if (!res.ok) throw new Error('Failed to send');
			dinoboxSent = true;
			setTimeout(() => (dinoboxSent = false), 3000);
		} catch {
			alert('Failed to send to Dinobox. Please try again.');
		} finally {
			dinoboxSending = false;
		}
	}

	function toggleOrderExclusion(orderId: string) {
		const next = new Set(excludedOrderIds);
		if (next.has(orderId)) next.delete(orderId);
		else next.add(orderId);
		excludedOrderIds = next;
	}

	function toggleAllOrders() {
		if (!exportResult) return;
		if (excludedOrderIds.size === 0) {
			excludedOrderIds = new Set(exportResult.orders.map(o => o.id));
		} else {
			excludedOrderIds = new Set();
		}
	}

	function handleCsvDropdownWindowClick(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('[data-csv-dropdown]')) csvDropdownOpen = false;
	}

	$effect(() => {
		if (csvDropdownOpen) {
			window.addEventListener('click', handleCsvDropdownWindowClick, true);
			return () => window.removeEventListener('click', handleCsvDropdownWindowClick, true);
		}
	});

	function handleFormatDropdownWindowClick(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('[data-format-dropdown]')) formatDropdownOpen = false;
	}

	$effect(() => {
		if (formatDropdownOpen) {
			window.addEventListener('click', handleFormatDropdownWindowClick, true);
			return () => window.removeEventListener('click', handleFormatDropdownWindowClick, true);
		}
	});

	let itemSearchEl = $state<HTMLInputElement | null>(null);

	$effect(() => {
		if (itemDropdownOpen) {
			itemSearchQuery = '';
			queueMicrotask(() => itemSearchEl?.focus());
		}
	});

	// -- Mass-fulfill --

	interface TheseusRecord {
		letterId: string;
		fullText: string;
		status: 'mailed' | 'printed';
	}

	interface MassFulfillRow {
		letterId: string;
		letterName: string;
		orderId: string | null;
		orderUserName: string | null;
		orderAddressName: string | null;
		confidence: 'high' | 'medium' | 'low' | null;
	}

	interface AvailableOrder {
		id: string;
		userName: string;
		addressName: string;
	}

	let massFulfillDropdownOpen = $state(false);
	let massFulfillStep = $state<'paste' | 'matching' | 'preview' | 'executing' | 'done' | null>(null);
	let massFulfillInput = $state('');
	let massFulfillRows = $state<MassFulfillRow[]>([]);
	let massFulfillAvailableOrders = $state<AvailableOrder[]>([]);
	let massFulfillExcluded = $state(new Set<string>());
	let massFulfillResult = $state<{ fulfilled: number; errors: { orderId: string; error: string }[] } | null>(null);

	// Order picker state
	let editingRowLetterId = $state<string | null>(null);
	let orderPickerSearch = $state('');
	let orderPickerPos = $state({ top: 0, left: 0, width: 0 });
	let orderPickerSearchEl = $state<HTMLInputElement | null>(null);

	const assignedOrderIds = $derived(new Set(massFulfillRows.filter(r => r.orderId).map(r => r.orderId!)));

	const massFulfillIncluded = $derived(
		massFulfillRows.filter(r => r.orderId !== null && !massFulfillExcluded.has(r.letterId))
	);

	const massFulfillAssignedCount = $derived(massFulfillRows.filter(r => r.orderId !== null).length);
	const massFulfillUnassignedCount = $derived(massFulfillRows.filter(r => r.orderId === null).length);

	const filteredPickerOrders = $derived(
		orderPickerSearch
			? massFulfillAvailableOrders.filter(o => {
				const q = orderPickerSearch.toLowerCase();
				return o.addressName.toLowerCase().includes(q) ||
					o.userName.toLowerCase().includes(q) ||
					o.id.toLowerCase().includes(q);
			})
			: massFulfillAvailableOrders
	);

	const editingRow = $derived(
		editingRowLetterId ? massFulfillRows.find(r => r.letterId === editingRowLetterId) ?? null : null
	);

	function parseTheseusTable(text: string): TheseusRecord[] {
		const collapsed = text.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
		const segments = collapsed.split(/(?=ltr![a-z0-9]+)/i);

		const records: TheseusRecord[] = [];
		for (const segment of segments) {
			const trimmed = segment.trim();
			if (!trimmed.startsWith('ltr!')) continue;

			const idEnd = trimmed.indexOf(' ');
			if (idEnd === -1) continue;

			const letterId = trimmed.slice(0, idEnd);
			let rest = trimmed.slice(idEnd).trim();

			let status: 'mailed' | 'printed' | null = null;
			if (/\bmailed\s*$/.test(rest)) {
				status = 'mailed';
				rest = rest.replace(/\s+mailed\s*$/, '').trim();
			} else if (/\bprinted\s*$/.test(rest)) {
				status = 'printed';
				rest = rest.replace(/\s+printed\s*$/, '').trim();
			}

			if (!status) continue;
			records.push({ letterId, fullText: rest, status });
		}

		return records;
	}

	function openMassFulfill() {
		massFulfillDropdownOpen = false;
		massFulfillStep = 'paste';
		massFulfillInput = '';
		massFulfillRows = [];
		massFulfillAvailableOrders = [];
		massFulfillExcluded = new Set();
		massFulfillResult = null;
		editingRowLetterId = null;
	}

	async function parseAndMatch() {
		const allRecords = parseTheseusTable(massFulfillInput);
		const mailedRecords = allRecords.filter(r => r.status === 'mailed');

		if (mailedRecords.length === 0) {
			alert('No mailed records found in the pasted text.');
			return;
		}

		massFulfillStep = 'matching';

		try {
			const url = new URL($page.url);
			url.pathname = url.pathname.replace(/\/?$/, '/mass-fulfill');
			const res = await fetch(url.toString(), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'match',
					records: mailedRecords.map(r => ({ letterId: r.letterId, fullText: r.fullText }))
				})
			});

			if (!res.ok) throw new Error('Match request failed');
			const result = await res.json();

			massFulfillRows = result.rows;
			massFulfillAvailableOrders = result.availableOrders;
			massFulfillExcluded = new Set();
			massFulfillStep = 'preview';
		} catch {
			alert('Failed to match records. Please try again.');
			massFulfillStep = 'paste';
		}
	}

	function assignOrder(letterId: string, order: AvailableOrder | null) {
		massFulfillRows = massFulfillRows.map(row => {
			if (order && row.letterId !== letterId && row.orderId === order.id) {
				return { ...row, orderId: null, orderUserName: null, orderAddressName: null, confidence: null };
			}
			if (row.letterId === letterId) {
				return {
					...row,
					orderId: order?.id ?? null,
					orderUserName: order?.userName ?? null,
					orderAddressName: order?.addressName ?? null,
					confidence: order ? 'high' as const : null
				};
			}
			return row;
		});
		editingRowLetterId = null;
	}

	function openOrderPicker(letterId: string, event: MouseEvent) {
		const el = event.currentTarget as HTMLElement;
		const rect = el.getBoundingClientRect();
		orderPickerPos = { top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 300) };
		editingRowLetterId = letterId;
		orderPickerSearch = '';
		queueMicrotask(() => orderPickerSearchEl?.focus());
	}

	function closeOrderPicker() {
		editingRowLetterId = null;
	}

	async function executeMassFulfill() {
		const toFulfill = massFulfillIncluded.map(r => ({
			orderId: r.orderId!,
			letterId: r.letterId,
			reference: `https://mail.hackclub.com/letters/${r.letterId}`
		}));

		massFulfillStep = 'executing';

		try {
			const url = new URL($page.url);
			url.pathname = url.pathname.replace(/\/?$/, '/mass-fulfill');
			const res = await fetch(url.toString(), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'execute', matches: toFulfill })
			});

			if (!res.ok) throw new Error('Execute request failed');
			massFulfillResult = await res.json();
			massFulfillStep = 'done';

			for (const r of massFulfillIncluded) {
				orderOverrides[r.orderId!] = {
					...orderOverrides[r.orderId!],
					status: 'fulfilled',
					reference: `https://mail.hackclub.com/letters/${r.letterId}`
				};
			}
		} catch {
			alert('Failed to execute mass fulfillment. Please try again.');
			massFulfillStep = 'preview';
		}
	}

	function closeMassFulfill() {
		massFulfillStep = null;
		editingRowLetterId = null;
		if (massFulfillResult && massFulfillResult.fulfilled > 0) {
			invalidateAll();
		}
	}

	function toggleMassFulfillExclusion(letterId: string) {
		const row = massFulfillRows.find(r => r.letterId === letterId);
		if (!row?.orderId) return;
		const next = new Set(massFulfillExcluded);
		if (next.has(letterId)) next.delete(letterId);
		else next.add(letterId);
		massFulfillExcluded = next;
	}

	function toggleAllMassFulfill() {
		const assignedRows = massFulfillRows.filter(r => r.orderId !== null);
		const allExcluded = assignedRows.every(r => massFulfillExcluded.has(r.letterId));
		if (allExcluded) {
			massFulfillExcluded = new Set();
		} else {
			massFulfillExcluded = new Set(assignedRows.map(r => r.letterId));
		}
	}

	function handleMassFulfillDropdownClick(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('[data-massfulfill-dropdown]')) massFulfillDropdownOpen = false;
	}

	function handleOrderPickerOutsideClick(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('[data-order-picker]') && !target.closest('[data-order-cell]')) {
			closeOrderPicker();
		}
	}

	$effect(() => {
		if (massFulfillDropdownOpen) {
			window.addEventListener('click', handleMassFulfillDropdownClick, true);
			return () => window.removeEventListener('click', handleMassFulfillDropdownClick, true);
		}
	});

	$effect(() => {
		if (editingRowLetterId) {
			window.addEventListener('click', handleOrderPickerOutsideClick, true);
			return () => window.removeEventListener('click', handleOrderPickerOutsideClick, true);
		}
	});
</script>

<svelte:head>
	<title>Fulfillment - {data.program.name} - Sidekick</title>
</svelte:head>

<div class="flex h-full overflow-hidden {isDragging ? 'select-none' : ''}">
	<div class="flex flex-col gap-3 p-6 min-w-0" style="width: {selectedOrder ? dividerX : 100}%">
		<div class="flex items-center justify-between flex-wrap gap-2">
			<div class="flex gap-2 items-center flex-wrap min-w-0">
				<form
					class="border border-border-input rounded-tag flex gap-2 items-center px-3 py-1.5 w-[220px] min-w-0"
					onsubmit={(e) => { e.preventDefault(); handleSearch(); }}
				>
					<UserSearch size={14} class="text-text-placeholder shrink-0" />
					<input
						bind:value={searchInput}
						placeholder="Search by user..."
						class="flex-1 bg-transparent text-sm outline-none placeholder:text-text-placeholder font-medium min-w-0"
					/>
				</form>
				<div class="relative" data-filter-status>
					<button
						class="border border-border-input rounded-tag flex gap-2 items-center px-3 py-1.5 cursor-pointer hover:bg-surface min-w-0"
						onclick={() => (statusDropdownOpen = !statusDropdownOpen)}
					>
						<Funnel size={14} class="text-text-dim shrink-0" />
						<span class="font-medium text-sm text-text-dim truncate">{statusFilterLabel}</span>
						<ChevronDown size={12} class="text-text-dim shrink-0" />
					</button>
					{#if statusDropdownOpen}
						<div class="absolute top-full left-0 mt-1 bg-page border border-border-card rounded-input shadow-lg z-30 min-w-[170px] py-1">
							{#each [
								{ value: 'all', label: 'All statuses', light: null },
								{ value: 'pending', label: 'Pending', light: 'pending' as const },
								{ value: 'fulfilled', label: 'Fulfilled', light: 'ok' as const },
								{ value: 'cancelled', label: 'Cancelled', light: 'fail' as const },
							] as opt (opt.value)}
								<button
									class="w-full text-left px-3 py-1.5 text-sm hover:bg-surface cursor-pointer flex items-center justify-between gap-2"
									onclick={() => setStatusFilter(opt.value)}
								>
									<span class="flex items-center gap-2">
										{#if opt.light}
											<StatusLight status={opt.light} size={8} />
										{/if}
										{opt.label}
									</span>
									{#if data.statusFilter === opt.value}
										<Check size={14} class="text-accent" />
									{/if}
								</button>
							{/each}
						</div>
					{/if}
				</div>
				{#if data.allShopItems.length > 0}
					<div class="relative" data-filter-item>
						<button
							class="border border-border-input rounded-tag flex gap-2 items-center px-3 py-1.5 cursor-pointer hover:bg-surface min-w-0 max-w-[200px]"
							onclick={() => (itemDropdownOpen = !itemDropdownOpen)}
						>
							<Package size={14} class="text-text-dim shrink-0" />
							<span class="font-medium text-sm text-text-dim truncate">{itemFilterLabel}</span>
							<ChevronDown size={12} class="text-text-dim shrink-0" />
						</button>
						{#if itemDropdownOpen}
							<div class="absolute top-full left-0 mt-1 bg-page border border-border-card rounded-input shadow-lg z-30 w-[420px] max-h-[400px] flex flex-col">
								<div class="px-2 py-2 border-b border-border-card">
									<div class="flex items-center gap-2 px-2 py-1 border border-border-input rounded-tag">
										<Search size={13} class="text-text-placeholder shrink-0" />
										<input
											bind:this={itemSearchEl}
											bind:value={itemSearchQuery}
											placeholder="Search items..."
											class="flex-1 bg-transparent text-sm outline-none placeholder:text-text-placeholder"
										/>
									</div>
								</div>
								<div class="overflow-y-auto py-1">
									{#if !itemSearchQuery}
										<button
											class="w-full text-left px-3 py-2.5 text-sm hover:bg-surface cursor-pointer flex items-center justify-between gap-2"
											onclick={() => setItemFilter('')}
										>
											<span class="text-text-primary font-medium">All items</span>
											{#if !data.itemFilter}
												<Check size={14} class="text-accent shrink-0" />
											{/if}
										</button>
									{/if}
									{#each filteredShopItems as item (item.id)}
										<button
											class="w-full text-left px-3 py-2 hover:bg-surface cursor-pointer flex items-center gap-3"
											onclick={() => setItemFilter(item.id)}
										>
											{#if item.thumbnailUrl}
												<img
													src={item.thumbnailUrl}
													alt=""
													class="w-8 h-8 rounded object-cover shrink-0 bg-surface"
												/>
											{:else}
												<div class="w-8 h-8 rounded bg-surface flex items-center justify-center shrink-0">
													<Package size={14} class="text-text-placeholder" />
												</div>
											{/if}
											<span class="flex-1 min-w-0 truncate text-sm text-text-primary">{item.name}</span>
											{#if data.itemFilter === item.id}
												<Check size={14} class="text-accent shrink-0" />
											{/if}
										</button>
									{/each}
									{#if filteredShopItems.length === 0}
										<div class="px-3 py-4 text-sm text-text-tertiary text-center">No items match your search</div>
									{/if}
								</div>
							</div>
						{/if}
					</div>
				{/if}
			</div>
			<div class="flex items-center gap-2 shrink-0">
				<span class="font-medium text-sm text-text-muted whitespace-nowrap">
					{data.orders.length} of {data.totalCount}
				</span>
				{#if data.canViewAddressData}
					<div class="relative" data-csv-dropdown>
						<button
							class="border border-border-input rounded-tag flex gap-1.5 items-center px-2.5 py-1 cursor-pointer hover:bg-surface text-sm font-medium text-text-dim whitespace-nowrap"
							onclick={() => (csvDropdownOpen = !csvDropdownOpen)}
							disabled={exporting || dinoboxSending}
						>
							{#if exporting || dinoboxSending}
								<RefreshCw size={13} class="shrink-0 animate-spin" />
								<span class="hidden sm:inline">Exporting...</span>
							{:else if dinoboxSent}
								<Check size={13} class="shrink-0 text-check-pass" />
								<span class="hidden sm:inline text-check-pass">Sent!</span>
							{:else}
								<Download size={13} class="shrink-0" />
								<span class="hidden sm:inline">CSV</span>
								<ChevronDown size={12} class="shrink-0" />
							{/if}
						</button>
						{#if csvDropdownOpen}
							<div class="absolute top-full right-0 mt-1 bg-page border border-border-card rounded-input shadow-lg z-30 min-w-[180px] py-1">
								<button
									class="w-full text-left px-3 py-1.5 text-sm hover:bg-surface cursor-pointer flex items-center gap-2"
									onclick={() => startExport('download')}
								>
									<Download size={13} class="shrink-0" />
									Download CSV
								</button>
								<button
									class="w-full text-left px-3 py-1.5 text-sm hover:bg-surface cursor-pointer flex items-center gap-2"
									onclick={() => startExport('dinobox')}
								>
									<Send size={13} class="shrink-0" />
									Send to Dinobox
								</button>
							</div>
						{/if}
					</div>
				{/if}
				{#if data.canUpdateFulfillments}
					<div class="relative" data-massfulfill-dropdown>
						<button
							class="border border-border-input rounded-tag flex gap-1.5 items-center px-2.5 py-1 cursor-pointer hover:bg-surface text-sm font-medium text-text-dim whitespace-nowrap"
							onclick={() => (massFulfillDropdownOpen = !massFulfillDropdownOpen)}
						>
							<ListChecks size={13} class="shrink-0" />
							<span class="hidden sm:inline">Mass-fulfill</span>
							<ChevronDown size={12} class="shrink-0" />
						</button>
						{#if massFulfillDropdownOpen}
							<div class="absolute top-full right-0 mt-1 bg-page border border-border-card rounded-input shadow-lg z-30 min-w-[220px] py-1">
								<button
									class="w-full text-left px-3 py-1.5 text-sm hover:bg-surface cursor-pointer flex items-center gap-2"
									onclick={openMassFulfill}
								>
									<ClipboardList size={13} class="shrink-0" />
									From Theseus table paste
								</button>
							</div>
						{/if}
					</div>
				{/if}
				<button
					class="text-text-tertiary hover:text-text-primary cursor-pointer transition-colors shrink-0"
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
						{#each data.orders as order (order.id)}
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

	{#if effectiveOrder && effectiveItem}
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

		<div class="flex-1 min-w-[480px] overflow-auto">
			<OrderDetailPane
				order={effectiveOrder}
				item={effectiveItem}
				programId={data.program.id}
				cardGrantTemplate={data.cardGrantTemplates[effectiveOrder.itemId] ?? null}
				warehouseTemplate={data.warehouseTemplates[effectiveOrder.itemId] ?? null}
				hcbOrganization={data.hcbOrganization}
				hasTheseusApiKey={data.hasTheseusApiKey}
				onclose={() => (selectedOrder = null)}
				onstatuschange={(newStatus) => handleStatusChange(selectedOrder!.id, newStatus)}
				onreferencechange={(newRef) => handleReferenceChange(selectedOrder!.id, newRef)}
				onnoteschange={(newNotes) => handleNotesChange(selectedOrder!.id, newNotes)}
				onusernoteschange={(newNotes) => handleUserNotesChange(selectedOrder!.id, newNotes)}
				oncontextchange={(newCtx) => handleContextChange(effectiveItem!.id, newCtx)}
				onsendgrant={(ref) => handleReferenceChange(selectedOrder!.id, ref)}
				onbatchreferencechange={(updates) => updates.forEach(u => handleReferenceChange(u.orderId, u.reference))}
			/>
		</div>
	{/if}
</div>

{#if exportResult}
	<CsvExportModal
		mode={exportMode}
		totalCount={exportResult.orders.length}
		selectedCount={includedOrders.length}
		loading={exporting}
		onclose={() => (exportResult = null)}
		onexport={executeExport}
		class="w-[600px] xl:w-[800px]"
	>
		{#snippet toolbar()}
			<div class="relative" data-format-dropdown>
				<button
					class="border border-border-input rounded-tag flex gap-2 items-center px-3 py-1.5 cursor-pointer hover:bg-surface"
					onclick={() => (formatDropdownOpen = !formatDropdownOpen)}
					disabled={exporting}
				>
					{#if exporting}
						<RefreshCw size={13} class="text-text-dim shrink-0 animate-spin" />
					{/if}
					<span class="font-medium text-sm text-text-dim">
						Format: {exportFormats.find(f => f.value === exportFormat)?.label}
					</span>
					<ChevronDown size={12} class="text-text-dim shrink-0" />
				</button>
				{#if formatDropdownOpen}
					<div class="absolute bottom-full left-0 mb-1 bg-page border border-border-card rounded-input shadow-lg z-30 min-w-[210px] py-1">
						{#each exportFormats as opt (opt.value)}
							<button
								class="w-full text-left px-3 py-1.5 text-sm hover:bg-surface cursor-pointer flex items-center justify-between gap-2"
								onclick={() => setExportFormat(opt.value)}
							>
								<span class="flex flex-col">
									{opt.label}
									<span class="text-xs text-text-tertiary">{opt.description}</span>
								</span>
								{#if exportFormat === opt.value}
									<Check size={14} class="text-accent shrink-0" />
								{/if}
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/snippet}
		{#snippet header()}
			<div class="w-8 px-2 py-1.5 flex items-center justify-center">
				<input
					type="checkbox"
					checked={excludedOrderIds.size === 0}
					indeterminate={excludedOrderIds.size > 0 && excludedOrderIds.size < exportResult!.orders.length}
					onchange={toggleAllOrders}
					class="cursor-pointer accent-accent"
				/>
			</div>
			{#if exportResult!.format === 'generic'}
				<div class="flex-[2] text-left text-text-tertiary font-medium tracking-[-0.3px] px-2 py-1.5">User</div>
				<div class="flex-[3] text-left text-text-tertiary font-medium tracking-[-0.3px] px-2 py-1.5">Email</div>
				<div class="flex-[2] text-left text-text-tertiary font-medium tracking-[-0.3px] px-2 py-1.5">Item</div>
				<div class="flex-[1] text-left text-text-tertiary font-medium tracking-[-0.3px] px-2 py-1.5">Qty</div>
				<div class="flex-[1] text-left text-text-tertiary font-medium tracking-[-0.3px] px-2 py-1.5">Status</div>
			{:else}
				<div class="flex-[2] text-left text-text-tertiary font-medium tracking-[-0.3px] px-2 py-1.5">First</div>
				<div class="flex-[2] text-left text-text-tertiary font-medium tracking-[-0.3px] px-2 py-1.5">Last</div>
				<div class="flex-[2] text-left text-text-tertiary font-medium tracking-[-0.3px] px-2 py-1.5">City</div>
				<div class="flex-[2] text-left text-text-tertiary font-medium tracking-[-0.3px] px-2 py-1.5">State</div>
				<div class="flex-[1] text-left text-text-tertiary font-medium tracking-[-0.3px] px-2 py-1.5">Country</div>
			{/if}
		{/snippet}
		{#each exportResult!.orders as order (order.id)}
			<button
				class="flex items-center w-full text-sm border-b border-border-card last:border-b-0 hover:bg-surface/50 cursor-pointer text-left"
				onclick={() => toggleOrderExclusion(order.id)}
			>
				<div class="w-8 px-2 py-1.5 flex items-center justify-center">
					<input
						type="checkbox"
						checked={!excludedOrderIds.has(order.id)}
						onchange={() => toggleOrderExclusion(order.id)}
						onclick={(e) => e.stopPropagation()}
						class="cursor-pointer accent-accent"
					/>
				</div>
				{#if exportResult!.format === 'generic'}
					<div class="flex-[2] text-text-primary tracking-[-0.3px] px-2 py-1.5 truncate">{order.userName}</div>
					<div class="flex-[3] text-text-primary tracking-[-0.3px] px-2 py-1.5 truncate">{order.userEmail}</div>
					<div class="flex-[2] text-text-primary tracking-[-0.3px] px-2 py-1.5 truncate">{order.itemName}</div>
					<div class="flex-[1] text-text-primary tracking-[-0.3px] px-2 py-1.5 truncate">{order.quantity}</div>
					<div class="flex-[1] text-text-primary tracking-[-0.3px] px-2 py-1.5 truncate capitalize">{order.status}</div>
				{:else}
					<div class="flex-[2] text-text-primary tracking-[-0.3px] px-2 py-1.5 truncate">{order.firstName}</div>
					<div class="flex-[2] text-text-primary tracking-[-0.3px] px-2 py-1.5 truncate">{order.lastName}</div>
					<div class="flex-[2] text-text-primary tracking-[-0.3px] px-2 py-1.5 truncate">{order.city}</div>
					<div class="flex-[2] text-text-primary tracking-[-0.3px] px-2 py-1.5 truncate">{order.stateProvince}</div>
					<div class="flex-[1] text-text-primary tracking-[-0.3px] px-2 py-1.5 truncate">{order.country}</div>
				{/if}
			</button>
		{/each}
		{#snippet extra()}
			{#if exportResult!.skippedOrders.length > 0}
				<div class="flex items-start gap-2 px-3 py-2.5 bg-yellow-500/10 rounded-input">
					<TriangleAlert size={14} class="text-yellow-500 shrink-0 mt-0.5" />
					<div class="flex flex-col gap-1">
						<span class="text-sm text-text-primary tracking-[-0.3px]">
							{exportResult!.skippedOrders.length} {exportResult!.skippedOrders.length === 1 ? 'order' : 'orders'} skipped — no shipping address on file
						</span>
						<div class="flex flex-wrap gap-x-2 gap-y-0.5">
							{#each exportResult!.skippedOrders as order (order.id)}
								<span class="text-xs text-text-dim tracking-[-0.2px]">
									<span class="text-text-tertiary">#{order.id}</span> {order.userName}
								</span>
							{/each}
						</div>
					</div>
				</div>
			{/if}
		{/snippet}
	</CsvExportModal>
{/if}

{#if massFulfillStep}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
		onmousedown={(e) => { if (e.target === e.currentTarget && massFulfillStep !== 'matching' && massFulfillStep !== 'executing') closeMassFulfill(); }}
	>
		<div class="bg-page border border-border-card rounded-card shadow-xl w-[700px] xl:w-[900px] max-h-[80vh] flex flex-col">
			<div class="flex items-center justify-between px-5 py-4 border-b border-border-card">
				<div class="flex items-center gap-2">
					<ListChecks size={16} class="text-text-primary" />
					<span class="font-bold text-[15px] text-text-primary tracking-[-0.4px]">Mass-fulfill</span>
				</div>
				{#if massFulfillStep !== 'matching' && massFulfillStep !== 'executing'}
					<button
						class="text-text-tertiary hover:text-text-primary cursor-pointer"
						onclick={closeMassFulfill}
					>
						<X size={16} />
					</button>
				{/if}
			</div>

			{#if massFulfillStep === 'paste'}
				<div class="px-5 py-4 flex flex-col gap-3 overflow-y-auto">
					<p class="text-sm text-text-dim tracking-[-0.3px]">
						Paste a Theseus letter table below. Only records marked as <span class="font-medium text-text-primary">mailed</span> will be fulfilled — <span class="text-text-tertiary">printed</span> records are skipped.
					</p>
					<textarea
						bind:value={massFulfillInput}
						placeholder={"ltr!abc123    John Smith 123 Main St Springfield IL  62701    mailed\nltr!def456    Jane Doe 456 Oak Ave Chicago IL  60601    printed"}
						class="w-full h-48 px-3 py-2 text-sm font-mono bg-surface border border-border-input rounded-input resize-y outline-none focus:border-accent placeholder:text-text-placeholder"
					></textarea>
				</div>
				<div class="flex items-center justify-end px-5 py-4 border-t border-border-card gap-2">
					<button
						class="px-3 py-1.5 text-sm font-medium text-text-dim hover:bg-surface rounded-tag cursor-pointer"
						onclick={closeMassFulfill}
					>
						Cancel
					</button>
					<button
						class="px-3 py-1.5 text-sm font-medium bg-accent text-white rounded-tag cursor-pointer hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
						disabled={!massFulfillInput.trim()}
						onclick={parseAndMatch}
					>
						Parse & Match
					</button>
				</div>

			{:else if massFulfillStep === 'matching'}
				<div class="px-5 py-12 flex flex-col items-center gap-3">
					<Loader2 size={24} class="animate-spin text-accent" />
					<p class="text-sm text-text-dim tracking-[-0.3px]">Matching records to pending orders...</p>
				</div>

			{:else if massFulfillStep === 'preview'}
				<div class="px-5 py-4 flex flex-col gap-3 overflow-y-auto">
					<p class="text-sm text-text-dim tracking-[-0.3px]">
						Matched {massFulfillAssignedCount} of {massFulfillRows.length} mailed records to pending orders.
						{#if massFulfillUnassignedCount > 0}
							<span class="text-yellow-600">{massFulfillUnassignedCount} unassigned</span> — click to assign manually.
						{/if}
					</p>

					<div class="border border-border-card rounded-input overflow-hidden flex flex-col max-h-[400px]">
						<div class="flex items-center border-b border-border-card bg-surface text-sm shrink-0">
							<div class="w-8 px-2 py-1.5 flex items-center justify-center">
								<input
									type="checkbox"
									checked={massFulfillAssignedCount > 0 && massFulfillExcluded.size === 0}
									indeterminate={massFulfillExcluded.size > 0 && massFulfillExcluded.size < massFulfillAssignedCount}
									disabled={massFulfillAssignedCount === 0}
									onchange={toggleAllMassFulfill}
									class="cursor-pointer accent-accent"
								/>
							</div>
							<div class="flex-[1.5] text-left text-text-tertiary font-medium tracking-[-0.3px] px-2 py-1.5">Letter ID</div>
							<div class="flex-[2] text-left text-text-tertiary font-medium tracking-[-0.3px] px-2 py-1.5">Letter name</div>
							<div class="flex-[3] text-left text-text-tertiary font-medium tracking-[-0.3px] px-2 py-1.5">Assigned order</div>
						</div>
						<div class="overflow-y-auto">
							{#each massFulfillRows as row (row.letterId)}
								{@const isAssigned = row.orderId !== null}
								{@const isExcluded = massFulfillExcluded.has(row.letterId)}
								<div
									class="flex items-center w-full text-sm border-b border-border-card last:border-b-0
										{isAssigned ? 'hover:bg-surface/50' : 'bg-yellow-500/5'}"
								>
									<div class="w-8 px-2 py-1.5 flex items-center justify-center">
										{#if isAssigned}
											<input
												type="checkbox"
												checked={!isExcluded}
												onchange={() => toggleMassFulfillExclusion(row.letterId)}
												class="cursor-pointer accent-accent"
											/>
										{:else}
											<div class="w-3.5 h-3.5 rounded-sm border border-border-input opacity-30"></div>
										{/if}
									</div>
									<div class="flex-[1.5] tracking-[-0.3px] px-2 py-1.5 truncate font-mono text-xs {isAssigned ? 'text-text-dim' : 'text-text-tertiary'}">{row.letterId}</div>
									<div class="flex-[2] tracking-[-0.3px] px-2 py-1.5 truncate {isAssigned ? 'text-text-primary' : 'text-text-tertiary'}">{row.letterName}</div>
									<button
										type="button"
										class="flex-[3] px-2 py-1 flex items-center gap-1.5 min-w-0 cursor-pointer text-left"
										data-order-cell
										onclick={(e) => openOrderPicker(row.letterId, e)}
									>
										{#if isAssigned}
											<span class="truncate text-text-primary tracking-[-0.3px]">{row.orderAddressName}</span>
											{#if row.orderAddressName !== row.orderUserName}
												<span class="shrink-0 text-text-tertiary text-xs truncate max-w-[100px]" title={row.orderUserName ?? ''}>{row.orderUserName}</span>
											{/if}
											<span class="shrink-0 text-text-tertiary font-mono text-xs">#{row.orderId}</span>
											{#if row.confidence === 'low'}
												<span class="shrink-0 px-1 py-0.5 text-[10px] font-medium rounded bg-yellow-500/15 text-yellow-600">fuzzy</span>
											{:else if row.confidence === 'medium'}
												<span class="shrink-0 px-1 py-0.5 text-[10px] font-medium rounded bg-yellow-500/10 text-yellow-600/80">~</span>
											{/if}
											<Pencil size={11} class="shrink-0 text-text-placeholder hover:text-text-dim" />
										{:else}
											<span class="text-text-placeholder italic text-xs">Click to assign...</span>
										{/if}
									</button>
								</div>
							{/each}
						</div>
					</div>
				</div>
				<div class="flex items-center justify-between px-5 py-4 border-t border-border-card">
					<span class="text-sm text-text-dim tracking-[-0.3px]">
						{massFulfillIncluded.length} of {massFulfillAssignedCount} assigned orders selected
					</span>
					<div class="flex items-center gap-2">
						<button
							class="px-3 py-1.5 text-sm font-medium text-text-dim hover:bg-surface rounded-tag cursor-pointer"
							onclick={closeMassFulfill}
						>
							Cancel
						</button>
						<button
							class="px-3 py-1.5 text-sm font-medium bg-accent text-white rounded-tag cursor-pointer hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
							disabled={massFulfillIncluded.length === 0}
							onclick={executeMassFulfill}
						>
							Fulfill ({massFulfillIncluded.length})
						</button>
					</div>
				</div>

			{:else if massFulfillStep === 'executing'}
				<div class="px-5 py-12 flex flex-col items-center gap-3">
					<Loader2 size={24} class="animate-spin text-accent" />
					<p class="text-sm text-text-dim tracking-[-0.3px]">Fulfilling {massFulfillIncluded.length} orders...</p>
				</div>

			{:else if massFulfillStep === 'done' && massFulfillResult}
				<div class="px-5 py-4 flex flex-col gap-3">
					<div class="flex items-start gap-2 px-3 py-2.5 bg-green-500/10 rounded-input">
						<Check size={14} class="text-green-600 shrink-0 mt-0.5" />
						<span class="text-sm text-text-primary tracking-[-0.3px]">
							{massFulfillResult.fulfilled} {massFulfillResult.fulfilled === 1 ? 'order' : 'orders'} marked as fulfilled
						</span>
					</div>
					{#if massFulfillResult.errors.length > 0}
						<div class="flex items-start gap-2 px-3 py-2.5 bg-red-500/10 rounded-input">
							<TriangleAlert size={14} class="text-red-500 shrink-0 mt-0.5" />
							<div class="flex flex-col gap-1">
								<span class="text-sm text-text-primary tracking-[-0.3px]">
									{massFulfillResult.errors.length} {massFulfillResult.errors.length === 1 ? 'order' : 'orders'} failed
								</span>
								<div class="flex flex-col gap-0.5">
									{#each massFulfillResult.errors as err (err.orderId)}
										<span class="text-xs text-text-dim tracking-[-0.2px]">
											<span class="text-text-tertiary font-mono">#{err.orderId}</span> {err.error}
										</span>
									{/each}
								</div>
							</div>
						</div>
					{/if}
				</div>
				<div class="flex items-center justify-end px-5 py-4 border-t border-border-card">
					<button
						class="px-3 py-1.5 text-sm font-medium bg-accent text-white rounded-tag cursor-pointer hover:opacity-90"
						onclick={closeMassFulfill}
					>
						Done
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}

{#if editingRowLetterId && massFulfillStep === 'preview'}
	<!-- Order picker dropdown (rendered outside modal to avoid clipping) -->
	<div
		data-order-picker
		class="fixed z-[60] bg-page border border-border-card rounded-input shadow-xl flex flex-col max-h-[280px]"
		style="top: {orderPickerPos.top}px; left: {orderPickerPos.left}px; width: {orderPickerPos.width}px"
	>
		<div class="px-2 py-2 border-b border-border-card">
			<div class="flex items-center gap-2 px-2 py-1 border border-border-input rounded-tag">
				<Search size={12} class="text-text-placeholder shrink-0" />
				<input
					bind:this={orderPickerSearchEl}
					bind:value={orderPickerSearch}
					placeholder="Search orders..."
					class="flex-1 bg-transparent text-sm outline-none placeholder:text-text-placeholder"
					onkeydown={(e) => { if (e.key === 'Escape') closeOrderPicker(); }}
				/>
			</div>
		</div>
		<div class="overflow-y-auto py-1">
			{#if editingRow?.orderId}
				<button
					class="w-full text-left px-3 py-1.5 text-sm hover:bg-surface cursor-pointer flex items-center gap-2 text-red-500/80"
					onclick={() => assignOrder(editingRowLetterId!, null)}
				>
					<Unlink size={12} class="shrink-0" />
					Unassign
				</button>
				<div class="border-t border-border-card my-1"></div>
			{/if}
			{#each filteredPickerOrders as order (order.id)}
				{@const isCurrentlyAssigned = assignedOrderIds.has(order.id)}
				{@const isThisRow = editingRow?.orderId === order.id}
				<button
					class="w-full text-left px-3 py-1.5 text-sm hover:bg-surface cursor-pointer flex items-center gap-2 {isThisRow ? 'bg-accent/10' : ''}"
					onclick={() => assignOrder(editingRowLetterId!, order)}
				>
					<span class="flex-1 min-w-0 truncate text-text-primary">{order.addressName}</span>
					{#if order.addressName !== order.userName}
						<span class="shrink-0 text-text-tertiary text-xs truncate max-w-[80px]" title={order.userName}>{order.userName}</span>
					{/if}
					<span class="shrink-0 text-text-tertiary font-mono text-xs">#{order.id}</span>
					{#if isThisRow}
						<Check size={12} class="shrink-0 text-accent" />
					{:else if isCurrentlyAssigned}
						<span class="shrink-0 px-1 py-0.5 text-[10px] font-medium rounded bg-surface text-text-tertiary">assigned</span>
					{/if}
				</button>
			{/each}
			{#if filteredPickerOrders.length === 0}
				<div class="px-3 py-3 text-sm text-text-tertiary text-center">No matching orders</div>
			{/if}
		</div>
	</div>
{/if}
