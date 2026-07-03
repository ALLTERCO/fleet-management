<template>
    <div class="bas-panel">
        <header class="bas-bar">
            <button
                type="button"
                class="bas-btn bas-btn--primary"
                :disabled="scanning"
                @click="runScan"
            >
                <i
                    :class="
                        scanning ? 'fas fa-spinner fa-spin' : 'fas fa-radar'
                    "
                />
                {{ scanning ? 'Scanning' : 'Scan' }}
            </button>
            <label class="bas-toggle">
                <input v-model="autoScan" type="checkbox" />
                <span>Auto rescan</span>
            </label>
            <label class="bas-toggle">
                <input v-model="compact" type="checkbox" />
                <span>Compact</span>
            </label>
            <span class="bas-counts">
                <strong>{{ totalCount }}</strong> found
                <span v-if="shellyBluCount > 0" class="bas-counts__dim">
                    · {{ shellyBluCount }} Shelly BLU
                </span>
                <span v-if="inFleetCount > 0" class="bas-counts__dim">
                    · {{ inFleetCount }} in fleet
                </span>
            </span>
        </header>

        <div class="bas-filters">
            <div class="bas-search">
                <i class="fas fa-search bas-search__icon" />
                <input
                    v-model.trim="filter.query"
                    type="text"
                    placeholder="Search name or MAC"
                    class="bas-search__input"
                />
            </div>
            <label class="bas-hexfield">
                <span>BLU ID</span>
                <input
                    v-model.trim="filter.modelHex"
                    type="text"
                    placeholder="0x…"
                    class="bas-input bas-input--hex"
                />
            </label>
            <button
                v-for="chip in chips"
                :key="chip.key"
                type="button"
                class="bas-chip"
                :class="{'bas-chip--on': chip.on}"
                @click="chip.toggle"
            >
                <i :class="chip.icon" />
                {{ chip.label }}
            </button>
            <button
                v-if="hasActiveFilter"
                type="button"
                class="bas-chip bas-chip--ghost"
                @click="resetFilter"
            >
                Clear
            </button>
            <details class="bas-advanced">
                <summary>Scan parameters</summary>
                <div class="bas-params">
                    <label class="bas-field bas-field--inline">
                        <input v-model="form.active" type="checkbox" />
                        <span>Active scan</span>
                    </label>
                    <label class="bas-field">
                        <span class="bas-field__label">Duration (ms)</span>
                        <input
                            v-model.number="form.duration_ms"
                            type="number"
                            min="1"
                            max="30000"
                            class="bas-input"
                        />
                    </label>
                    <label class="bas-field">
                        <span class="bas-field__label">Window (ms)</span>
                        <input
                            v-model.number="form.window_ms"
                            type="number"
                            min="2.5"
                            max="10240"
                            step="0.5"
                            class="bas-input"
                        />
                    </label>
                    <label class="bas-field">
                        <span class="bas-field__label">Interval (ms)</span>
                        <input
                            v-model.number="form.interval_ms"
                            type="number"
                            min="2.5"
                            max="10240"
                            step="0.5"
                            class="bas-input"
                        />
                    </label>
                    <label class="bas-field">
                        <span class="bas-field__label">RSSI threshold</span>
                        <input
                            v-model.number="form.rssi_thr"
                            type="number"
                            min="-100"
                            max="0"
                            class="bas-input"
                        />
                    </label>
                </div>
            </details>
        </div>

        <p v-if="autoScan" class="bas-hint">
            Auto rescan every {{ Math.round(autoIntervalMs / 1000) }}s — devices
            unseen for {{ Math.round(forgetAfterMs / 1000) }}s fade out.
        </p>

        <div v-if="error" class="bas-error">
            <i class="fas fa-triangle-exclamation" /> {{ error }}
        </div>

        <section v-for="section in sections" :key="section.key" class="bas-section">
            <button
                type="button"
                class="bas-section__head"
                @click="collapsed[section.key] = !collapsed[section.key]"
            >
                <i
                    :class="
                        collapsed[section.key]
                            ? 'fas fa-chevron-right'
                            : 'fas fa-chevron-down'
                    "
                />
                <span class="bas-section__title">{{ section.title }}</span>
                <span class="bas-section__count">{{ section.rows.length }}</span>
            </button>
            <div
                v-if="!collapsed[section.key] && section.rows.length > 0"
                class="bas-cards"
                :class="{'bas-cards--compact': compact}"
            >
                <article
                    v-for="row in section.rows"
                    :key="row.addr"
                    class="bas-card"
                    :class="[
                        section.cardClass,
                        {'bas-card--stale': row.staleness > 0.5},
                        {'bas-card--compact': compact}
                    ]"
                >
                    <div class="bas-card__main">
                        <div class="bas-card__title">
                            {{ row.titleText }}
                        </div>
                        <div class="bas-card__sub">
                            <span
                                v-if="row.parsed?.modelId !== undefined"
                                class="bas-mono"
                            >
                                {{ formatModelHex(row.parsed.modelId) }}
                            </span>
                            <span
                                v-if="row.parsed?.modelString"
                                class="bas-mono bas-mono--dim"
                            >
                                {{ row.parsed.modelString }}
                            </span>
                            <span class="bas-mono bas-mono--dim">
                                {{ baseMac(row.addr) }}
                            </span>
                        </div>
                    </div>
                    <div class="bas-card__signal">
                        <span class="bas-rssi" :title="`${row.rssi} dBm now · max ${row.maxRssi}`">
                            <span
                                v-for="bar in 5"
                                :key="bar"
                                class="bas-bar"
                                :class="{'bas-bar--on': bar <= rssiBars(row.rssi)}"
                            />
                        </span>
                        <span class="bas-dbm">{{ row.rssi }}</span>
                    </div>
                    <div class="bas-card__actions">
                        <button
                            type="button"
                            class="bas-card-btn"
                            :disabled="connectingAddrs.has(baseMac(row.addr))"
                            @click="connectTo(row.addr)"
                        >
                            <i
                                :class="
                                    connectingAddrs.has(baseMac(row.addr))
                                        ? 'fas fa-spinner fa-spin'
                                        : 'fas fa-plug'
                                "
                            />
                            Connect
                        </button>
                        <button
                            type="button"
                            class="bas-fav"
                            :class="{'bas-fav--on': favorites.has(baseMac(row.addr))}"
                            :title="
                                favorites.has(baseMac(row.addr))
                                    ? 'Remove from watchlist'
                                    : 'Add to watchlist'
                            "
                            @click="toggleFavorite(row.addr)"
                        >
                            <i
                                :class="
                                    favorites.has(baseMac(row.addr))
                                        ? 'fas fa-star'
                                        : 'far fa-star'
                                "
                            />
                        </button>
                    </div>
                </article>
            </div>
        </section>

        <div v-if="!scanning && totalCount === 0 && !error" class="bas-empty">
            <i class="fas fa-radar bas-empty__icon" />
            <p>No scan yet — press Scan to find nearby BLE devices.</p>
        </div>
        <div
            v-else-if="!scanning && totalRawCount > 0 && totalCount === 0"
            class="bas-empty"
        >
            No results match the current filter.
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, ref, watch} from 'vue';
import {useBluAssistRefresh} from '@/composables/useBluAssistRefresh';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {useToastStore} from '@/stores/toast';
import {sendRPC} from '@/tools/websocket';

