<template>
    <PageTemplate
        fill
        title="Audit Log"
        :tabs="monitoringTabs"
        searchable
        search-placeholder="Username or shellyID…"
        v-model:search="filters.searchText"
        :filterable="true"
        :has-active-filter="activeFilterCount > 0"
        :filter-count="activeFilterCount"
        @filter-click="filterModalVisible = true"
    >
        <template #actions>
            <Button
                type="blue"
                size="sm"
                :loading="auditLog.searching"
                :disabled="!isValid"
                @click="runSearch(true)"
            >
                Search
            </Button>
            <Button
                type="blue-hollow"
                size="sm"
                :loading="auditLog.exporting"
                :disabled="!canExport"
                @click="generateExport"
            >
                Generate CSV Export
            </Button>
        </template>

        <div class="audit-content">
            <section>
                <Alert
                    v-if="shownCallId"
                    type="info"
                    icon="fas fa-robot"
                    title="One AI tool call"
                    data-testid="audit-call-view"
                >
                    Every row this call wrote, at any time.
                    <template #action>
                        <Button type="blue-hollow" size="sm" @click="leaveCallView">
                            Back to the full log
                        </Button>
                    </template>
                </Alert>

                <div v-if="auditLog.searchError" class="audit-alert audit-alert--danger" role="alert">
                    {{ auditLog.searchError }}
                </div>

                <div v-if="rows.length" class="audit-table-wrap">
                    <DataList
                        :rows="sortedRows"
                        :columns="auditColumns"
                        row-key="id"
                        :sort-key="sortKey"
                        :sort-asc="sortAsc"
                        clickable
                        @sort="onSort"
                        @row-click="onRowClick"
                    >
                        <template #cell-ts="{row}">
                            <span class="audit-mono">{{ formatTimestamp(row.ts) }}</span>
                        </template>
                        <template #cell-username="{row}">
                            <span
                                v-if="row.username && SENTINEL_ACTORS.has(row.username)"
                                class="audit-user-system"
                            >{{ row.username }}</span>
                            <template v-else>{{ row.username ?? '—' }}</template>
                            <span
                                v-if="row.agent_key_id"
                                class="audit-agent-badge"
                                :title="`AI key ${row.agent_key_id}`"
                                data-testid="audit-agent-badge"
                            >
                                <i class="fas fa-robot" aria-hidden="true" />
                                AI key
                            </span>
                        </template>
                        <template #cell-device="{row}">
                            <span :title="deviceLabel(row).allIds?.join('\n')">
                                <template v-if="deviceLabel(row).id">
                                    <div v-if="deviceLabel(row).name" class="audit-device-name">
                                        {{ deviceLabel(row).name }}
                                    </div>
                                    <div class="audit-device-id audit-mono">
                                        {{ deviceLabel(row).id }}
                                    </div>
                                </template>
                                <template v-else>—</template>
                            </span>
                        </template>
                        <template #cell-success="{row}">
                            <span :class="row.success ? 'audit-ok' : 'audit-fail'">
                                {{ row.success ? 'yes' : 'no' }}
                            </span>
                        </template>
                        <template #cell-detail="{row}">
                            <div v-if="row.error_message" class="audit-error-text">
                                {{ row.error_message }}
                            </div>
                            <Button
                                v-if="canOpenCallFromRow(row)"
                                type="blue-hollow"
                                size="xs"
                                :aria-label="`Show everything this AI call did: ${row.method ?? 'tool call'}`"
                                data-testid="audit-open-call"
                                @click.stop="openCall(row)"
                                @keydown.enter.stop
                            >
                                Show this call
                            </Button>
                            <span v-else-if="!row.error_message && row.params" class="audit-detail-hint">
                                Click row for params
                            </span>
                        </template>
                    </DataList>

                    <div class="audit-pagination">
                        <span class="audit-pagination__count">
                            showing {{ rows.length }} rows (offset {{ offset }})
                        </span>
                        <div class="audit-pagination__buttons">
                            <Button
                                type="blue-hollow"
                                size="sm"
                                :disabled="offset === 0 || auditLog.searching"
                                @click="prevPage"
                            >
                                Previous
                            </Button>
                            <Button
                                type="blue-hollow"
                                size="sm"
                                :disabled="!hasMore || auditLog.searching"
                                @click="nextPage"
                            >
                                Next
                            </Button>
                        </div>
                    </div>
                </div>
                <EmptyBlock v-else-if="hasSearched && !auditLog.searching">
                    <p class="dp-empty-title">No rows match the filters</p>
                    <p class="dp-empty-sub">Try widening the date range or clearing some filters.</p>
                </EmptyBlock>
                <EmptyBlock v-else-if="!hasSearched && !auditLog.searching">
                    <template #icon>
                        <i class="fas fa-clipboard-list" />
                    </template>
                    <p class="dp-empty-title">Search the audit log</p>
                    <p class="dp-empty-sub">Set your date range and event types in the filter, then press Search.</p>
                </EmptyBlock>
            </section>

            <!-- Export status — appears inline when an export is ready or failed. -->
            <section v-if="downloadInfo || exportMessage" class="audit-export-status">
                <div v-if="downloadInfo" class="audit-alert audit-alert--success">
                    <p>Export ready! ({{ downloadInfo.rows }} records)</p>
                    <Button
                        type="blue-hollow"
                        size="sm"
                        :loading="auditLog.downloading"
                        @click="downloadExport"
                    >
                        Download {{ downloadInfo.filename }}
                    </Button>
                    <p class="audit-export-status__note">
                        File auto-deletes after 1 hour.
                    </p>
                </div>
                <div v-if="exportMessage" class="audit-alert audit-alert--danger" role="alert">
                    {{ exportMessage }}
                </div>
            </section>
        </div>

        <template #modals>
            <FilterModal
                :visible="filterModalVisible"
                :sections="filterSections"
                :initial-state="modalState"
                :match-count="rows.length"
                match-label="rows"
                title="Audit Log Filters"
                @close="filterModalVisible = false"
                @apply-generic="applyFilterState"
            >
                <template #extra>
                    <DateRangeFilter v-model="dateRangeModel" label="Date range" />
                    <Input
                        v-model="filters.agentKeyId"
                        label="AI key id"
                        placeholder="Only rows from this key"
                        :maxlength="AGENT_KEY_ID_MAX_LENGTH"
                        clear
                    />
                    <Input
                        v-model="filters.correlationId"
                        label="AI call id"
                        placeholder="Every row from one AI tool call"
                        :maxlength="CORRELATION_ID_MAX_LENGTH"
                        clear
                    />
                </template>
            </FilterModal>

            <Modal :visible="!!detailRow" @close="detailRow = null">
                <template #title>Audit Entry</template>
                <JSONViewer v-if="detailRow" :data="detailRow as unknown as object" />
                <template #footer>
                    <div class="audit-detail-actions">
                        <Button
                            v-if="detailRow?.correlation_id"
                            type="blue-hollow"
                            size="sm"
                            data-testid="audit-detail-open-call"
                            @click="openCall(detailRow)"
                        >
                            Show this call
                        </Button>
                        <Button
                            v-if="detailRow?.agent_key_id"
                            type="blue-hollow"
                            size="sm"
                            data-testid="audit-detail-filter-key"
                            @click="filterByKey(detailRow)"
                        >
                            Show all from this key
                        </Button>
                        <Button type="blue-hollow" size="sm" @click="detailRow = null">Close</Button>
                    </div>
                </template>
            </Modal>
        </template>
    </PageTemplate>
