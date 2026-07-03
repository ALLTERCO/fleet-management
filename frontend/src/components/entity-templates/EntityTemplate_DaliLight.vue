<template>
    <div class="et-dali">
        <!-- DALI badge in header area -->
        <div class="et-dali__badge-row">
            <span class="et-dali__badge"><i class="fas fa-network-wired" /> DALI</span>
        </div>

        <!-- Reuse standard Light template for dimmer controls (pass shellyID for config editing) -->
        <EntityTemplate_Light
            :status="status"
            :settings="settings"
            :can-execute="canExecute"
            :shelly-i-d="shellyID"
            @toggle="emit('toggle')"
            @set-brightness="(v: number) => emit('setBrightness', v)"
            @set-rgb="(v: [number, number, number]) => emit('setRgb', v)"
            @set-white="(v: number) => emit('setWhite', v)"
            @set-temp="(v: number) => emit('setTemp', v)"
            @toggle-after="(v: number) => emit('toggleAfter', v)"
        />

        <!-- DALI Bus section -->
        <div class="et-dali__bus">
            <div class="et-dali__section-header">
                <i class="fas fa-network-wired" />
                <span>DALI Bus</span>
            </div>

            <!-- Bus status cards -->
            <div class="et-dali__bus-grid">
                <div class="et-dali__bus-card">
                    <span class="et-dali__bus-value">{{ daliStatus?.cg_count ?? '—' }}</span>
                    <span class="et-dali__bus-label">Groups</span>
                </div>
                <div v-if="daliStatus?.bus_state" class="et-dali__bus-card">
                    <span class="et-dali__bus-value">{{ daliStatus.bus_state }}</span>
                    <span class="et-dali__bus-label">Bus State</span>
                </div>
                <div v-if="daliConfig?.fade_rate != null" class="et-dali__bus-card">
                    <span class="et-dali__bus-value">{{ daliConfig.fade_rate }}</span>
                    <span class="et-dali__bus-label">Fade Rate</span>
                </div>
                <div v-if="daliConfig?.fade_time != null" class="et-dali__bus-card">
                    <span class="et-dali__bus-value">{{ daliConfig.fade_time }}s</span>
                    <span class="et-dali__bus-label">Fade Time</span>
                </div>
            </div>

            <!-- Bus actions -->
            <div v-if="canExecute" class="et-dali__bus-actions">
                <button
                    class="et-dali__action-btn"
                    :disabled="scanning"
                    @click="startScan"
                >
                    <i :class="scanning ? 'fas fa-spinner fa-spin' : 'fas fa-magnifying-glass'" />
                    {{ scanning ? 'Scanning...' : 'Scan Bus' }}
                </button>
                <button
                    class="et-dali__action-btn"
                    :disabled="pinging"
                    @click="pingDevices"
                >
                    <i :class="pinging ? 'fas fa-spinner fa-spin' : 'fas fa-satellite-dish'" />
                    {{ pinging ? 'Pinging...' : 'Ping Devices' }}
                </button>
            </div>
            <div v-if="scanning" class="et-dali__scan-notice">
                <i class="fas fa-info-circle" /> DALI scan can take up to 90 seconds
            </div>

            <!-- Scan result -->
            <div v-if="scanResult" class="et-dali__result">
                <div class="et-dali__result-header">
                    <span><i class="fas fa-circle-check" /> Scan complete — {{ scanResult.cg_count }} control gear(s) found</span>
                    <button class="et-dali__result-close" @click="scanResult = null">
                        <i class="fas fa-xmark" />
                    </button>
                </div>
            </div>

            <!-- Ping result -->
            <div v-if="pingResult" class="et-dali__result">
                <div class="et-dali__result-header">
                    <span><i class="fas fa-circle-check" /> Ping complete</span>
                    <button class="et-dali__result-close" @click="pingResult = null">
                        <i class="fas fa-xmark" />
                    </button>
                </div>
            </div>

            <!-- Scan/ping error -->
            <div v-if="busError" class="et-dali__error">
                <i class="fas fa-triangle-exclamation" />
                <span>{{ busError }}</span>
            </div>
        </div>

        <!-- Control Groups -->
        <div v-if="groups.length" class="et-dali__groups">
            <div class="et-dali__section-header">
                <i class="fas fa-layer-group" />
                <span>Control Groups</span>
                <button class="et-dali__refresh-btn" :disabled="loadingGroups" @click="loadGroups">
                    <i :class="loadingGroups ? 'fas fa-spinner fa-spin' : 'fas fa-rotate'" />
                </button>
            </div>

            <div v-for="group in groups" :key="group.id" class="et-dali__group">
                <div class="et-dali__group-header">
                    <input
                        v-if="canExecute"
                        class="et-dali__group-name-input"
                        :value="group.name || `Group ${group.id}`"
                        :placeholder="`Group ${group.id}`"
                        @change="(e: Event) => renameGroup(group.id, (e.target as HTMLInputElement).value)"
                    />
                    <span v-else class="et-dali__group-name">{{ group.name || `Group ${group.id}` }}</span>
                    <span class="et-dali__group-state" :class="group.output ? 'et-dali__group-state--on' : ''">
                        {{ group.output ? 'ON' : 'OFF' }}
                    </span>
                    <button
                        v-if="canExecute"
                        class="et-dali__group-toggle"
                        :class="group.output && 'et-dali__group-toggle--on'"
                        @click="toggleGroup(group.id, !group.output)"
                    >
                        <i class="fas fa-power-off" />
                    </button>
                </div>
                <HorizontalSlider
                    v-if="group.brightness != null"
                    :value="group.brightness"
                    :saved="{ '0%': 0, '25%': 25, '50%': 50, '75%': 75, '100%': 100 }"
                    :disabled="!canExecute"
                    :class="!group.output && 'et-dali__control--off'"
                    @change="(v: number) => setGroupBrightness(group.id, v)"
                >
                    <template #title> Brightness ({{ group.brightness }}%) </template>
                </HorizontalSlider>
            </div>
        </div>

        <!-- Load groups button (when we know groups exist but haven't loaded them) -->
        <div v-else-if="(daliStatus?.cg_count ?? 0) > 0" class="et-dali__load-groups">
            <button class="et-dali__action-btn" :disabled="loadingGroups" @click="loadGroups">
                <i :class="loadingGroups ? 'fas fa-spinner fa-spin' : 'fas fa-layer-group'" />
                {{ loadingGroups ? 'Loading...' : `Load ${daliStatus?.cg_count} Group(s)` }}
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, watch} from 'vue';
import HorizontalSlider from '@/components/core/HorizontalSlider.vue';
import {resolveOptional} from '@/helpers/promiseUtils';
import {useEntityStore} from '@/stores/entities';
import {sendRPC} from '@/tools/websocket';
import EntityTemplate_Light from './EntityTemplate_Light.vue';