interface ScanResultParsed {
    isShellyBlu: boolean;
    encrypted: boolean;
    localName?: string;
    modelId?: number;
    modelString?: string;
    productName?: string;
}

interface ScanResultKnown {
    externalId: string;
    name: string;
    gatewayShellyId: string;
}

interface RawScanResult {
    addr: string;
    rssi: number;
    advData?: string;
    parsed?: ScanResultParsed;
    knownInFleet?: ScanResultKnown;
}

interface TrackedRow extends RawScanResult {
    firstSeenAt: number;
    lastSeenAt: number;
    maxRssi: number;
    staleness: number;
    titleText: string;
}

const props = defineProps<{shellyID: string}>();

function favStorageKey(shellyID: string): string {
    return `bas:favorites:${shellyID}`;
}

const autoIntervalMs = 6000;
const forgetAfterMs = 20000;

const form = ref({
    active: false,
    duration_ms: 4000,
    window_ms: 95,
    interval_ms: 100,
    rssi_thr: -100
});

const scanning = ref(false);
const error = ref<string | null>(null);
const tracked = ref(new Map<string, TrackedRow>());
const connectingAddrs = ref(new Set<string>());

const autoScan = ref(false);
const compact = ref(false);
let autoTimer: ReturnType<typeof setTimeout> | null = null;