</template>

<script setup lang="ts">
import {
    AGENT_KEY_ID_MAX_LENGTH,
    AUDIT_EVENT_LABELS,
    AUDIT_EVENT_TYPES,
    type AuditEventType,
    CORRELATION_ID_MAX_LENGTH
} from '@api/audit';
import {SENTINEL_ACTORS} from '@api/auditActors';
import {type ComputedRef, computed, inject, reactive, ref} from 'vue';
import Alert from '@/components/core/Alert.vue';
import Button from '@/components/core/Button.vue';
import DataList, {type DataColumn} from '@/components/core/DataList.vue';
import DateRangeFilter from '@/components/core/DateRangeFilter.vue';
import EmptyBlock from '@/components/core/EmptyBlock.vue';
import FilterModal, {
    type FilterSection,
    type FilterState
} from '@/components/core/FilterModal.vue';
import Input from '@/components/core/Input.vue';
import JSONViewer from '@/components/core/JSONViewer.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import Modal from '@/components/modals/Modal.vue';
import {AUDIT_PAGE_SIZE} from '@/constants';
import {formatTime} from '@/helpers/format';
import {
    type AuditExportResponse,
    type AuditQueryRow,
    type AuditSearch,
    useAuditLogStore
} from '@/stores/auditLog';
import {useDevicesStore} from '@/stores/devices';
import {useUsersStore} from '@/stores/users';
import type {RouteTab} from '@/types/page-template';

