<template>
    <section class="blu-find">
        <header v-if="!embedded" class="blu-find__head">
            <h4 class="blu-find__title">Add a Bluetooth device</h4>
            <p class="blu-find__lede">
                Scan for BLU sensors and remotes in range of this gateway, or
                type a known address.
            </p>
        </header>

        <div class="blu-find__toolbar">
            <ViewToggle v-model="mode" :options="MODE_OPTIONS" />

            <Button
                v-if="mode === 'scan' && scanning"
                type="blue-hollow"
                size="md"
                @click="stopScan"
            >
                Stop scanning
            </Button>
            <Button
                v-else-if="mode === 'scan'"
                type="blue-hollow"
                size="md"
                @click="startScan"
            >
                Scan for devices
            </Button>
        </div>

        <div v-if="scanning" class="blu-find__progress">
            <div
                class="blu-find__bar"
                role="progressbar"
                :aria-valuemin="0"
                :aria-valuemax="windowSec"
                :aria-valuenow="windowSec - secondsLeft"
                aria-label="Scan progress"
            >
                <span
                    class="blu-find__bar-fill"
                    :style="{transform: `scaleX(${scanProgress})`}"
                />
            </div>
            <p class="blu-find__hint" role="status">
                <i class="fas fa-hand-pointer" aria-hidden="true" />
                <span>{{ WAKE_HINT }}</span>
                <span class="blu-find__countdown">{{ secondsLeft }}s left</span>
            </p>
        </div>

        <form
            v-if="mode === 'manual'"
            class="blu-find__manual"
            @submit.prevent="addByAddress"
        >
            <div class="blu-find__manual-field">
                <Input
                    v-model="newDeviceAddr"
                    label="Bluetooth address"
                    placeholder="AA:BB:CC:DD:EE:FF"
                    autocomplete="off"
                    :error="addrError"
                    :disabled="addingDevice"
                />
            </div>
            <Button type="green" size="md" submit :loading="addingDevice">
                Pair
            </Button>
        </form>

        <WizardState v-if="scanError" tone="error">
            {{ scanError }}
            <template #action>
                <Button type="blue-hollow" size="sm" @click="startScan">
                    Retry
                </Button>
            </template>
        </WizardState>

        <WizardState v-if="loadError" tone="error">
            {{ loadError }}
            <template #action>
                <Button type="blue-hollow" size="sm" @click="loadPreviouslySeen">
                    Retry
                </Button>
            </template>
        </WizardState>

        <template v-if="mode === 'scan'">
        <TransitionGroup
            v-if="discovered.length > 0"
            tag="ul"
            name="blu-row"
            class="stack-list"
        >
            <li
                v-for="(dev, index) in discovered"
                :key="dev.mac"
                :style="{'--row-index': String(index)}"
            >
                <PickRow :interactive="false">
                    <template #lead>
                        <i class="fab fa-bluetooth-b" aria-hidden="true" />
                    </template>

                    {{ bluDisplayName(toNameable(dev)) }}

                    <template v-if="bluDetailLine(toNameable(dev)) || heardLabel(dev)" #meta>
                        <span v-if="bluDetailLine(toNameable(dev))" class="mono-id">
                            {{ bluDetailLine(toNameable(dev)) }}
                        </span>
                        <span v-if="heardLabel(dev)" class="bdp__heard">
                            {{ heardLabel(dev) }}
                        </span>
                    </template>

                    <template #trail>
                        <span
                            v-if="dev.isRemote"
                            class="meta-pill"
                            title="Buttons on this device can drive a relay"
                        >
                            <i class="fas fa-graduation-cap" aria-hidden="true" />
                            Controls
                        </span>
                        <span
                            v-if="dev.rssi != null"
                            class="meta-pill"
                            :title="`Signal ${dev.rssi} dBm`"
                        >
                            <i class="fas fa-signal" aria-hidden="true" />
                            {{ dev.rssi }}
                        </span>
                        <span
                            v-if="inFleet(dev.mac)"
                            class="meta-pill meta-pill--success"
                            title="This sensor is already a device in your fleet"
                        >
                            Added
                        </span>
                        <Button
                            v-else
                            type="green"
                            size="sm"
                            :loading="pairingMac === dev.mac"
                            :disabled="!!pairingMac"
                            @click="pairDiscovered(dev.mac)"
                        >
                            Pair
                        </Button>
                    </template>
                </PickRow>
            </li>
        </TransitionGroup>

        <WizardState
            v-else-if="scanning"
            tone="empty"
            icon="fas fa-satellite-dish fa-fade"
        >
            Listening. A sleeping BLU only answers while it broadcasts.
        </WizardState>
        <WizardState v-else-if="scanned" tone="empty">
            <template v-if="scan.alreadyPairedCount.value > 0">
                Every device nearby is already paired to this gateway.
            </template>
            <template v-else>Nothing answered. {{ WAKE_HINT }}</template>
        </WizardState>
        <WizardState v-else tone="empty" icon="fas fa-satellite-dish">
            Nothing scanned yet. {{ WAKE_HINT }}
        </WizardState>
        </template>
    </section>