const filter = ref({
    query: '',
    modelHex: '',
    showAllBle: false,
    inFleetOnly: false,
    availableOnly: false,
    favoritesOnly: false,
    minRssi: -100
});

const chips = computed(() => [
    {
        key: 'allble',
        label: 'Include other BLE',
        icon: 'fas fa-broadcast-tower',
        on: filter.value.showAllBle,
        toggle: () => {
            filter.value.showAllBle = !filter.value.showAllBle;
            // shellyOnly is a backend param; re-scan when it flips so the
            // server-side filter actually applies.
            tracked.value = new Map();
            if (autoScan.value) {
                stopAutoTimer();
                void runScan().then(scheduleNext);
            } else {
                void runScan();
            }
        }
    },
    {
        key: 'fleet',
        label: 'In fleet',
        icon: 'fas fa-check',
        on: filter.value.inFleetOnly,
        toggle: () => {
            filter.value.inFleetOnly = !filter.value.inFleetOnly;
            if (filter.value.inFleetOnly) filter.value.availableOnly = false;
        }
    },
    {
        key: 'available',
        label: 'Available',
        icon: 'fas fa-plus',
        on: filter.value.availableOnly,
        toggle: () => {
            filter.value.availableOnly = !filter.value.availableOnly;
            if (filter.value.availableOnly) filter.value.inFleetOnly = false;
        }
    },
    {
        key: 'fav',
        label: 'Watchlist',
        icon: 'fas fa-star',
        on: filter.value.favoritesOnly,
        toggle: () => {
            filter.value.favoritesOnly = !filter.value.favoritesOnly;
        }
    },
    {
        key: 'strong',
        label: '≥ -70 dBm',
        icon: 'fas fa-signal',
        on: filter.value.minRssi > -100,
        toggle: () => {
            filter.value.minRssi = filter.value.minRssi > -100 ? -100 : -70;
        }
    }
]);

const favorites = ref<Set<string>>(loadFavorites(props.shellyID));

const hasActiveFilter = computed(
    () =>
        filter.value.query !== '' ||
        filter.value.modelHex !== '' ||
        filter.value.showAllBle ||
        filter.value.inFleetOnly ||
        filter.value.availableOnly ||
        filter.value.favoritesOnly ||
        filter.value.minRssi > -100
);

const totalRawCount = computed(() => tracked.value.size);

const filteredRows = computed<TrackedRow[]>(() => {
    const f = filter.value;
    const hexId = parseHexFilter(f.modelHex);
    const q = f.query.toLowerCase();
    const out: TrackedRow[] = [];
    for (const row of tracked.value.values()) {
        if (row.rssi < f.minRssi) continue;
        if (f.inFleetOnly && !row.knownInFleet) continue;
        if (f.availableOnly && row.knownInFleet) continue;
        if (
            f.favoritesOnly &&
            !favorites.value.has(baseMac(row.addr))
        )
            continue;
        if (hexId !== null && row.parsed?.modelId !== hexId) continue;
        if (q) {
            const haystack =
                `${row.addr} ${row.parsed?.localName ?? ''} ${row.parsed?.productName ?? ''} ${row.parsed?.modelString ?? ''} ${row.knownInFleet?.name ?? ''}`.toLowerCase();
            if (!haystack.includes(q)) continue;
        }
        out.push(row);
    }
    out.sort((a, b) => b.rssi - a.rssi);
    return out;
});

