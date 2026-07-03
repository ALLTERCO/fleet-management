<template>
    <div class="rss">
        <div class="rss__intro">
            <h4 class="rss__heading">Find the device</h4>
            <p class="rss__subheading">
                Pick a device that's already knocking on the door, or hand the
                wizard an IP so it can reach out.
            </p>
        </div>

        <nav class="rss__tabs" role="tablist" aria-label="Discovery source">
            <template v-for="lane in lanes" :key="lane.id">
                <button
                    role="tab"
                    type="button"
                    class="rss__tab"
                    :class="{
                        'rss__tab--active': activeLane === lane.id,
                        'rss__tab--disabled': lane.disabled
                    }"
                    :aria-selected="activeLane === lane.id ? 'true' : 'false'"
                    :aria-disabled="lane.disabled ? 'true' : 'false'"
                    :data-lane="lane.id"
                    @click="onLaneClick(lane)"
                >
                    <i :class="lane.icon" aria-hidden="true" />
                    {{ lane.label }}
                </button>
            </template>
        </nav>

        <section v-if="activeLane === 'waiting'" class="rss__lane">
            <div class="rss__lane-head">
                <span class="rss__lane-hint">
                    Select devices to admit, or generate an enrollment token to
                    set one up.
                </span>
                <div class="rss__lane-actions">
                    <WaitingRoomBulkActions
                        :state="waitingState"
                        mode="pending"
                        :can-accept="canAccept"
                        :can-reject="canReject"
                    />
                </div>
            </div>
            <div
                v-if="waitingState.loading.value && !waitingState.devices.value"
                class="rss__state"
            >
                <Spinner size="sm" /> <span>Loading…</span>
            </div>
            <div
                v-else-if="waitingState.allEntries.value.length === 0"
                class="rss__state rss__state--empty"
            >
                <i class="fas fa-inbox" aria-hidden="true" />
                <span>Nothing waiting. Plug a device into the network and
                    it'll show up here.</span>
            </div>
            <div v-else class="dc-grid">
                <WaitingRoomDeviceCard
                    v-for="[internalId, device] in waitingState.paginatedItems.value"
                    :key="internalId"
                    :device="device"
                    :selected="waitingState.selectedSet.value.has(internalId)"
                    :can-accept="canAccept"
                    :can-reject="canReject"
                    show-reject
                    @click="waitingState.deviceClicked(internalId)"
                    @accept="waitingState.acceptDevice(internalId)"
                    @reject="waitingState.rejectDevice(internalId)"
                />
            </div>
        </section>

        <section v-else-if="activeLane === 'ip'" class="rss__lane">
            <form class="rss__form" @submit.prevent="onProbe">
                <FormField label="Device IP or hostname">
                    <Input
                        v-model="ipInput"
                        placeholder="192.168.1.42"
                        autocomplete="off"
                        :disabled="probing"
                    />
                </FormField>
                <Button
                    type="blue"
                    size="sm"
                    :loading="probing"
                    :disabled="!ipInput.trim().length || probing"
                    @click="onProbe"
                >
                    <i class="fas fa-magnifying-glass" aria-hidden="true" />
                    Probe device
                </Button>
            </form>
            <div v-if="probeError" class="rss__state rss__state--error">
                {{ probeError }}
            </div>
            <DiscoveredDeviceCard
                v-if="probedDevice"
                :device="probedDevice"
                v-model:password="ipPassword"
                :admitting="admitting"
                @admit="admitProbed"
            />
            <div
                v-if="ipReconnect?.status === 'waiting'"
                class="rss__state rss__state--info"
            >
                <Spinner size="sm" />
                <span>
                    Device {{ ipReconnect.shellyId }} is rebooting and
                    connecting to FM — wizard will continue automatically.
                </span>
            </div>
            <div
                v-else-if="ipReconnect?.status === 'connected'"
                class="rss__state rss__state--success"
            >
                <i class="fas fa-check-circle" aria-hidden="true" />
                Device {{ ipReconnect.shellyId }} joined the fleet.
            </div>
            <div
                v-else-if="ipReconnect?.status === 'timeout'"
                class="rss__state rss__state--error"
            >
                <i class="fas fa-triangle-exclamation" aria-hidden="true" />
                Device {{ ipReconnect.shellyId }} did not reconnect within
                the expected window. Power-cycle the device and try again
                — the admission intent is still valid.
            </div>
        </section>

        <section v-else-if="activeLane === 'scan'" class="rss__lane">
            <div v-if="!mdnsEnabled" class="rss__state rss__state--empty">
                <i class="fas fa-radar" aria-hidden="true" />
                <strong>mDNS is disabled</strong>
                <span>
                    Active LAN scanning is off in server config. Enable mDNS
                    in Settings to broadcast a query and discover devices.
                </span>
                <Button type="white" size="sm" @click="goToSettings">
                    Open Settings
                </Button>
            </div>
            <template v-else>
                <div class="rss__form">
                    <Button
                        type="blue"
                        size="sm"
                        :loading="scanning"
                        @click="onScan"
                    >
                        <i class="fas fa-radar" aria-hidden="true" />
                        {{ scanHits.length ? 'Re-scan LAN' : 'Scan LAN' }}
                    </Button>
                    <span v-if="lastScanLabel" class="rss__scan-meta">
                        {{ lastScanLabel }}
                    </span>
                </div>
                <div v-if="scanError" class="rss__state rss__state--error">
                    {{ scanError }}
                </div>
                <div
                    v-else-if="!scanning && scanHits.length === 0 && hasScanned"
                    class="rss__state rss__state--empty"
                >
                    <i class="fas fa-radar" aria-hidden="true" />
                    <span>No Shelly devices answered on the LAN.</span>
                </div>
                <ul v-else-if="scanHits.length" class="rss__scan-list">
                    <li
                        v-for="hit in scanHits"
                        :key="hit.shellyId"
                        class="rss__scan-row"
                    >
                        <DiscoveredDeviceCard
                            :device="{
                                ...hit,
                                authRequired:
                                    scanHitAuth[hit.shellyId]?.authRequired ===
                                    true
                            }"
                            :password="scanHitAuth[hit.shellyId]?.password ?? ''"
                            :admitting="admittingScanId === hit.shellyId"
                            @admit="admitScanHit(hit)"
                            @update:password="
                                (value) => (authForHit(hit.shellyId).password = value)
                            "
                        />
                    </li>
                </ul>
            </template>
        </section>
    </div>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, reactive, ref} from 'vue';