const props = defineProps<{
    status: Record<string, any> | undefined;
    settings: Record<string, any> | undefined;
    canExecute: boolean;
    shellyID?: string;
    entityId?: string;
    daliStatus?: Record<string, any>;
    daliConfig?: Record<string, any>;
}>();

const emit = defineEmits<{
    toggle: [];
    setRgb: [[number, number, number]];
    setWhite: [number];
    setBrightness: [number];
    setTemp: [number];
    toggleAfter: [seconds: number];
}>();

const entityStore = useEntityStore();

// --- DALI Bus Operations ---
// StartScan and PingKnownDevices return null immediately (async on device).
// The actual result arrives as a NotifyEvent (scan_complete / ping_complete)
// which the backend patches into status.dali. We watch daliStatus.cg_count
// reactively and use a safety timeout as fallback.

const scanning = ref(false);
const pinging = ref(false);
const scanResult = ref<any>(null);
const pingResult = ref<any>(null);
const busError = ref<string | null>(null);

/** Safety timeout — if no scan_complete event arrives within 90s, stop spinner */
const DALI_SAFETY_TIMEOUT_MS = 90_000;
let scanTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setTimeout> | null = null;

function clearScanTimer() {
    if (scanTimer) {
        clearTimeout(scanTimer);
        scanTimer = null;
    }
}

function clearPingTimer() {
    if (pingTimer) {
        clearTimeout(pingTimer);
        pingTimer = null;
    }
}

onUnmounted(() => {
    clearScanTimer();
    clearPingTimer();
});

// Watch for scan_complete: backend patches dali.cg_count via setComponentStatus
watch(
    () => props.daliStatus?.cg_count,
    (newCount, oldCount) => {
        if (scanning.value && newCount !== oldCount) {
            scanning.value = false;
            clearScanTimer();
            scanResult.value = {cg_count: newCount};
            // Auto-reload groups after scan
            if ((newCount ?? 0) > 0) loadGroups();
        }
    }
);