const totalCount = computed(() => filteredRows.value.length);
const shellyBluCount = computed(
    () => filteredRows.value.filter((r) => r.parsed?.isShellyBlu).length
);
const inFleetCount = computed(
    () => filteredRows.value.filter((r) => r.knownInFleet).length
);

const collapsed = ref({fleet: false, shelly: false, other: true});

const sections = computed(() => {
    const rows = filteredRows.value;
    return [
        {
            key: 'fleet' as const,
            title: 'In your fleet',
            cardClass: 'bas-card--fleet',
            rows: rows.filter((r) => r.knownInFleet)
        },
        {
            key: 'shelly' as const,
            title: 'Available Shelly BLU',
            cardClass: 'bas-card--shelly',
            rows: rows.filter((r) => !r.knownInFleet && r.parsed?.isShellyBlu)
        },
        {
            key: 'other' as const,
            title: 'Other BLE',
            cardClass: 'bas-card--other',
            rows: rows.filter(
                (r) => !r.knownInFleet && !r.parsed?.isShellyBlu
            )
        }
    ];
});

function baseMac(addr: string): string {
    return addr.split(',')[0];
}

function formatModelHex(id: number): string {
    return `0x${id.toString(16).toUpperCase().padStart(4, '0')}`;
}

function rssiBars(rssi: number): number {
    if (rssi >= -55) return 5;
    if (rssi >= -65) return 4;
    if (rssi >= -75) return 3;
    if (rssi >= -85) return 2;
    if (rssi >= -95) return 1;
    return 0;
}

function buildTitle(r: RawScanResult): string {
    return (
        r.knownInFleet?.name ??
        r.parsed?.productName ??
        r.parsed?.localName ??
        baseMac(r.addr)
    );
}

function parseHexFilter(input: string): number | null {
    if (!input) return null;
    const cleaned = input.replace(/^0x/i, '').trim();
    if (!/^[0-9a-fA-F]{1,4}$/.test(cleaned)) return null;
    return parseInt(cleaned, 16);
}

function resetFilter(): void {
    const wasShowingAll = filter.value.showAllBle;
    filter.value = {
        query: '',
        modelHex: '',
        showAllBle: false,
        inFleetOnly: false,
        availableOnly: false,
        favoritesOnly: false,
        minRssi: -100
    };
    if (wasShowingAll) {
        tracked.value = new Map();
        void runScan();
    }
}

function loadFavorites(shellyID: string): Set<string> {
    try {
        const raw = localStorage.getItem(favStorageKey(shellyID));
        if (!raw) return new Set();
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? new Set(parsed) : new Set();
    } catch {
        return new Set();
    }
}

function persistFavorites(shellyID: string, set: Set<string>): void {
    try {
        localStorage.setItem(favStorageKey(shellyID), JSON.stringify([...set]));
    } catch {
        // storage may be full or disabled — ignore
    }
}