const monitoringTabs = inject<ComputedRef<RouteTab[]>>('monitoringTabs');

const auditLog = useAuditLogStore();
auditLog.clearMessages();

const auditColumns: DataColumn<AuditQueryRow>[] = [
    {key: 'ts', label: 'Time', role: 'meta', mono: true, sortable: true},
    {key: 'event_type', label: 'Event', role: 'primary', sortable: true},
    {key: 'username', label: 'User', role: 'secondary', sortable: true},
    {key: 'device', label: 'Device', role: 'meta'},
    {key: 'method', label: 'Method', role: 'meta', mono: true, sortable: true, accessor: (r) => r.method ?? '—'},
    {key: 'success', label: 'Success', role: 'status', align: 'center', sortable: true},
    {key: 'detail', label: 'Error / Params', role: 'meta'}
];

// The backend's own list, so a new event type (AI tool calls) is never left out.
const EVENT_TYPE_OPTIONS = AUDIT_EVENT_TYPES.map((key) => ({
    key,
    label: AUDIT_EVENT_LABELS[key]
}));

function isAuditEventType(value: string): value is AuditEventType {
    return (AUDIT_EVENT_TYPES as readonly string[]).includes(value);
}

const SEVERITY_OPTIONS = [
    {key: 'successful', label: 'Successful'},
    {key: 'failed', label: 'Failed'}
] as const;

const SOURCE_OPTIONS = [
    {key: 'system', label: 'System Audit'},
    {key: 'authz', label: 'Authz Audit'}
] as const;

const DEFAULT_EVENT_TYPES = EVENT_TYPE_OPTIONS.map((o) => o.key);
const DEFAULT_SEVERITY = SEVERITY_OPTIONS.map((o) => o.key);
const DEFAULT_SOURCES = SOURCE_OPTIONS.map((o) => o.key);

const filters = reactive({
    from: '',
    to: '',
    searchText: '',
    sources: [...DEFAULT_SOURCES] as string[],
    eventTypes: [...DEFAULT_EVENT_TYPES] as string[],
    severity: [...DEFAULT_SEVERITY] as string[],
    users: [] as string[],
    devices: [] as string[],
    methods: [] as string[],
    agentKeyId: '',
    correlationId: ''
});
const filterModalVisible = ref(false);

// Bridge filters.from / filters.to (ISO strings) ↔ DateRangeFilter v-model object.
const dateRangeModel = computed<{from: string; to: string}>({
    get: () => ({from: filters.from, to: filters.to}),
    set: (val) => {
        filters.from = val.from;
        filters.to = val.to;
    }
});

