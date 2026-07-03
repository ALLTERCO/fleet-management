import {useDocumentVisibility, useIntervalFn} from '@vueuse/core';
import {computed, onUnmounted, ref, shallowRef, triggerRef, watch} from 'vue';
import {
    approveDeviceIngressEntry,
    type PendingDevice
} from '@/api/waitingRoomRpc';
import useInfiniteScroll from '@/composables/useInfiniteScroll';
import useWsRpc from '@/composables/useWsRpc';
import {
    WAITING_ROOM_ACCEPT_CHUNK_SIZE,
    WAITING_ROOM_ACCEPT_DEBOUNCE_MS,
    WAITING_ROOM_BULK_POLL_MAX_FAILURES,
    WAITING_ROOM_BULK_POLL_MS,
    WAITING_ROOM_BULK_THRESHOLD,
    WAITING_ROOM_REFRESH_MS
} from '@/constants';
import {formatMac} from '@/helpers/device';
import {toastRpcError} from '@/helpers/domainErrors';
import {useAuthStore} from '@/stores/auth';
import {useDevicesStore} from '@/stores/devices';
import {useToastStore} from '@/stores/toast';
import * as ws from '@/tools/websocket';
import {
    reconcileAcceptedDevices,
    removeWaitingRoomEntries,
    shouldPublishPendingCount
} from './waitingRoomLocalState';

/**
 * Shared state and behaviour for the Waiting Room Pending and Denied views.
 * Each view (route) calls this composable with its mode; the data fetch,
 * filter/search/pagination state, table model, and accept/reject actions
 * are kept in one place.
 */

export type WaitingRoomMode = 'pending' | 'denied';

// SSOT in @/api/waitingRoomRpc; re-exported for existing imports.
export type {PendingDevice};

type DeviceEntry = [string, PendingDevice];
type DeviceLookup = Record<string, PendingDevice>;

interface AcceptOutcome {
    success: string[];
    error: string[];
}

class AcceptChunkError extends Error {
    constructor(
        readonly outcome: AcceptOutcome,
        readonly cause: unknown
    ) {
        super('waiting-room accept chunk failed');
    }
}

interface AcceptRpcResult {
    success: Array<string | number>;
    error: Array<string | number>;
}

function isNumericId(id: string): boolean {
    const n = Number(id);
    return Number.isInteger(n) && n > 0;
}

// Only ids reported as error are kept; a legacy reply stays optimistic.
function readAcceptErrors(res: unknown): Set<string> {
    const r = (res ?? {}) as Partial<AcceptRpcResult>;
    return new Set((r.error ?? []).map(String));
}

function chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}

function partitionById(
    localIds: string[],
    error: Set<string>,
    outcome: AcceptOutcome,
    key: (id: string) => string
): void {
    for (const id of localIds) {
        const reported = String(key(id));
        if (error.has(reported)) outcome.error.push(id);
        else outcome.success.push(id);
    }
}

const RPC_METHOD: Record<WaitingRoomMode, string> = {
    pending: 'WaitingRoom.GetPending',
    denied: 'WaitingRoom.GetDenied'
};

const DEVICE_INGRESS_PREFIX = 'deviceIngress:';

const LINK_LABELS: Record<string, string> = {
    eth: 'Ethernet',
    wifi: 'Wi-Fi',
    none: 'No link'
};