</template>

<script setup lang="ts">
import {computed, onUnmounted, ref, toRef, watch} from 'vue';
import {useBluScan} from '@/composables/useBluScan';
import {
    type BluNameable,
    bluDetailLine,
    bluDisplayName
} from '@/helpers/bluNaming';
import {
    pairedBluAddresses,
    readPairedBluDevices
} from '@/helpers/bluPairedDevices';
import {formatRelative} from '@/helpers/format';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {useDevicesStore} from '@/stores/devices';
import {useToastStore} from '@/stores/toast';
import type {BTHomeDiscoveryEvent} from '@/tools/websocket';
import * as ws from '@/tools/websocket';
import Button from './Button.vue';
import Input from './Input.vue';
import ViewToggle, {type ViewToggleOption} from './ViewToggle.vue';
import PickRow from './wizard/PickRow.vue';
import WizardState from './wizard/WizardState.vue';

const props = defineProps<{
    shellyID: string;
    // Set by a host that already titles this step, so the panel does not
    // repeat the heading underneath it.
    embedded?: boolean;
}>();
const emit = defineEmits<{
    paired: [mac: string, meta?: {alreadyPaired: boolean}];
}>();

const deviceStore = useDevicesStore();
const toast = useToastStore();

// A BLU only answers while it is broadcasting, and an idle one beacons minutes
// to hours apart. Say so rather than reporting an empty scan as a dead end.
const WAKE_HINT =
    'Press the button on your BLU device to wake it, then scan again.';
const MAC_PATTERN = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/;

const newDeviceAddr = ref('');
const addrError = ref('');
const addingDevice = ref(false);
const pairingMac = ref<string | null>(null);
const scanned = ref(false);
const loadError = ref('');
const scanError = ref('');
/** What the gateway heard before this session, read back from the backend so a
 *  reload or a late-joining operator still sees it. */
const previouslySeen = ref<BTHomeDiscoveryEvent[]>([]);

const pairedAddrs = computed(() => {
    // devicesVersion is the store's own signal; settings are patched in place
    // so the object reference never changes and cannot be watched directly.
    void deviceStore.devicesVersion;
    const gateway = deviceStore.devices[props.shellyID];
    return pairedBluAddresses(
        readPairedBluDevices(gateway?.settings, gateway?.status)
    );
});

// A sensor that is already a device in the fleet is not new. It stays in the
// list so the operator sees it was heard, marked Added, with no pair button.
const inFleetAddrs = computed(() => {
    void deviceStore.devicesVersion;
    const out = new Set<string>();
    for (const device of Object.values(deviceStore.devices)) {
        const addr = (device as {source?: string; info?: {bleAddress?: string}})
            .source === 'bluetooth'
            ? (device as {info?: {bleAddress?: string}}).info?.bleAddress
            : undefined;
        if (addr) out.add(addr.toUpperCase());
    }
    return out;
});
function inFleet(mac: string): boolean {
    return inFleetAddrs.value.has(mac.toUpperCase());
}
/** "Heard 3m ago", or nothing when the gateway did not say when. */
function heardLabel(dev: {heardAtMs?: number}): string {
    return dev.heardAtMs ? `Heard ${formatRelative(dev.heardAtMs)}` : '';
}