// User options — hybrid source. The Zitadel store works in production (full
// account list available before any search), and rows.value picks up names
// that appear in dev mode (where Zitadel is disabled and the store stays empty).
const usersStore = useUsersStore();
const userOptions = computed(() => {
    const seen = new Set<string>();
    for (const u of usersStore.users) {
        const name = u.userName || u.email || u.userId;
        if (name) seen.add(name);
    }
    for (const row of rows.value) {
        if (row.username) seen.add(row.username);
    }
    return Array.from(seen)
        .sort()
        .map((u) => ({key: u, label: u}));
});

// Device options — full known list from the device store, available upfront.
const deviceOptions = computed(() =>
    Object.values(devicesStore.devices)
        .map((d: any) => ({
            key: (d.shellyID || d.id) as string,
            label:
                devicesStore.getDeviceName(d.shellyID || d.id) ||
                (d.shellyID || d.id)
        }))
        .filter((opt) => !!opt.key)
        .sort((a, b) => a.label.localeCompare(b.label))
);

// Method options — populated dynamically from loaded rows (no central registry of every
// possible RPC method). Empty until first search; widens as more rows arrive.
const methodOptions = computed(() => {
    const seen = new Set<string>();
    for (const row of rows.value) {
        if (row.method) seen.add(row.method);
    }
    return Array.from(seen)
        .sort()
        .map((m) => ({key: m, label: m}));
});

const filterSections = computed<FilterSection[]>(() => [
    {
        key: 'sources',
        label: 'Source',
        icon: 'fa-database',
        options: SOURCE_OPTIONS.map((o) => ({key: o.key, label: o.label}))
    },
    {
        key: 'eventTypes',
        label: 'Event Types',
        icon: 'fa-bolt',
        options: EVENT_TYPE_OPTIONS.map((o) => ({key: o.key, label: o.label}))
    },
    {
        key: 'severity',
        label: 'Severity',
        icon: 'fa-circle-exclamation',
        options: SEVERITY_OPTIONS.map((o) => ({key: o.key, label: o.label}))
    },
    {
        key: 'users',
        label: 'User',
        icon: 'fa-user',
        searchable: true,
        options: userOptions.value
    },
    {
        key: 'devices',
        label: 'Device',
        icon: 'fa-microchip',
        searchable: true,
        options: deviceOptions.value
    },
    {
        key: 'methods',
        label: 'Method',
        icon: 'fa-terminal',
        searchable: true,
        options: methodOptions.value
    }
]);

const modalState = computed<FilterState>(() => ({
    sources: filters.sources,
    eventTypes: filters.eventTypes,
    severity: filters.severity,
    users: filters.users,
    devices: filters.devices,
    methods: filters.methods
}));

function applyFilterState(state: FilterState) {
    filters.sources = (state.sources ?? []).length
        ? state.sources
        : [...DEFAULT_SOURCES];
    filters.eventTypes = (state.eventTypes ?? []).length
        ? state.eventTypes
        : [...DEFAULT_EVENT_TYPES];
    filters.severity = (state.severity ?? []).length
        ? state.severity
        : [...DEFAULT_SEVERITY];
    filters.users = state.users ?? [];
    filters.devices = state.devices ?? [];
    filters.methods = state.methods ?? [];
    filterModalVisible.value = false;
}

const activeFilterCount = computed(() => {
    let n = 0;
    if (filters.searchText) n++;
    if (filters.sources.length !== DEFAULT_SOURCES.length) n++;
    if (filters.eventTypes.length !== DEFAULT_EVENT_TYPES.length) n++;
    if (filters.severity.length !== DEFAULT_SEVERITY.length) n++;
    if (filters.users.length > 0) n++;
    if (filters.devices.length > 0) n++;
    if (filters.methods.length > 0) n++;
    if (filters.agentKeyId.trim()) n++;
    if (filters.correlationId.trim()) n++;
    return n;
});

