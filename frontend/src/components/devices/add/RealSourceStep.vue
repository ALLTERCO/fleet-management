<template>
    <div class="rss">
        <!-- The tabs say it all — no intro line repeating them. -->
        <ViewToggle v-model="activeLane" :options="laneOptions" />

        <section v-if="activeLane === 'token'" class="rss__lane">
            <EnrollmentTokenPanel />
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
        </section>

        <section v-else-if="activeLane === 'scan'" class="rss__lane">
            <div class="rss__form">
                <Button
                    type="blue"
                    size="sm"
                    :loading="scanning"
                    @click="onScan"
                >
                    <i class="fas fa-radar" aria-hidden="true" />
                    {{ scanHits.length ? 'Re-scan network' : 'Scan network' }}
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
            <div v-else-if="scanHits.length" class="dc-grid">
                <DiscoveredDeviceCard
                    v-for="hit in scanHits"
                    :key="hit.shellyId"
                    :device="enrichedHit(hit)"
                    :password="scanHitAuth[hit.shellyId]?.password ?? ''"
                    :admitting="admittingScanId === hit.shellyId"
                    @admit="admitScanHit(hit)"
                    @update:password="
                        (value) => (authForHit(hit.shellyId).password = value)
                    "
                />
            </div>
        </section>

        <!-- Admission progress — shared by the IP and scan lanes. -->
        <div
            v-if="ipReconnect?.status === 'waiting'"
            class="rss__state rss__state--info"
        >
            <Spinner size="sm" />
            <span>
                Device {{ ipReconnect.shellyId }} is rebooting and
                connecting to FM. The wizard continues automatically.
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
            the expected window. Power-cycle the device and try again.
            The admission intent is still valid.
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, reactive, ref} from 'vue';
import {
    admitByHost,
    type DiscoveryProbeResult,
    type DiscoveryScanHit,
    probeHost,
    scanLan
} from '@/api/discoveryRpc';
import Button from '@/components/core/Button.vue';
import FormField from '@/components/core/FormField.vue';
import Input from '@/components/core/Input.vue';
import Spinner from '@/components/core/Spinner.vue';
import ViewToggle, {
    type ViewToggleOption
} from '@/components/core/ViewToggle.vue';
import EnrollmentTokenPanel from '@/components/ingress/EnrollmentTokenPanel.vue';
import {useDevicesStore} from '@/stores/devices';
import {useSystemStore} from '@/stores/system';
import DiscoveredDeviceCard from './DiscoveredDeviceCard.vue';

const devicesStore = useDevicesStore();
const systemStore = useSystemStore();

type LaneId = 'token' | 'ip' | 'scan';

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

const activeLane = ref<LaneId>('token');
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

// Token first — it is the main way a device joins. The network scan tab
// exists only when the server has mDNS on; off means hidden, not greyed.
const laneOptions = computed<ViewToggleOption<LaneId>[]>(() => [
    {value: 'token', label: 'Generate token', icon: 'fas fa-key'},
    {value: 'ip', label: 'Add by IP', icon: 'fas fa-network-wired'},
    ...(mdnsEnabled.value
        ? [
              {
                  value: 'scan',
                  label: 'Network scan',
                  icon: 'fas fa-radar'
              } as ViewToggleOption<LaneId>
          ]
        : [])
]);

const lastScanLabel = computed(() => {
    if (!lastScannedAt.value) return null;
    const when = new Date(lastScannedAt.value);
    return `${scanHits.value.length} found · ${formatTime(when)}`;
});

function formatTime(d: Date): string {
    return d.toLocaleTimeString();
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
    // A new scan invalidates every in-flight enrichment probe.
    const generation = ++scanGeneration;
    scanning.value = true;
    scanError.value = null;
    // Drop old per-hit passwords and details so they don't survive a re-scan.
    for (const key of Object.keys(scanHitAuth)) delete scanHitAuth[key];
    for (const key of Object.keys(scanHitDetails)) delete scanHitDetails[key];
    try {
        const result = await scanLan();
        scanHits.value = result.hits;
        lastScannedAt.value = result.scannedAt;
        hasScanned.value = true;
        void enrichScanHits(result.hits, generation);
    } catch (err) {
        scanError.value = err instanceof Error ? err.message : String(err);
    } finally {
        scanning.value = false;
    }
}

// mDNS answers carry only id, model and IP — ask each device directly so
// the cards fill in firmware and auth info like the waiting-room cards.
const ENRICH_CONCURRENCY = 3;
let scanGeneration = 0;
const scanHitDetails = reactive<Record<string, Partial<DiscoveryProbeResult>>>(
    {}
);

function enrichedHit(hit: DiscoveryScanHit) {
    const details = scanHitDetails[hit.shellyId] ?? {};
    return {
        ...hit,
        ...details,
        authRequired:
            details.authRequired === true ||
            scanHitAuth[hit.shellyId]?.authRequired === true
    };
}

async function enrichScanHits(
    hits: DiscoveryScanHit[],
    generation: number
): Promise<void> {
    const queue = hits.filter((h) => !h.alreadyKnown);
    const workers = Array.from(
        {length: Math.min(ENRICH_CONCURRENCY, queue.length)},
        async () => {
            while (queue.length > 0 && generation === scanGeneration) {
                const hit = queue.shift();
                if (!hit) return;
                try {
                    const details = await probeHost(hit.ip);
                    // A newer scan owns the map now — drop the late answer.
                    if (generation !== scanGeneration) return;
                    scanHitDetails[hit.shellyId] = details;
                } catch {
                    // Best-effort: the card falls back to the mDNS answer.
                }
            }
        }
    );
    await Promise.all(workers);
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
                'Device requires a password. Enter it on the card and try again.';
        } else {
            scanError.value = errorMessage(err);
        }
    } finally {
        admittingScanId.value = null;
    }
}


onBeforeUnmount(() => {
    invalidateProbe();
    stopReconnectWatch();
});
</script>

<style scoped>
.rss {
    display: grid;
    gap: var(--gap-md);
}
.rss__lane {
    display: grid;
    gap: var(--gap-md);
}
/* Triage cards were built for the devices grid; inside the modal they
   size to their content so the modal never scrolls. */
.rss__lane :deep(.dtc) {
    height: auto;
    max-width: 30rem;
}
.rss__lane .dc-grid :deep(.dtc) {
    max-width: none;
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
</style>