const scan = useBluScan(toRef(props, 'shellyID'), (mac) =>
    pairedAddrs.value.has(mac)
);
const scanning = scan.scanning;

type AddMode = 'scan' | 'manual';

const MODE_OPTIONS: ViewToggleOption<AddMode>[] = [
    {value: 'scan', label: 'Scan'},
    {value: 'manual', label: 'By address'}
];
const mode = ref<AddMode>('scan');

// Leaving the scan lane mid-scan would leave the session running unseen.
watch(mode, (next) => {
    if (next !== 'scan' && scanning.value) stopScan();
});

// The backend owns the scan length, so the total is only knowable once a scan
// starts. Capture it then, to size the progress bar against.
const windowSec = ref(0);
watch(scanning, (on) => {
    if (on) windowSec.value = scan.secondsLeft.value;
});
const scanProgress = computed(() =>
    windowSec.value === 0
        ? 0
        : (windowSec.value - scan.secondsLeft.value) / windowSec.value
);

// stop() tears the session down but leaves `scanned` alone, so set it here:
// a cancelled scan has still been run, and the empty state should say so.
function stopScan(): void {
    scan.stop();
    scanned.value = true;
}
const secondsLeft = scan.secondsLeft;

// Live finds win over remembered ones; anything already paired drops out as
// soon as it is paired, without waiting for the next scan.
const discovered = computed(() => {
    const byMac = new Map<string, BTHomeDiscoveryEvent>();
    for (const seen of previouslySeen.value) {
        byMac.set(seen.mac.toUpperCase(), seen);
    }
    for (const live of scan.found.value) {
        byMac.set(live.mac.toUpperCase(), live);
    }
    return [...byMac.values()].filter(
        (d) => !pairedAddrs.value.has(d.mac.toUpperCase())
    );
});

function toNameable(dev: BTHomeDiscoveryEvent): BluNameable {
    return {
        productName: dev.productName,
        modelId: dev.modelString,
        localName: dev.localName,
        addr: dev.mac
    };
}

/** Read back what this gateway already heard, so the panel opens with results
 *  instead of a blank list and a reload does not lose a scan. */
async function loadPreviouslySeen() {
    loadError.value = '';
    try {
        const res = await ws.sendRPC('FLEET_MANAGER', 'BTHome.ListDiscovered', {
            shellyID: props.shellyID
        });
        previouslySeen.value = res?.items ?? [];
    } catch (err: any) {
        previouslySeen.value = [];
        loadError.value = rpcErrorMessage(err, 'Could not load nearby devices');
    }
}

async function startScan() {
    scanError.value = '';
    try {
        await scan.start();
        scanned.value = true;
    } catch (err: any) {
        scanError.value = rpcErrorMessage(err, 'Could not start the scan');
    }
}

async function pairDevice(mac: string, extra: Record<string, unknown> = {}) {
    return ws.sendRPC('FLEET_MANAGER', 'BTHome.Device.AddManual', {
        shellyID: props.shellyID,
        mac,
        ...extra
    });
}

async function pairDiscovered(mac: string) {
    pairingMac.value = mac;
    const dev = discovered.value.find((d) => d.mac === mac);
    const label = dev ? bluDisplayName(toNameable(dev)) : mac;
    try {
        const result = await pairDevice(mac, {
            productName: dev?.productName ?? dev?.name ?? undefined,
            modelId: dev?.modelString ?? undefined
        });
        toast[result?.alreadyPaired ? 'info' : 'success'](
            result?.alreadyPaired
                ? `${label} was already paired`
                : `${label} paired`
        );
        emit('paired', mac, {alreadyPaired: result?.alreadyPaired === true});
    } catch (err: any) {
        toast.error(rpcErrorMessage(err, `Could not pair ${label}`));
    } finally {
        pairingMac.value = null;
    }
}