const hasSearched = ref(false);
const hasMore = ref(false);
const offset = ref(0);
const rows = ref<AuditQueryRow[]>([]);
const downloadInfo = ref<AuditExportResponse | null>(null);
const errorMessage = ref('');
// The call the table shows, set only once its rows arrived.
const shownCallId = ref('');

const exportMessage = computed(() => errorMessage.value || auditLog.exportError);

// Sort state — defaults to newest first by timestamp
const sortKey = ref<string | null>('ts');
const sortAsc = ref(false);

function onSort(key: string) {
    if (sortKey.value === key) {
        sortAsc.value = !sortAsc.value;
    } else {
        sortKey.value = key;
        sortAsc.value = true;
    }
}

const sortedRows = computed(() => {
    if (!sortKey.value) return rows.value;
    const key = sortKey.value;
    const dir = sortAsc.value ? 1 : -1;
    return [...rows.value].sort((a, b) => {
        const av = sortValue(a, key);
        const bv = sortValue(b, key);
        if (av === bv) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return av < bv ? -dir : dir;
    });
});

function sortValue(row: AuditQueryRow, key: string): string | number | null {
    switch (key) {
        case 'ts':
            return new Date(row.ts).getTime();
        case 'event_type':
            return row.event_type ?? '';
        case 'username':
            return row.username ?? '';
        case 'method':
            return row.method ?? '';
        case 'success':
            return row.success ? 1 : 0;
        default:
            return null;
    }
}

// Row click → open detail modal
const detailRow = ref<AuditQueryRow | null>(null);
function onRowClick(row: AuditQueryRow) {
    detailRow.value = row;
}

function parseDateTimeLocal(value: string): number | null {
    if (!value) return null;
    const timestamp = new Date(value).getTime();
    return Number.isNaN(timestamp) ? null : timestamp;
}

const activeEventTypes = computed(() => filters.eventTypes.filter(isAuditEventType));
const callFilter = computed(() => filters.correlationId.trim());
const agentKeyFilter = computed(() => filters.agentKeyId.trim());

const hasValidRange = computed(() => {
    const fromTs = parseDateTimeLocal(filters.from);
    const toTs = parseDateTimeLocal(filters.to);
    return fromTs !== null && toTs !== null && fromTs <= toTs;
});

// One AI call needs no date range: its rows are found by its id alone.
const isValid = computed(
    () =>
        !!callFilter.value ||
        (hasValidRange.value &&
            activeEventTypes.value.length > 0 &&
            filters.severity.length > 0)
);

// The CSV export has no AI key or call filter, so it would export more than the table shows.
const canExport = computed(
    () => isValid.value && !callFilter.value && !agentKeyFilter.value
);

const devicesStore = useDevicesStore();

interface DeviceCell {
    /** Short label shown in the table cell. */
    id?: string;
    /** Friendly name when known (primary display line). */
    name?: string;
    /** Full list of touched devices, used for the hover title on bulk rows. */
    allIds?: string[];
}

// Memoize per-render so the template's multiple bindings on the same row
// hit the store once, not three times. Rebuilt when rows or the device
// store's device map changes (name can populate after initial paint).
const deviceLabels = computed(() => {
    const out = new Map<number, DeviceCell>();
    for (const row of rows.value) {
        const ids = row.shelly_ids ?? [];
        if (ids.length > 1) {
            const first = ids[0];
            out.set(row.id, {
                id: `${ids.length} devices`,
                name: devicesStore.getDeviceName(first),
                allIds: ids
            });
        } else {
            const id =
                ids[0] ??
                row.shelly_id ??
                (row.device_id == null ? undefined : String(row.device_id));
            out.set(row.id, id ? {id, name: devicesStore.getDeviceName(id)} : {});
        }
    }
    return out;
});

function deviceLabel(row: AuditQueryRow): DeviceCell {
    return deviceLabels.value.get(row.id) ?? {};
}