// Watch for ping_complete: backend patches dali.ping_complete_ts
watch(
    () => props.daliStatus?.ping_complete_ts,
    (newTs, oldTs) => {
        if (pinging.value && newTs !== oldTs) {
            pinging.value = false;
            clearPingTimer();
            pingResult.value = {status: 'complete'};
        }
    }
);

async function startScan() {
    if (!props.shellyID) return;
    scanning.value = true;
    scanResult.value = null;
    busError.value = null;

    try {
        await sendRPC('FLEET_MANAGER', 'Dali.StartScan', {
            shellyID: props.shellyID
        });
    } catch (e: any) {
        scanning.value = false;
        busError.value = e.message || 'Failed to start scan';
        return;
    }

    // RPC returned null (accepted) — scan is running on device.
    // Wait for scan_complete event via the watcher above, with safety timeout.
    clearScanTimer();
    scanTimer = setTimeout(() => {
        if (scanning.value) {
            scanning.value = false;
            busError.value =
                'Scan timed out — no response from device within 90s';
        }
    }, DALI_SAFETY_TIMEOUT_MS);
}

async function pingDevices() {
    if (!props.shellyID) return;
    pinging.value = true;
    pingResult.value = null;
    busError.value = null;

    try {
        await sendRPC('FLEET_MANAGER', 'Dali.PingKnownDevices', {
            shellyID: props.shellyID
        });
    } catch (e: any) {
        pinging.value = false;
        busError.value = e.message || 'Failed to start ping';
        return;
    }

    // ping_complete carries no data — just use a safety timeout
    clearPingTimer();
    pingTimer = setTimeout(() => {
        if (pinging.value) {
            pinging.value = false;
            pingResult.value = {status: 'complete'};
        }
    }, DALI_SAFETY_TIMEOUT_MS);
}

// --- Control Groups ---

interface GroupState {
    id: number;
    name: string | null;
    output: boolean;
    brightness: number | null;
}

const groups = ref<GroupState[]>([]);
const loadingGroups = ref(false);

async function loadGroups() {
    if (!props.shellyID) return;
    loadingGroups.value = true;
    const count = props.daliStatus?.cg_count ?? 0;

    // Load status + config for all groups in parallel
    const results = await Promise.allSettled(
        Array.from({length: count}, (_, i) =>
            Promise.all([
                resolveOptional(
                    'DaliLight',
                    `group ${i} status`,
                    sendRPC('FLEET_MANAGER', 'Dali.Group.GetStatus', {
                        shellyID: props.shellyID,
                        id: i
                    })
                ),
                resolveOptional(
                    'DaliLight',
                    `group ${i} config`,
                    sendRPC('FLEET_MANAGER', 'Dali.Group.GetConfig', {
                        shellyID: props.shellyID,
                        id: i
                    })
                )
            ]).then(
                ([status, config]): GroupState => ({
                    id: i,
                    name: config?.name ?? null,
                    output: status?.output ?? false,
                    brightness: status?.brightness ?? null
                })
            )
        )
    );

    groups.value = results.map((r) =>
        r.status === 'fulfilled'
            ? r.value
            : {id: 0, name: null, output: false, brightness: null}
    );
    loadingGroups.value = false;
}

async function renameGroup(id: number, name: string) {
    if (!props.shellyID) return;
    busError.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Dali.Group.SetConfig', {
            shellyID: props.shellyID,
            id,
            config: {name}
        });
        const g = groups.value.find((g) => g.id === id);
        if (g) g.name = name;
    } catch (e: any) {
        busError.value = e.message || 'Failed to rename group';
    }
}

async function toggleGroup(id: number, on: boolean) {
    if (!props.entityId) return;
    try {
        await entityStore.invokeAction(props.entityId, 'setDaliGroup', {
            groupId: id,
            on
        });
        const g = groups.value.find((g) => g.id === id);
        if (g) g.output = on;
    } catch (e: any) {
        busError.value = e.message || 'Group.Set failed';
    }
}

async function setGroupBrightness(id: number, brightness: number) {
    if (!props.entityId) return;
    try {
        const actionParams: Record<string, unknown> = {
            groupId: id,
            brightness
        };
        if (brightness === 0) {
            actionParams.on = false;
        } else {
            const g = groups.value.find((g) => g.id === id);
            if (g && !g.output) actionParams.on = true;
        }
        await entityStore.invokeAction(
            props.entityId,
            'setDaliGroup',
            actionParams
        );
        const g = groups.value.find((g) => g.id === id);
        if (g) {
            g.brightness = brightness;
            if (brightness === 0) g.output = false;
            else g.output = true;
        }
    } catch (e: any) {
        busError.value = e.message || 'Group.Set failed';
    }
}