import {useRouter} from 'vue-router';
import {
    admitByHost,
    type DiscoveryProbeResult,
    type DiscoveryScanHit,
    probeHost,
    scanLan
} from '@/api/discoveryRpc';
import WaitingRoomDeviceCard from '@/components/cards/WaitingRoomDeviceCard.vue';
import Button from '@/components/core/Button.vue';
import FormField from '@/components/core/FormField.vue';
import Input from '@/components/core/Input.vue';
import Spinner from '@/components/core/Spinner.vue';
import WaitingRoomBulkActions from '@/components/ingress/WaitingRoomBulkActions.vue';
import {useWaitingRoomList} from '@/composables/useWaitingRoomList';
import {SETTINGS_PATH} from '@/constants';
import {useAuthStore} from '@/stores/auth';
import {useDevicesStore} from '@/stores/devices';
import {useSystemStore} from '@/stores/system';
import DiscoveredDeviceCard from './DiscoveredDeviceCard.vue';

const devicesStore = useDevicesStore();
const systemStore = useSystemStore();
const authStore = useAuthStore();
const router = useRouter();

// Same gates as the Waiting Room page.
const canAccept = computed(() =>
    authStore.canPerformComponent('waiting_room', 'create')
);
const canReject = computed(() =>
    authStore.canPerformComponent('waiting_room', 'delete')
);

// SSOT: reuse the Waiting Room composable — no duplicate pending/admit code.
const waitingState = useWaitingRoomList('pending');

type LaneId = 'waiting' | 'ip' | 'scan';

interface Lane {
    id: LaneId;
    label: string;
    icon: string;
    disabled?: boolean;
}

const RECONNECT_POLL_INTERVAL_MS = 2_000;
const AUTH_REQUIRED_CODE = 3404;

interface ScanHitAuth {
    password: string;
    authRequired: boolean;
}

interface ReconnectWatch {
    shellyId: string;
    deadlineMs: number;
    timerId: number;
}

const activeLane = ref<LaneId>('waiting');
const ipInput = ref('');
const ipPassword = ref('');
const probedDevice = ref<DiscoveryProbeResult | null>(null);
const probing = ref(false);
const probeError = ref<string | null>(null);
const admitting = ref(false);
const ipReconnect = ref<{
    shellyId: string;
    status: 'waiting' | 'connected' | 'timeout';
} | null>(null);