function canOpenCallFromRow(row: AuditQueryRow): boolean {
    return (
        row.event_type === 'mcp_tool_call' &&
        !!row.correlation_id &&
        row.correlation_id !== shownCallId.value
    );
}

function matchesSearch(row: AuditQueryRow): boolean {
    const q = filters.searchText.trim().toLowerCase();
    if (!q) return true;
    const scalars = [row.username, row.method, row.shelly_id];
    if (scalars.some((f) => typeof f === 'string' && f.toLowerCase().includes(q))) {
        return true;
    }
    // Bulk-op rows (waitingroom.acceptpending with many devices) carry
    // every touched device in shelly_ids — the single shelly_id column is
    // NULL for those rows, and the column is GIN-indexed on the backend.
    return (row.shelly_ids ?? []).some((s) => s.toLowerCase().includes(q));
}

function matchesSeverity(row: AuditQueryRow): boolean {
    const success = row.success ?? true;
    return success
        ? filters.severity.includes('successful')
        : filters.severity.includes('failed');
}

function matchesUser(row: AuditQueryRow): boolean {
    if (filters.users.length === 0) return true;
    return !!row.username && filters.users.includes(row.username);
}

function matchesDevice(row: AuditQueryRow): boolean {
    if (filters.devices.length === 0) return true;
    const ids: string[] = [];
    if (row.shelly_id) ids.push(row.shelly_id);
    if (row.device_id != null) ids.push(String(row.device_id));
    if (row.shelly_ids) ids.push(...row.shelly_ids);
    return ids.some((id) => filters.devices.includes(id));
}

function matchesMethod(row: AuditQueryRow): boolean {
    if (filters.methods.length === 0) return true;
    return !!row.method && filters.methods.includes(row.method);
}

function matchesPageFilters(row: AuditQueryRow): boolean {
    return (
        matchesSeverity(row) &&
        matchesSearch(row) &&
        matchesUser(row) &&
        matchesDevice(row) &&
        matchesMethod(row)
    );
}

function formatTimestamp(value: string | number) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return formatTime(d);
}

// Everything one AI call wrote: any time, any event type, system log only.
function callSearch(correlationId: string): AuditSearch {
    return {
        query: {correlationId, limit: AUDIT_PAGE_SIZE, offset: offset.value},
        includeSystem: true,
        includeAuthz: false
    };
}

function logSearch(): AuditSearch {
    const agentKeyId = agentKeyFilter.value || undefined;
    return {
        query: {
            from: new Date(filters.from).toISOString(),
            to: new Date(filters.to).toISOString(),
            eventTypes: activeEventTypes.value,
            agentKeyId,
            limit: AUDIT_PAGE_SIZE,
            offset: offset.value
        },
        includeSystem: filters.sources.includes('system'),
        // Authz rows carry no AI key, so a key filter leaves them out.
        includeAuthz: filters.sources.includes('authz') && !agentKeyId
    };
}

async function runSearch(resetOffset: boolean) {
    if (!isValid.value) return;
    if (resetOffset) offset.value = 0;
    hasSearched.value = true;
    const callId = callFilter.value;
    const result = await auditLog.search(
        callId ? callSearch(callId) : logSearch()
    );
    if (!result) {
        if (auditLog.searchError) {
            rows.value = [];
            hasMore.value = false;
        }
        return;
    }
    rows.value = callId ? result.rows : result.rows.filter(matchesPageFilters);
    hasMore.value = result.hasMore;
    shownCallId.value = callId;
}

async function openCall(row: AuditQueryRow) {
    if (!row.correlation_id) return;
    detailRow.value = null;
    filters.correlationId = row.correlation_id;
    await runSearch(true);
}

async function filterByKey(row: AuditQueryRow) {
    if (!row.agent_key_id) return;
    detailRow.value = null;
    filters.correlationId = '';
    filters.agentKeyId = row.agent_key_id;
    await runSearch(true);
}