async function addByAddress() {
    const addr = newDeviceAddr.value.trim().toUpperCase();
    if (!MAC_PATTERN.test(addr)) {
        addrError.value = 'Use six pairs of hex, like AA:BB:CC:DD:EE:FF';
        return;
    }
    addrError.value = '';
    addingDevice.value = true;
    try {
        const result = await pairDevice(addr);
        toast[result?.alreadyPaired ? 'info' : 'success'](
            result?.alreadyPaired
                ? `${addr} was already paired`
                : `${addr} paired`
        );
        newDeviceAddr.value = '';
        emit('paired', addr, {alreadyPaired: result?.alreadyPaired === true});
    } catch (err: any) {
        addrError.value = rpcErrorMessage(err, 'Could not pair that address');
    } finally {
        addingDevice.value = false;
    }
}

watch(() => props.shellyID, reload, {immediate: true});

function reload() {
    scan.stop();
    scanned.value = false;
    previouslySeen.value = [];
    loadPreviouslySeen();
}

onUnmounted(() => scan.stop());

defineExpose({reload});
</script>

<style scoped>
.bdp__heard {
    margin-left: var(--space-2);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
}

/* No card. The modal is already a surface and the step already has a title
   above it, so a box here was a third frame around the same content. The
   results region is what grows. */
.blu-find {
    display: flex;
    flex-direction: column;
    gap: var(--gap-md);
    min-height: 0;
}

.blu-find__head {
    display: flex;
    flex-direction: column;
    gap: var(--gap-2xs);
}

.blu-find__title {
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.blu-find__lede {
    margin: 0;
    max-width: var(--wizard-lede-width);
    font-size: var(--type-body);
    color: var(--color-text-secondary);
}

/* Mode switch left, action right, one line. */
.blu-find__toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-sm);
    flex-wrap: wrap;
    /* The results area below is flex:1 and will happily crush this row to
       nothing, which clips the tab labels and the button. */
    flex-shrink: 0;
}

.blu-find__progress {
    display: flex;
    flex-direction: column;
    gap: var(--gap-xs);
    flex-shrink: 0;
}

.blu-find__bar {
    height: var(--space-1);
    border-radius: var(--radius-full);
    background: var(--glass-input);
    overflow: hidden;
}

/* scaleX keeps the fill on the compositor; a width transition would relayout
   every second. transform-origin left so it grows from the start of the bar. */
.blu-find__bar-fill {
    display: block;
    height: 100%;
    border-radius: var(--radius-full);
    background: var(--color-primary);
    transform-origin: left center;
    transition: transform var(--duration-scan-tick) linear;
}

.blu-find__hint {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    margin: 0;
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

.blu-find__hint i {
    color: var(--color-primary);
}

.blu-find__countdown {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
    color: var(--color-text-secondary);
}

/* The bar is the honest signal; without motion the number still counts down. */
@media (prefers-reduced-motion: reduce) {
    .blu-find__bar-fill {
        transition: none;
    }
}

.blu-find__manual {
    display: flex;
    align-items: flex-end;
    gap: var(--gap-xs);
    flex-shrink: 0;
}

.blu-find__manual-field {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
}




/* Rows stream in as the gateway hears them. Short stagger, exponential
   ease-out, and never from scale(0) — the row was always a real object. */
.blu-row-enter-active {
    transition:
        opacity var(--duration-normal) var(--ease-out),
        transform var(--duration-normal) var(--ease-out);
    transition-delay: calc(var(--row-index) * var(--duration-fast));
}

.blu-row-enter-from {
    opacity: 0;
    transform: translateY(6px);
}

.blu-row-leave-active {
    transition: opacity var(--duration-quick) var(--ease-out);
}

.blu-row-leave-to {
    opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
    .blu-row-enter-active,
    .blu-row-leave-active {
        transition-duration: 1ms;
        transition-delay: 0ms;
    }

    .blu-row-enter-from {
        transform: none;
    }
}
</style>