export function useWaitingRoomList(mode: WaitingRoomMode) {
    const toast = useToastStore();
    const authStore = useAuthStore();
    const devicesStore = useDevicesStore();

    const {
        data: devices,
        loading,
        error,
        refresh
    } = useWsRpc<Record<string, PendingDevice>>(RPC_METHOD[mode]);

    // ── Local UI state ─────────────────────────────────────────────────
    const acceptingFlag = ref(false);
    const acceptingIds = shallowRef(new Set<string>());
    // Set while a bulk job runs: blocks a second job and disables accept.
    const bulkBusy = ref(false);
    const accepting = computed(() => acceptingFlag.value || bulkBusy.value);

    function markAccepting(ids: string[]): void {
        for (const id of ids) acceptingIds.value.add(id);
        triggerRef(acceptingIds);
        acceptingFlag.value = true;
    }

    function unmarkAccepting(ids: string[]): void {
        for (const id of ids) acceptingIds.value.delete(id);
        triggerRef(acceptingIds);
        if (acceptingIds.value.size === 0 && pendingAcceptIds.size === 0) {
            acceptingFlag.value = false;
        }
    }

    const selected = ref<string[]>([]);
    const view = ref<'cards' | 'table'>('cards');
    const nameFilter = ref('');
    const filterModalVisible = ref(false);
    const detailModalVisible = ref(false);
    const detailDeviceId = ref<string | null>(null);
    const selectedModels = ref<string[]>([]);
    const selectedGens = ref<string[]>([]);
    const selectedLinkTypes = ref<string[]>([]);
    const tableSortKey = ref('model');
    const tableSortAsc = ref(true);

    // ── Detail modal ───────────────────────────────────────────────────
    function openDetail(internalId: string) {
        detailDeviceId.value = internalId;
        detailModalVisible.value = true;
    }

    const detailDevice = computed<PendingDevice | null>(() => {
        if (!detailDeviceId.value) return null;
        return devices.value?.[detailDeviceId.value] ?? null;
    });

    // ── Helpers ────────────────────────────────────────────────────────
    function linkTypeOf(device: PendingDevice): 'eth' | 'wifi' | 'none' {
        const status = (device.status ?? {}) as Record<string, any>;
        const eth = status.eth as {ip?: string} | undefined;
        const wifi = status.wifi as {sta_ip?: string} | undefined;
        if (eth?.ip) return 'eth';
        if (wifi?.sta_ip) return 'wifi';
        return 'none';
    }

    // ── Filtering ──────────────────────────────────────────────────────
    const allEntries = computed<DeviceEntry[]>(() =>
        devices.value ? Object.entries(devices.value) : []
    );

    function passesFilter([, device]: DeviceEntry): boolean {
        const q = nameFilter.value.trim().toLowerCase();
        if (q && !device.shellyID.toLowerCase().includes(q)) return false;
        const sys = device.status?.sys as
            | {gen?: number; device?: {model?: string}}
            | undefined;
        const model = sys?.device?.model ?? '';
        if (
            selectedModels.value.length > 0 &&
            !selectedModels.value.includes(model)
        ) {
            return false;
        }
        if (selectedGens.value.length > 0) {
            const gen = sys?.gen != null ? String(sys.gen) : '';
            if (!selectedGens.value.includes(gen)) return false;
        }
        if (
            selectedLinkTypes.value.length > 0 &&
            !selectedLinkTypes.value.includes(linkTypeOf(device))
        ) {
            return false;
        }
        return true;
    }

    const filteredEntries = computed(() =>
        allEntries.value.filter(passesFilter)
    );

    // Filter sections only offer values present in the visible set. All
    // device facts come from sys.* — no parsing of the shellyID.
    const availableModels = computed(() => {
        const set = new Set<string>();
        for (const [, d] of allEntries.value) {
            const m = (d.status?.sys as {device?: {model?: string}} | undefined)
                ?.device?.model;
            if (m) set.add(m);
        }
        return [...set].sort();
    });
    const availableGens = computed(() => {
        const set = new Set<string>();
        for (const [, d] of allEntries.value) {
            const g = (d.status?.sys as {gen?: number} | undefined)?.gen;
            if (g != null) set.add(String(g));
        }
        return [...set].sort();
    });
    const availableLinkTypes = computed(() => {
        const set = new Set<string>();
        for (const [, d] of allEntries.value) {
            set.add(linkTypeOf(d));
        }
        return [...set];
    });

    const filterSections = computed(() => [
        {
            key: 'model',
            label: 'Model',
            icon: 'fa-microchip',
            options: availableModels.value.map((m) => ({key: m, label: m}))
        },
        {
            key: 'gen',
            label: 'Generation',
            icon: 'fa-layer-group',
            options: availableGens.value.map((g) => ({
                key: g,
                label: `Gen ${g}`
            }))
        },
        {
            key: 'link',
            label: 'Connectivity',
            icon: 'fa-network-wired',
            options: availableLinkTypes.value.map((l) => ({
                key: l,
                label: LINK_LABELS[l] ?? l
            }))
        }
    ]);

    const activeFilterState = computed(() => ({
        model: selectedModels.value,
        gen: selectedGens.value,
        link: selectedLinkTypes.value
    }));

    const filterCount = computed(
        () =>
            selectedModels.value.length +
            selectedGens.value.length +
            selectedLinkTypes.value.length
    );

    function applyFilters(state: Record<string, string[]>) {
        selectedModels.value = state.model ?? [];
        selectedGens.value = state.gen ?? [];
        selectedLinkTypes.value = state.link ?? [];
    }

    // ── Pagination ────────────────────────────────────────────────────
    const {
        items: paginatedItems,
        page,
        totalPages,
        loadItems
    } = useInfiniteScroll(filteredEntries);
    const hasMorePages = computed(() => page.value < totalPages.value);

    // ── Selection ─────────────────────────────────────────────────────
    const selectedSet = computed(() => new Set(selected.value));

    const allSelected = computed(
        () =>
            allEntries.value.length > 0 &&
            selected.value.length === allEntries.value.length
    );

    function toggleSelectAll() {
        if (allSelected.value) selected.value = [];
        else selected.value = allEntries.value.map(([id]) => id);
    }

    function clearSelection() {
        selected.value = [];
    }

    function deviceClicked(id: string) {
        const idx = selected.value.indexOf(id);
        if (idx >= 0) selected.value.splice(idx, 1);
        else selected.value.push(id);
    }

    // ── Table model ───────────────────────────────────────────────────
    interface TableRow {
        internalId: string;
        shellyID: string;
        model: string;
        title: string;
        gen: number | undefined;
        ip: string;
        mac: string;
        ssid: string;
        firmware: string;
        rssi: number | null;
        cloudConnected: boolean;
        authEnabled: boolean;
    }

    function extractRow([internalId, device]: DeviceEntry): TableRow {
        const status = (device.status ?? {}) as Record<string, any>;
        const wifi = status.wifi as
            | {sta_ip?: string; ssid?: string; rssi?: number}
            | undefined;
        const eth = status.eth as {ip?: string} | undefined;
        const sys = status.sys as
            | {
                  mac?: string;
                  ver?: string;
                  gen?: number;
                  app?: string;
                  device?: {name?: string; model?: string};
              }
            | undefined;
        const cloud = status.cloud as {connected?: boolean} | undefined;
        const deviceName = sys?.device?.name?.trim() ?? '';
        const model = sys?.device?.model ?? '';
        const app = sys?.app ?? '';
        return {
            internalId,
            shellyID: device.shellyID,
            model,
            title: deviceName || app || model || device.shellyID,
            gen: sys?.gen,
            ip: eth?.ip || wifi?.sta_ip || '',
            mac: formatMac(sys?.mac ?? ''),
            ssid: wifi?.ssid || '',
            firmware: sys?.ver ?? '',
            rssi: typeof wifi?.rssi === 'number' ? wifi.rssi : null,
            cloudConnected: cloud?.connected === true,
            authEnabled: status.auth_en === true
        };
    }

    const tableRows = computed<TableRow[]>(() => {
        const rows = filteredEntries.value.map(extractRow);
        const key = tableSortKey.value as keyof TableRow;
        const asc = tableSortAsc.value;
        rows.sort((a, b) => {
            const av = a[key] as string | number | null;
            const bv = b[key] as string | number | null;
            if (av == null && bv == null) return 0;
            if (av == null) return asc ? 1 : -1;
            if (bv == null) return asc ? -1 : 1;
            if (av === bv) return 0;
            return asc ? (av > bv ? 1 : -1) : av > bv ? -1 : 1;
        });
        return rows;
    });

    function tableToggleSort(key: string) {
        if (tableSortKey.value === key) {
            tableSortAsc.value = !tableSortAsc.value;
        } else {
            tableSortKey.value = key;
            tableSortAsc.value = true;
        }
    }

    // ── Actions ───────────────────────────────────────────────────────

    function publishPendingCount(map: Record<string, PendingDevice>): void {
        if (!shouldPublishPendingCount(mode)) return;
        authStore.updateWaitingRoom(
            Object.keys(map).length,
            map as Record<string, unknown>
        );
    }

    function removeLocalEntries(ids: string[]) {
        if (!devices.value) return;
        devices.value = removeWaitingRoomEntries(devices.value, ids).devices;
    }

    // Device data is read from a per-call snapshot (rows are already gone), so
    // overlapping accepts can't clobber a shared lookup.
    function splitAcceptTargets(ids: string[], lookup: DeviceLookup) {
        const internalIds: number[] = [];
        const externalIds: string[] = [];
        for (const id of ids) {
            const numericId = Number(id);
            if (Number.isInteger(numericId) && numericId > 0) {
                internalIds.push(numericId);
            } else {
                const shellyID = lookup[id]?.shellyID || id;
                externalIds.push(shellyID);
            }
        }
        return {internalIds, externalIds};
    }

    // Rows are removed optimistically before this runs; here we only collect
    // the per-chunk {success, error} so the caller can restore failures.
    async function acceptTargets(
        ids: string[],
        lookup: DeviceLookup
    ): Promise<AcceptOutcome> {
        const merged: AcceptOutcome = {success: [], error: []};
        for (const batch of chunk(ids, WAITING_ROOM_ACCEPT_CHUNK_SIZE)) {
            try {
                const outcome = await acceptBatch(batch, lookup);
                merged.success.push(...outcome.success);
                merged.error.push(...outcome.error);
            } catch (e) {
                merged.error.push(...batch);
                throw new AcceptChunkError(merged, e);
            }
        }
        return merged;
    }

    // Snapshot entries before an optimistic removal so failures can be
    // restored without a round-trip.
    function snapshotEntries(ids: string[]): Record<string, PendingDevice> {
        const snap: Record<string, PendingDevice> = {};
        for (const id of ids) {
            const device = devices.value?.[id];
            if (device) snap[id] = device;
        }
        return snap;
    }

    function restoreEntries(
        snap: Record<string, PendingDevice>,
        ids: string[]
    ): void {
        if (!devices.value) return;
        const restored = {...devices.value};
        for (const id of ids) {
            if (snap[id]) restored[id] = snap[id];
        }
        devices.value = restored;
    }

    // Optimistic accept: drop the rows (and badge) now, send in the background,
    // restore only what the backend rejects. The UI never waits on the admit.
    // Show accepted devices in the fleet now; runs before removeLocalEntries
    // (which reads the entries).
    function optimisticOnboard(ids: string[]): void {
        const lookup = devices.value ?? {};
        for (const id of ids) {
            const entry = lookup[id];
            if (entry?.shellyID) {
                devicesStore.addOptimisticDevice(entry.shellyID, entry.status);
            }
        }
    }

    async function acceptOptimistic(ids: string[]): Promise<void> {
        if (ids.length === 0) return;
        const snap = snapshotEntries(ids);
        optimisticOnboard(ids);
        removeLocalEntries(ids);
        markAccepting(ids);
        try {
            const outcome = await acceptTargets(ids, snap);
            if (outcome.error.length > 0) {
                restoreEntries(snap, outcome.error);
                toast.error(
                    `Could not accept ${outcome.error.length} device(s) — already accepted elsewhere or no longer connected.`
                );
            }
            // No immediate refresh — it can resurrect a row mid-admit; the WS
            // update / interval re-syncs.
            await reconcileAcceptedDevices(devicesStore);
        } catch (e) {
            // Restore every id not confirmed accepted (failed chunk + un-run
            // chunks) so no removed row is silently dropped.
            const accepted =
                e instanceof AcceptChunkError
                    ? new Set(e.outcome.success)
                    : new Set<string>();
            restoreEntries(
                snap,
                ids.filter((id) => !accepted.has(id))
            );
            handleAcceptError(e, 'Failed to accept devices');
        } finally {
            unmarkAccepting(ids);
        }
    }

    // deviceIngress entries can't go through the legacy accept; each is approved
    // via its own RPC. The profile is optional — the backend defaults to the
    // device's connected security, so a plain "allow" always works.
    // Returns the per-id split so callers drop only what was accepted.
    async function acceptBatch(
        ids: string[],
        lookup: DeviceLookup
    ): Promise<AcceptOutcome> {
        const ingressIds = ids.filter((id) =>
            id.startsWith(DEVICE_INGRESS_PREFIX)
        );
        const legacyIds = ids.filter(
            (id) => !id.startsWith(DEVICE_INGRESS_PREFIX)
        );

        const outcome: AcceptOutcome = {success: [], error: []};
        await acceptLegacyTargets(legacyIds, outcome, lookup);
        await acceptIngressTargets(ingressIds, outcome, lookup);
        return outcome;
    }

    async function acceptLegacyTargets(
        legacyIds: string[],
        outcome: AcceptOutcome,
        lookup: DeviceLookup
    ): Promise<void> {
        const {internalIds, externalIds} = splitAcceptTargets(
            legacyIds,
            lookup
        );
        if (internalIds.length > 0) {
            const res = await ws.sendRPC(
                'FLEET_MANAGER',
                'WaitingRoom.AcceptPendingById',
                {ids: internalIds}
            );
            mergeNumericOutcome(legacyIds, res, outcome);
        }
        if (externalIds.length > 0) {
            const res = await ws.sendRPC(
                'FLEET_MANAGER',
                'WaitingRoom.AcceptPendingByExternalId',
                {externalIds}
            );
            mergeExternalOutcome(legacyIds, res, outcome, lookup);
        }
    }

    // The numeric accept reports DB ids; map them back to the local entry key.
    function mergeNumericOutcome(
        legacyIds: string[],
        res: unknown,
        outcome: AcceptOutcome
    ): void {
        const error = readAcceptErrors(res);
        const numericIds = legacyIds.filter((id) => isNumericId(id));
        partitionById(numericIds, error, outcome, (id) => id);
    }

    // The external accept reports shellyIDs; resolve each back to its entry key.
    function mergeExternalOutcome(
        legacyIds: string[],
        res: unknown,
        outcome: AcceptOutcome,
        lookup: DeviceLookup
    ): void {
        const error = readAcceptErrors(res);
        const externalIds = legacyIds.filter((id) => !isNumericId(id));
        partitionById(
            externalIds,
            error,
            outcome,
            (id) => lookup[id]?.shellyID || id
        );
    }

    async function acceptIngressTargets(
        ingressIds: string[],
        outcome: AcceptOutcome,
        lookup: DeviceLookup
    ): Promise<void> {
        for (const id of ingressIds) {
            try {
                await approveDeviceIngressEntry(
                    id.slice(DEVICE_INGRESS_PREFIX.length),
                    lookup[id]?.profileId ?? undefined
                );
                outcome.success.push(id);
            } catch {
                outcome.error.push(id);
            }
        }
    }

    // Per-row clicks coalesced into one bulk accept.
    const pendingAcceptIds = new Set<string>();
    let acceptFlushTimer: ReturnType<typeof setTimeout> | null = null;

    // Active bulk-accept job, or null when none is running.
    const bulkJob = ref<{
        jobId: string;
        total: number;
        processed: number;
        accepted: number;
        failed: string[];
        state: 'running' | 'done' | 'canceled' | 'error';
    } | null>(null);
    type BulkStatus = NonNullable<typeof bulkJob.value>;
    let bulkPollTimer: ReturnType<typeof setTimeout> | null = null;
    let bulkSnapshot: Record<string, PendingDevice> = {};
    // shellyID -> entry key, used to restore failed rows.
    let bulkKeyByShelly = new Map<string, string>();

    function acceptDevice(id: string) {
        pendingAcceptIds.add(id);
        markAccepting([id]);
        if (acceptFlushTimer) clearTimeout(acceptFlushTimer);
        acceptFlushTimer = setTimeout(
            flushPendingAccepts,
            WAITING_ROOM_ACCEPT_DEBOUNCE_MS
        );
    }

    async function flushPendingAccepts() {
        acceptFlushTimer = null;
        const ids = [...pendingAcceptIds];
        pendingAcceptIds.clear();
        await acceptByCount(ids);
    }

    // Every accept routes here: background job above the threshold, no overlap.
    async function acceptByCount(ids: string[]): Promise<void> {
        if (ids.length === 0) return;
        if (bulkBusy.value) {
            toast.warning(
                'A bulk accept is already running — wait for it to finish or cancel it.'
            );
            return;
        }
        if (ids.length <= WAITING_ROOM_BULK_THRESHOLD) {
            await acceptOptimistic(ids);
        } else {
            await acceptViaJob(ids);
        }
    }

    // Large batches: background job with optimistic remove + progress polling.
    async function acceptViaJob(ids: string[]): Promise<void> {
        if (ids.length === 0) return;
        // Job accepts by shellyID; keep a reverse map to restore failures.
        const lookup = devices.value ?? {};
        const externalIds: string[] = [];
        const keyByShelly = new Map<string, string>();
        for (const id of ids) {
            const shellyID = lookup[id]?.shellyID;
            if (!shellyID) continue;
            externalIds.push(shellyID);
            keyByShelly.set(shellyID, id);
        }
        if (externalIds.length === 0) return;

        bulkBusy.value = true;
        bulkSnapshot = snapshotEntries(ids);
        bulkKeyByShelly = keyByShelly;
        optimisticOnboard(ids);
        removeLocalEntries(ids);
        try {
            const {jobId, total} = await ws.sendRPC<{
                jobId: string;
                total: number;
            }>('FLEET_MANAGER', 'WaitingRoom.AcceptBulkStart', {externalIds});
            bulkJob.value = {
                jobId,
                total,
                processed: 0,
                accepted: 0,
                failed: [],
                state: 'running'
            };
            pollBulkJob(jobId);
        } catch (e) {
            // Start failed; restore every row.
            restoreEntries(bulkSnapshot, ids);
            bulkSnapshot = {};
            bulkKeyByShelly = new Map();
            bulkBusy.value = false;
            toastRpcError(toast, e, 'Failed to start bulk accept');
        }
    }

    // Server resolves every open entry — independent of what's paged in.
    async function acceptAllPending(): Promise<void> {
        if (bulkBusy.value) {
            toast.warning(
                'A bulk accept is already running — wait for it to finish or cancel it.'
            );
            return;
        }
        const allIds = allEntries.value.map(([id]) => id);
        if (allIds.length === 0) return;
        const lookup = devices.value ?? {};
        const keyByShelly = new Map<string, string>();
        for (const id of allIds) {
            const shellyID = lookup[id]?.shellyID;
            if (shellyID) keyByShelly.set(shellyID, id);
        }
        bulkBusy.value = true;
        bulkSnapshot = snapshotEntries(allIds);
        bulkKeyByShelly = keyByShelly;
        optimisticOnboard(allIds);
        removeLocalEntries(allIds);
        try {
            const {jobId, total} = await ws.sendRPC<{
                jobId: string;
                total: number;
            }>('FLEET_MANAGER', 'WaitingRoom.AcceptAllStart', {});
            bulkJob.value = {
                jobId,
                total,
                processed: 0,
                accepted: 0,
                failed: [],
                state: 'running'
            };
            pollBulkJob(jobId);
        } catch (e) {
            restoreEntries(bulkSnapshot, allIds);
            bulkSnapshot = {};
            bulkKeyByShelly = new Map();
            bulkBusy.value = false;
            toastRpcError(toast, e, 'Failed to start accept-all');
        }
    }

    function pollBulkJob(jobId: string, failures = 0): void {
        if (bulkPollTimer) clearTimeout(bulkPollTimer);
        bulkPollTimer = setTimeout(async () => {
            try {
                const status = await ws.sendRPC<BulkStatus>(
                    'FLEET_MANAGER',
                    'WaitingRoom.AcceptBulkStatus',
                    {jobId}
                );
                bulkJob.value = status;
                if (status.state === 'running') {
                    pollBulkJob(jobId); // success resets the failure count
                } else {
                    await finalizeBulkJob(status);
                }
            } catch (e) {
                // Transient poll failures: retry before giving up.
                if (failures + 1 < WAITING_ROOM_BULK_POLL_MAX_FAILURES) {
                    pollBulkJob(jobId, failures + 1);
                    return;
                }
                // Gave up: restore rows, let refresh reconcile.
                toastRpcError(toast, e, 'Lost track of the bulk accept job');
                restoreEntries(bulkSnapshot, Object.keys(bulkSnapshot));
                bulkSnapshot = {};
                bulkKeyByShelly = new Map();
                bulkBusy.value = false;
                bulkJob.value = null;
                refresh();
            }
        }, WAITING_ROOM_BULK_POLL_MS);
    }

    // Job finished (done / canceled / error): restore the rows that weren't
    // accepted, re-sync the list + badge, and hide the progress UI.
    async function finalizeBulkJob(status: BulkStatus): Promise<void> {
        // Restore non-accepted rows; refresh prunes the accepted. On done that's
        // the failures; on cancel/error the whole snapshot (remainder included).
        if (status.state === 'done') {
            const failedKeys = status.failed
                .map((shellyID) => bulkKeyByShelly.get(shellyID))
                .filter((key): key is string => typeof key === 'string');
            if (failedKeys.length > 0) {
                restoreEntries(bulkSnapshot, failedKeys);
            }
        } else {
            restoreEntries(bulkSnapshot, Object.keys(bulkSnapshot));
        }
        bulkSnapshot = {};
        bulkKeyByShelly = new Map();
        bulkBusy.value = false;
        if (status.state === 'error') {
            toast.error(
                'Bulk accept failed — you can hit Accept again to retry.'
            );
        } else if (status.state === 'canceled') {
            toast.info(
                `Bulk accept canceled — accepted ${status.accepted} before stopping.`
            );
        }
        refresh(); // reconciles list + badge
        await reconcileAcceptedDevices(devicesStore);
        bulkJob.value = null;
    }

    // Just requests cancel; the next poll finalizes.
    async function cancelBulkJob(): Promise<void> {
        const jobId = bulkJob.value?.jobId;
        if (!jobId) return;
        try {
            const {canceled} = await ws.sendRPC<{canceled: boolean}>(
                'FLEET_MANAGER',
                'WaitingRoom.AcceptBulkCancel',
                {jobId}
            );
            if (canceled) {
                toast.info('Canceling — stopping after the current batch…');
            } else {
                toast.warning('Could not cancel — the job already finished.');
            }
        } catch (e) {
            toastRpcError(toast, e, 'Failed to cancel bulk accept');
        }
    }

    function handleAcceptError(e: unknown, fallback: string): void {
        if (e instanceof AcceptChunkError) {
            refresh();
            void reconcileAcceptedDevices(devicesStore);
        }
        toastRpcError(
            toast,
            e instanceof AcceptChunkError ? e.cause : e,
            fallback
        );
    }

    async function rejectDevice(internalId: string) {
        const device = devices.value?.[internalId];
        const shellyID = device?.shellyID || internalId;
        try {
            await ws.sendRPC('FLEET_MANAGER', 'WaitingRoom.RejectPending', {
                shellyIDs: [shellyID]
            });
            removeLocalEntries([internalId]);
            refresh();
        } catch (e) {
            toastRpcError(toast, e, 'Failed to reject device');
        }
    }

    function idsToActOn(): string[] {
        if (selected.value.length > 0) return selected.value;
        return allEntries.value.map(([id]) => id);
    }

    async function handleAccept() {
        // Everything selected → let the server accept every pending device,
        // robust to pagination/stale lists.
        if (allSelected.value) {
            selected.value = [];
            await acceptAllPending();
            return;
        }
        const ids = idsToActOn();
        if (ids.length === 0) return;
        selected.value = [];
        await acceptByCount(ids);
    }

    async function handleReject() {
        const ids = idsToActOn();
        const shellyIDs = ids
            .map((id) => devices.value?.[id]?.shellyID)
            .filter((value): value is string => typeof value === 'string');
        if (shellyIDs.length === 0) return;
        loading.value = true;
        try {
            await ws.sendRPC('FLEET_MANAGER', 'WaitingRoom.RejectPending', {
                shellyIDs
            });
            removeLocalEntries(ids);
            selected.value = [];
            refresh();
        } catch (e) {
            toastRpcError(toast, e, 'Failed to reject devices');
        } finally {
            loading.value = false;
        }
    }

    // Single place the badge is published: any change to the live list —
    // optimistic remove/restore or a server refresh. Sync so it lands at once.
    if (shouldPublishPendingCount(mode)) {
        watch(
            devices,
            (d) => {
                if (d) publishPendingCount(d);
            },
            {flush: 'sync'}
        );
    }

    // Auto-refresh while page visible. Interval is configurable via
    // runtime config / VITE_WAITING_ROOM_REFRESH_MS / default.
    const visibility = useDocumentVisibility();
    const offWaitingRoomUpdated = ws.onWaitingRoomUpdated(() => {
        if (visibility.value === 'visible') refresh();
    });
    useIntervalFn(() => {
        if (visibility.value === 'visible') refresh();
    }, WAITING_ROOM_REFRESH_MS);
    onUnmounted(() => {
        offWaitingRoomUpdated();
        if (acceptFlushTimer) clearTimeout(acceptFlushTimer);
        if (bulkPollTimer) clearTimeout(bulkPollTimer);
    });

    const isAccepting = (id: string) => acceptingIds.value.has(id);

    return {
        // data
        devices,
        loading,
        error,
        refresh,
        accepting,
        acceptingIds,
        isAccepting,
        // bulk accept job
        bulkJob,
        cancelBulkJob,
        // selection
        selected,
        selectedSet,
        allSelected,
        toggleSelectAll,
        clearSelection,
        deviceClicked,
        // filters / search
        nameFilter,
        filterModalVisible,
        filterSections,
        activeFilterState,
        filterCount,
        applyFilters,
        // detail modal
        detailModalVisible,
        detailDeviceId,
        detailDevice,
        openDetail,
        // view toggle
        view,
        // entries
        allEntries,
        filteredEntries,
        // pagination
        paginatedItems,
        hasMorePages,
        loadItems,
        // table
        tableRows,
        tableSortKey,
        tableSortAsc,
        tableToggleSort,
        // actions
        acceptDevice,
        flushPendingAccepts,
        rejectDevice,
        handleAccept,
        handleReject
    };
}

export type WaitingRoomTableRow = ReturnType<
    typeof useWaitingRoomList
>['tableRows']['value'][number];

export type WaitingRoomListState = ReturnType<typeof useWaitingRoomList>;