async function leaveCallView() {
    filters.correlationId = '';
    shownCallId.value = '';
    rows.value = [];
    hasSearched.value = false;
    await runSearch(true);
}

async function prevPage() {
    const prev = offset.value;
    offset.value = Math.max(0, offset.value - AUDIT_PAGE_SIZE);
    await runSearch(false);
    if (auditLog.searchError) offset.value = prev;
}

async function nextPage() {
    const prev = offset.value;
    offset.value += AUDIT_PAGE_SIZE;
    await runSearch(false);
    if (auditLog.searchError) offset.value = prev;
}

async function generateExport() {
    downloadInfo.value = null;
    errorMessage.value = '';

    const fromTs = parseDateTimeLocal(filters.from);
    const toTs = parseDateTimeLocal(filters.to);
    if (fromTs === null || toTs === null) {
        errorMessage.value = 'Enter a valid date range';
        return;
    }
    if (fromTs > toTs) {
        errorMessage.value = '"From" must be earlier than or equal to "To"';
        return;
    }

    downloadInfo.value = await auditLog.exportAudit({
        from: new Date(filters.from).toISOString(),
        to: new Date(filters.to).toISOString(),
        eventTypes: activeEventTypes.value
    });
}

async function downloadExport() {
    if (!downloadInfo.value) return;
    errorMessage.value = '';
    const url = await auditLog.mintDownloadUrl(downloadInfo.value);
    if (!url) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = downloadInfo.value.filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Default to last 7 days.
function formatDateTimeLocalValue(date: Date) {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
        date.getDate()
    )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function setDefaultDates() {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    filters.to = formatDateTimeLocalValue(now);
    filters.from = formatDateTimeLocalValue(weekAgo);
}

setDefaultDates();

// Best-effort load of the Zitadel user list so the User filter has options upfront
// in production. Silently no-ops in dev mode where Zitadel is disabled.
void usersStore.fetchUsers();
</script>

<style scoped>
.audit-content {
    display: flex;
    flex-direction: column;
    gap: var(--gap-md);
}


.audit-alert {
    padding: var(--gap-sm);
    border-radius: var(--radius-md);
    font-size: var(--type-body);
}
.audit-alert--danger {
    background: var(--color-danger-subtle);
    color: var(--color-danger-text);
}
.audit-alert--success {
    background: var(--color-success-subtle);
    color: var(--color-success-text);
    display: flex;
    flex-direction: column;
    gap: var(--gap-xs);
}

.audit-pagination {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: var(--gap-sm);
}
.audit-pagination__count {
    font-size: var(--type-caption);
    color: var(--color-text-disabled);
}
.audit-pagination__buttons {
    display: flex;
    gap: var(--gap-xs);
}

.audit-export-status {
    margin-top: var(--gap-sm);
}
.audit-export-status__note {
    font-size: var(--type-caption);
    color: var(--color-text-disabled);
}

.audit-table-wrap {
    overflow-x: auto;
}
.audit-mono {
    font-family: var(--font-mono);
}
.audit-ok {
    color: var(--color-success-text);
}
.audit-fail {
    color: var(--color-danger-text);
    font-weight: var(--font-semibold);
}
.audit-device-name {
    color: var(--color-text-primary);
    font-weight: var(--font-medium);
}
.audit-user-system {
    display: inline-flex;
    align-items: center;
    padding: var(--space-0-5) var(--gap-xs);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--color-primary) 15%, transparent);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.audit-device-id {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    margin-top: var(--space-0-5);
}
.audit-error-text {
    color: var(--color-danger-text);
    font-size: var(--type-caption);
    margin-bottom: var(--space-1);
}
.audit-detail-hint {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    font-style: italic;
}
.audit-agent-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    margin-left: var(--space-2);
    padding: var(--space-0-5) var(--space-2);
    border: var(--space-px) solid var(--color-border-default);
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    white-space: nowrap;
}
.audit-detail-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--gap-xs);
}
</style>