const scanHits = ref<DiscoveryScanHit[]>([]);
const scanning = ref(false);
const scanError = ref<string | null>(null);
const lastScannedAt = ref<string | null>(null);
const hasScanned = ref(false);
const admittingScanId = ref<string | null>(null);
const scanHitAuth = reactive<Record<string, ScanHitAuth>>({});

// Stale-result guard: sendRPC has no abort signal, so we discard late responses by token.
let probeToken = 0;
let reconnectWatch: ReconnectWatch | null = null;

const mdnsEnabled = computed(() => systemStore.config.mdns.enable);

const lanes = computed<Lane[]>(() => [
    {id: 'waiting', label: 'Waiting room', icon: 'fas fa-inbox'},
    {id: 'ip', label: 'Type an IP', icon: 'fas fa-network-wired'},
    {
        id: 'scan',
        label: mdnsEnabled.value ? 'Scan LAN' : 'Scan LAN (off)',
        icon: 'fas fa-radar'
    }
]);

const lastScanLabel = computed(() => {
    if (!lastScannedAt.value) return null;
    const when = new Date(lastScannedAt.value);
    return `${scanHits.value.length} found · ${formatTime(when)}`;
});

function formatTime(d: Date): string {
    return d.toLocaleTimeString();
}

function onLaneClick(lane: Lane): void {
    if (lane.disabled) return;
    activeLane.value = lane.id;
}

function goToSettings(): void {
    router.push(SETTINGS_PATH);
}

async function onProbe(): Promise<void> {
    const host = ipInput.value.trim();
    if (!host) return;
    const myToken = ++probeToken;
    probing.value = true;
    probeError.value = null;
    probedDevice.value = null;
    ipReconnect.value = null;
    try {
        const result = await probeHost(host);
        if (myToken !== probeToken) return;
        probedDevice.value = result;
    } catch (err) {
        if (myToken !== probeToken) return;
        probeError.value = errorMessage(err);
    } finally {
        if (myToken === probeToken) probing.value = false;
    }
}

function invalidateProbe(): void {
    probeToken++;
    probing.value = false;
}

async function admitProbed(): Promise<void> {
    const dev = probedDevice.value;
    if (!dev) return;
    admitting.value = true;
    probeError.value = null;
    try {
        const result = await admitByHost(dev.ip, ipPassword.value || undefined);
        startReconnectWatch(result.shellyId, result.expectedConnectionWithinSec);
    } catch (err) {
        probeError.value = errorMessage(err);
    } finally {
        admitting.value = false;
    }
}

function startReconnectWatch(shellyId: string, expectedSec: number): void {
    stopReconnectWatch();
    ipReconnect.value = {shellyId, status: 'waiting'};
    const deadlineMs = Date.now() + Math.max(30, expectedSec) * 1000;
    // WS Connect event populates the store — we only re-check the local map.
    const timerId = window.setInterval(() => {
        if (devicesStore.devices[shellyId]) {
            ipReconnect.value = {shellyId, status: 'connected'};
            stopReconnectWatch();
            return;
        }
        if (Date.now() > deadlineMs) {
            ipReconnect.value = {shellyId, status: 'timeout'};
            stopReconnectWatch();
        }
    }, RECONNECT_POLL_INTERVAL_MS);
    reconnectWatch = {shellyId, deadlineMs, timerId};
}

function stopReconnectWatch(): void {
    if (reconnectWatch) {
        window.clearInterval(reconnectWatch.timerId);
        reconnectWatch = null;
    }
}

function errorMessage(err: unknown): string {
    if (!err) return 'Unknown error';
    if (err instanceof Error) return err.message;
    const maybe = err as {message?: unknown};
    if (typeof maybe.message === 'string') return maybe.message;
    return String(err);
}

function rpcErrorCode(err: unknown): number | null {
    if (!err || typeof err !== 'object') return null;
    const code = (err as {code?: unknown}).code;
    return typeof code === 'number' ? code : null;
}

function authForHit(shellyId: string): ScanHitAuth {
    if (!scanHitAuth[shellyId]) {
        scanHitAuth[shellyId] = {password: '', authRequired: false};
    }
    return scanHitAuth[shellyId];
}