// Auto-load groups on mount if we have groups
const cgCount = computed(() => props.daliStatus?.cg_count ?? 0);
onMounted(() => {
    if (cgCount.value > 0 && props.shellyID) {
        loadGroups();
    }
});
</script>

<style scoped>
.et-dali {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

/* DALI badge */
.et-dali__badge-row {
    display: flex;
}
.et-dali__badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-sm);
    background-color: color-mix(in srgb, var(--color-status-warn) 15%, transparent);
    color: var(--color-warning-text);
    letter-spacing: var(--tracking-wide);
}

/* Section headers */
.et-dali__section-header {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-warning-text);
}

/* Bus section */
.et-dali__bus {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.et-dali__bus-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(90px, 1fr));
    gap: var(--space-1-5);
}
.et-dali__bus-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: var(--space-1-5);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-2);
}
.et-dali__bus-value {
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
}
.et-dali__bus-label {
    font-size: var(--type-body);
    color: var(--color-text-disabled);
    text-align: center;
}

/* Bus action buttons */
.et-dali__bus-actions {
    display: flex;
    gap: var(--space-1-5);
}
.et-dali__action-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1-5);
    padding: var(--space-1-5) var(--space-2);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default);
    background-color: var(--color-surface-2);
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-default),
                color var(--duration-fast) var(--ease-default);
}
.et-dali__action-btn:hover:not(:disabled) {
    background-color: var(--color-surface-3);
    color: var(--color-text-primary);
}
.et-dali__action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

/* Results display */
.et-dali__result {
    border-radius: var(--radius-md);
    background-color: var(--color-surface-2);
    overflow: hidden;
}
.et-dali__result-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-1) var(--space-2);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
}
.et-dali__result-close {
    color: var(--color-text-disabled);
    cursor: pointer;
    padding: var(--space-0-5);
}
.et-dali__result-close:hover {
    color: var(--color-text-primary);
}
.et-dali__result-data {
    padding: var(--space-1-5) var(--space-2);
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    max-height: 10rem;
    overflow-y: auto;
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
}

/* Error */
.et-dali__error {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--type-body);
    color: var(--color-danger-text);
    padding: var(--space-1) 0;
}

/* Control groups */
.et-dali__groups {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.et-dali__refresh-btn {
    margin-left: auto;
    color: var(--color-text-disabled);
    cursor: pointer;
    font-size: var(--type-body);
    padding: var(--space-0-5) var(--space-1);
}
.et-dali__refresh-btn:hover:not(:disabled) {
    color: var(--color-text-primary);
}
.et-dali__refresh-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.et-dali__group {
    border-radius: var(--radius-md);
    background-color: var(--color-surface-2);
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
}
.et-dali__group-header {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
}
.et-dali__group-name {
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    color: var(--color-text-primary);
}
.et-dali__group-name-input {
    flex: 1;
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    color: var(--color-text-primary);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    padding: var(--space-0-5) var(--space-1);
    min-width: 0;
}
.et-dali__group-name-input:focus {
    border-color: var(--color-border-strong);
    background-color: var(--color-surface-3);
    outline: none;
}
.et-dali__scan-notice {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--type-body);
    color: var(--color-warning-text);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    background-color: color-mix(in srgb, var(--color-warning) 10%, transparent);
}
.et-dali__group-state {
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    color: var(--color-text-disabled);
    letter-spacing: var(--tracking-wide);
}
.et-dali__group-state--on {
    color: var(--color-success-text);
}
.et-dali__group-toggle {
    margin-left: auto;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-full);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--type-body);
    cursor: pointer;
    border: 1px solid var(--color-border-default);
    background-color: var(--color-surface-3);
    color: var(--color-text-tertiary);
    transition: background-color var(--duration-fast) var(--ease-default),
                color var(--duration-fast) var(--ease-default);
}
.et-dali__group-toggle:hover {
    color: var(--color-text-primary);
}
.et-dali__group-toggle--on {
    background-color: var(--color-success);
    border-color: var(--color-success);
    color: var(--color-text-primary);
}

.et-dali__control--off {
    opacity: 0.45;
    transition: opacity var(--duration-fast) var(--ease-default);
}
.et-dali__control--off:hover,
.et-dali__control--off:focus-within {
    opacity: 0.8;
}

/* Load groups */
.et-dali__load-groups {
    display: flex;
}
</style>