function toggleFavorite(addr: string): void {
    const key = baseMac(addr);
    const next = new Set(favorites.value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    favorites.value = next;
    persistFavorites(props.shellyID, next);
}

// nowMs is a static stamp captured at scan-merge time; cheaper than re-reading
// Date.now() per row and avoids drift in template re-renders.
function mergeResults(results: RawScanResult[], nowMs: number): void {
    const merged = new Map(tracked.value);
    for (const r of results) {
        const key = baseMac(r.addr);
        const prev = merged.get(key);
        const maxRssi = prev ? Math.max(prev.maxRssi, r.rssi) : r.rssi;
        merged.set(key, {
            ...r,
            firstSeenAt: prev?.firstSeenAt ?? nowMs,
            lastSeenAt: nowMs,
            maxRssi,
            staleness: 0,
            titleText: buildTitle(r)
        });
    }
    for (const [key, row] of merged) {
        if (results.some((r) => baseMac(r.addr) === key)) continue;
        const age = nowMs - row.lastSeenAt;
        const stale = Math.min(1, age / forgetAfterMs);
        if (stale >= 1) merged.delete(key);
        else merged.set(key, {...row, staleness: stale});
    }
    tracked.value = merged;
}

const toast = useToastStore();
const {bump: bumpConnectionsRefresh} = useBluAssistRefresh(props.shellyID);

async function connectTo(addr: string): Promise<void> {
    const mac = baseMac(addr);
    if (connectingAddrs.value.has(mac)) return;
    connectingAddrs.value = new Set([...connectingAddrs.value, mac]);
    try {
        await sendRPC('FLEET_MANAGER', 'bluassist.Connect', {
            shellyID: props.shellyID,
            addr
        });
        bumpConnectionsRefresh();
        toast.success(`Connected to ${mac}`);
    } catch (err) {
        toast.error(rpcErrorMessage(err, `Connect to ${mac} failed`));
    } finally {
        const next = new Set(connectingAddrs.value);
        next.delete(mac);
        connectingAddrs.value = next;
    }
}

async function runScan(): Promise<void> {
    if (scanning.value) return;
    scanning.value = true;
    error.value = null;
    try {
        const resp = await sendRPC<{
            results: RawScanResult[];
            scanned: number;
        }>('FLEET_MANAGER', 'bluassist.Scan', {
            shellyID: props.shellyID,
            active: form.value.active,
            duration_ms: form.value.duration_ms,
            window_ms: form.value.window_ms,
            interval_ms: form.value.interval_ms,
            rssi_thr: form.value.rssi_thr,
            shellyOnly: !filter.value.showAllBle
        });
        mergeResults(resp.results, Date.now());
    } catch (err) {
        error.value = rpcErrorMessage(err, 'Scan failed');
    } finally {
        scanning.value = false;
    }
}

function stopAutoTimer(): void {
    if (autoTimer !== null) {
        clearTimeout(autoTimer);
        autoTimer = null;
    }
}

function scheduleNext(): void {
    stopAutoTimer();
    if (!autoScan.value) return;
    autoTimer = setTimeout(async () => {
        await runScan();
        scheduleNext();
    }, autoIntervalMs);
}

watch(autoScan, (on) => {
    if (on) {
        void runScan().then(scheduleNext);
    } else {
        stopAutoTimer();
    }
});

watch(
    () => props.shellyID,
    (id) => {
        tracked.value = new Map();
        favorites.value = loadFavorites(id);
        autoScan.value = false;
        stopAutoTimer();
    }
);

onBeforeUnmount(stopAutoTimer);
</script>

<style scoped>
.bas-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.bas-bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
}
.bas-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid transparent;
    font-weight: var(--font-medium);
    cursor: pointer;
    font-size: var(--type-body);
}
.bas-btn--primary {
    background: var(--color-primary);
    color: white;
}
.bas-btn:disabled {
    opacity: 0.65;
    cursor: progress;
}
.bas-toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    cursor: pointer;
    user-select: none;
}
.bas-counts {
    margin-left: auto;
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}
.bas-counts strong {
    color: var(--color-text-primary);
}
.bas-filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
}
.bas-search {
    position: relative;
    flex: 1 1 240px;
    min-width: 200px;
}
.bas-search__icon {
    position: absolute;
    left: var(--space-2);
    top: 50%;
    transform: translateY(-50%);
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}
.bas-search__input {
    width: 100%;
    background: var(--color-surface-1);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-1-5) var(--space-2) var(--space-1-5) var(--space-6);
    color: var(--color-text-primary);
    font-size: var(--type-body);
}
.bas-hexfield {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.bas-input {
    background: var(--color-surface-1);
    border: 1px solid var(--color-border);
    color: var(--color-text-primary);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    font-size: var(--type-body);
}
.bas-input--hex {
    width: 7rem;
    font-family: var(--font-mono, monospace);
}
.bas-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border-radius: 999px;
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    cursor: pointer;
}
.bas-chip--on {
    background: color-mix(in srgb, var(--color-primary) 18%, transparent);
    border-color: var(--color-primary);
    color: var(--color-primary-text);
}
.bas-chip--ghost {
    border-style: dashed;
}
.bas-advanced {
    width: 100%;
}
.bas-advanced summary {
    cursor: pointer;
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
    padding: var(--space-1) 0;
}
.bas-params {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: var(--space-2);
    padding: var(--space-2) 0;
}
.bas-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--type-body);
}
.bas-field--inline {
    flex-direction: row;
    align-items: center;
}
.bas-field__label {
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}
.bas-hint {
    margin: 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}