async function onScan(): Promise<void> {
    scanning.value = true;
    scanError.value = null;
    // Drop old per-hit passwords so they don't survive a re-scan.
    for (const key of Object.keys(scanHitAuth)) delete scanHitAuth[key];
    try {
        const result = await scanLan();
        scanHits.value = result.hits;
        lastScannedAt.value = result.scannedAt;
        hasScanned.value = true;
    } catch (err) {
        scanError.value = err instanceof Error ? err.message : String(err);
    } finally {
        scanning.value = false;
    }
}

async function admitScanHit(hit: DiscoveryScanHit): Promise<void> {
    if (hit.alreadyKnown) return;
    const auth = authForHit(hit.shellyId);
    admittingScanId.value = hit.shellyId;
    scanError.value = null;
    try {
        const result = await admitByHost(hit.ip, auth.password || undefined);
        startReconnectWatch(result.shellyId, result.expectedConnectionWithinSec);
    } catch (err) {
        if (rpcErrorCode(err) === AUTH_REQUIRED_CODE) {
            auth.authRequired = true;
            scanError.value =
                'Device requires a password — enter it on the card and try again.';
        } else {
            scanError.value = errorMessage(err);
        }
    } finally {
        admittingScanId.value = null;
    }
}


onMounted(() => waitingState.loadItems());

onBeforeUnmount(() => {
    invalidateProbe();
    stopReconnectWatch();
});
</script>

<style scoped>
.rss {
    display: grid;
    gap: var(--gap-lg);
}
.rss__intro {
    display: grid;
    gap: 6px;
}
.rss__eyebrow {
    font-size: var(--type-caption);
    text-transform: uppercase;
    letter-spacing: var(--tracking-caps);
    color: var(--brand-light);
    font-weight: var(--font-semibold);
}
.rss__heading {
    margin: 0;
    font-size: var(--type-display);
    line-height: var(--leading-tight);
    color: var(--color-text-primary);
    font-weight: var(--font-semibold);
}
.rss__subheading {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    max-width: 56ch;
}
.rss__tabs {
    display: flex;
    gap: var(--gap-sm);
    padding: 4px;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    width: fit-content;
}
.rss__tab {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-xs);
    padding: 8px 14px;
    background: transparent;
    border: 0;
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition:
        background var(--duration-fast),
        color var(--duration-fast);
}
.rss__tab:hover:not(.rss__tab--disabled) {
    color: var(--color-text-primary);
}
.rss__tab--active {
    background: var(--color-primary);
    color: var(--color-text-inverse);
    box-shadow: var(--shadow-brand-glow);
}
.rss__tab--disabled {
    cursor: not-allowed;
    opacity: 0.6;
}
.rss__lane {
    display: grid;
    gap: var(--gap-md);
}
.rss__lane-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-md);
    flex-wrap: wrap;
}
.rss__lane-hint {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.rss__lane-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--gap-sm);
}
.rss__form {
    display: flex;
    align-items: flex-end;
    gap: var(--gap-md);
    flex-wrap: wrap;
}
.rss__scan-meta {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.rss__state {
    display: grid;
    place-items: center;
    gap: var(--gap-sm);
    padding: var(--gap-xl);
    text-align: center;
    color: var(--color-text-secondary);
    background: var(--color-surface-2);
    border: 1px dashed var(--color-border-subtle);
    border-radius: var(--radius-md);
    min-height: 180px;
}
.rss__state--error {
    color: var(--color-warning-text);
    background: var(--color-warning-subtle);
    border-style: solid;
    min-height: 0;
    padding: var(--gap-md);
}
.rss__state--success {
    color: var(--color-success-text);
    background: var(--color-success-subtle);
    border-style: solid;
    min-height: 0;
    padding: var(--gap-md);
    flex-direction: row;
    display: flex;
    justify-content: flex-start;
    gap: var(--gap-sm);
    align-items: center;
}
.rss__state--info {
    color: var(--color-info-text);
    background: var(--color-info-subtle);
    border-style: solid;
    min-height: 0;
    padding: var(--gap-md);
    flex-direction: row;
    display: flex;
    justify-content: flex-start;
    gap: var(--gap-sm);
    align-items: center;
}
.rss__state--empty i {
    color: var(--brand-light);
    font-size: var(--type-subheading);
}
.rss__scan-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--gap-sm);
}
.rss__scan-row {
    display: contents;
}
</style>