.bas-error {
    background: color-mix(in srgb, var(--color-danger) 12%, transparent);
    color: var(--color-danger-text);
    padding: var(--space-2);
    border-radius: var(--radius-md);
    font-size: var(--type-body);
}
.bas-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.bas-section__head {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    background: transparent;
    border: none;
    color: var(--color-text-secondary);
    cursor: pointer;
    padding: var(--space-1) 0;
    font-size: var(--type-body);
}
.bas-section__title {
    font-weight: var(--font-medium);
}
.bas-section__count {
    background: var(--color-surface-2);
    color: var(--color-text-secondary);
    padding: 0 var(--space-1-5);
    border-radius: 999px;
    font-size: var(--type-body);
    font-variant-numeric: tabular-nums;
}
.bas-cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: var(--space-2);
}
.bas-cards--compact {
    grid-template-columns: 1fr;
    gap: var(--space-1);
}
.bas-card {
    display: grid;
    grid-template-columns: 1fr auto auto;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    transition: opacity 200ms;
}
.bas-card--fleet {
    border-left: 3px solid var(--color-success);
}
.bas-card--shelly {
    border-left: 3px solid var(--color-primary);
}
.bas-card--other {
    border-left: 3px solid var(--color-border-strong);
}
.bas-card--compact {
    padding: var(--space-2);
}
.bas-card--stale {
    opacity: 0.45;
}
.bas-card__main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.bas-card__title {
    color: var(--color-text-primary);
    font-weight: var(--font-medium);
    font-size: var(--type-body);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.bas-card__sub {
    display: flex;
    gap: var(--space-1-5);
    flex-wrap: wrap;
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}
.bas-mono {
    font-family: var(--font-mono, monospace);
}
.bas-mono--dim {
    color: var(--color-text-tertiary);
}
.bas-card__signal {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
}
.bas-rssi {
    display: inline-flex;
    align-items: flex-end;
    gap: 2px;
    height: 12px;
}
.bas-bar {
    width: 3px;
    background: var(--color-surface-2);
    border-radius: 1px;
}
.bas-bar:nth-child(1) {
    height: 3px;
}
.bas-bar:nth-child(2) {
    height: 5px;
}
.bas-bar:nth-child(3) {
    height: 7px;
}
.bas-bar:nth-child(4) {
    height: 9px;
}
.bas-bar:nth-child(5) {
    height: 11px;
}
.bas-bar--on {
    background: var(--color-primary);
}
.bas-dbm {
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
    font-variant-numeric: tabular-nums;
}
.bas-card__actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
}
.bas-card-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    color: var(--color-text-primary);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--type-body);
}
.bas-card-btn:hover {
    border-color: var(--color-primary);
    color: var(--color-primary-text);
}
.bas-card-btn:disabled {
    opacity: 0.6;
    cursor: progress;
}
.bas-fav {
    background: transparent;
    border: none;
    color: var(--color-text-tertiary);
    cursor: pointer;
    padding: var(--space-1);
    font-size: var(--type-body);
}
.bas-fav--on {
    color: var(--color-warning);
}
.bas-empty {
    margin: var(--space-4) auto;
    text-align: center;
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}
.bas-empty__icon {
    display: block;
    font-size: var(--type-subheading);
    margin: 0 auto var(--space-2);
    color: var(--color-text-tertiary);
    opacity: 0.5;
}
</style>
