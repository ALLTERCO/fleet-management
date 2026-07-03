<template>
    <div class="cfg-panel">
        <div v-if="!config" class="cfg-panel__error">
            <p>Failed to load Wi-Fi configuration.</p>
            <Button type="blue-hollow" size="sm" @click="loadConfig">Retry</Button>
        </div>

        <form v-else @submit.prevent autocomplete="off">
            <!-- ── Wi-Fi client ──────────────────────────────────────── -->
            <Collapse title="Wi-Fi">
                <div class="wifi-panel">
                    <!-- Live status bar -->
                    <div class="wifi-panel__status-bar">
                        <i class="fas fa-wifi wifi-panel__status-icon" :class="wifiStatusIconClass" />
                        <span class="wifi-panel__status-ssid">{{ wifiStatusText }}</span>
                        <span
                            v-if="typeof wifiLive?.rssi === 'number'"
                            class="wifi-panel__status-rssi"
                            :class="wifiRssiClass"
                        >
                            {{ wifiLive.rssi }} dBm
                        </span>
                    </div>

                    <!-- Primary network -->
                    <div class="wifi-panel__group-header">Primary network</div>
                    <div class="cfg-panel__group">
                        <div class="cfg-panel__row">
                            <div class="cfg-panel__row-label">
                                <strong>SSID</strong>
                                <span v-if="!staEditing">{{ staSummary }}</span>
                            </div>
                            <input
                                v-model="sta.ssid"
                                autocomplete="off"
                                class="cfg-panel__input"
                                :disabled="!staEditing"
                                @input="staDirty = true"
                            />
                        </div>

                        <div v-if="staEditing" class="cfg-panel__row">
                            <div class="cfg-panel__row-label">
                                <strong>Password</strong>
                                <span>Leave empty to keep current</span>
                            </div>
                            <input
                                v-model="sta.pass"
                                type="password"
                                autocomplete="new-password"
                                class="cfg-panel__input"
                                placeholder="••••••••"
                                @input="staDirty = true"
                            />
                        </div>

                        <div class="cfg-panel__row">
                            <div class="cfg-panel__row-label"><strong>Enable</strong></div>
                            <Checkbox
                                v-model="sta.enable"
                                :disabled="!staEditing"
                                @update:model-value="staDirty = true"
                            />
                        </div>
                    </div>

                    <p v-if="staEditing" class="cfg-panel__notice wifi-panel__notice">
                        <i class="fas fa-triangle-exclamation" />
                        Wrong credentials disconnect the device — recovery requires AP rescue.
                    </p>

                    <div class="cfg-panel__footer">
                        <div class="wifi-panel__btn-group">
                            <Button
                                v-if="!staEditing"
                                type="blue-hollow"
                                size="sm"
                                @click="staEditing = true"
                            >
                                Edit
                            </Button>
                            <template v-else>
                                <Button
                                    type="blue"
                                    size="sm"
                                    :loading="savingSection === 'sta'"
                                    :disabled="!staDirty"
                                    @click="confirmAndSaveSta"
                                >
                                    Save
                                </Button>
                                <Button type="blue-hollow" size="sm" @click="cancelStaEdit">Cancel</Button>
                            </template>
                        </div>
                    </div>

                    <!-- Backup network -->
                    <div class="wifi-panel__group-header wifi-panel__group-header--divided">
                        Backup network
                    </div>
                    <div class="cfg-panel__group">
                        <div class="cfg-panel__row">
                            <div class="cfg-panel__row-label"><strong>SSID</strong></div>
                            <div class="wifi-panel__input-row">
                                <input
                                    v-model="sta1.ssid"
                                    autocomplete="off"
                                    class="cfg-panel__input"
                                    @input="sta1Dirty = true"
                                />
                                <Button type="blue-hollow" size="sm" :loading="scanning" @click="scan">
                                    Scan
                                </Button>
                            </div>
                        </div>

                        <div class="cfg-panel__row">
                            <div class="cfg-panel__row-label"><strong>Password</strong></div>
                            <input
                                v-model="sta1.pass"
                                type="password"
                                autocomplete="new-password"
                                class="cfg-panel__input"
                                placeholder="••••••••"
                                @input="sta1Dirty = true"
                            />
                        </div>

                        <div class="cfg-panel__row">
                            <div class="cfg-panel__row-label"><strong>Enable</strong></div>
                            <Checkbox
                                v-model="sta1.enable"
                                @update:model-value="sta1Dirty = true"
                            />
                        </div>

                        <div class="cfg-panel__row">
                            <div class="cfg-panel__row-label"><strong>IPv4 mode</strong></div>
                            <Dropdown
                                :default="ipv4Label(sta1.ipv4mode)"
                                :options="IPV4_MODE_LABELS"
                                @selected="(label: string) => {
                                    sta1.ipv4mode = labelToIpv4(label);
                                    sta1Dirty = true;
                                }"
                            />
                        </div>

                        <template v-if="sta1.ipv4mode === 'static'">
                            <div
                                v-for="f in STA_IP_FIELDS"
                                :key="f.key"
                                class="cfg-panel__row"
                            >
                                <div class="cfg-panel__row-label">
                                    <strong>{{ f.label }}</strong>
                                </div>
                                <input
                                    v-model="sta1[f.key]"
                                    autocomplete="off"
                                    class="cfg-panel__input"
                                    :placeholder="f.placeholder"
                                    @input="sta1Dirty = true"
                                />
                            </div>
                        </template>
                    </div>

                    <!-- Scan results inline -->
                    <div v-if="scanResults.length > 0" class="wifi-panel__scan-results">
                        <div
                            v-for="net in scanResults"
                            :key="net.bssid ?? net.ssid"
                            class="cfg-panel__row"
                        >
                            <div class="cfg-panel__row-label">
                                <strong>{{ net.ssid || '(hidden)' }}</strong>
                                <span>{{ scanRowSubtitle(net) }}</span>
                            </div>
                            <Button type="blue-hollow" size="sm" @click="useScanResult(net)">Use</Button>
                        </div>
                    </div>

                    <div v-if="sta1Dirty" class="cfg-panel__footer">
                        <Button
                            type="blue"
                            size="sm"
                            :loading="savingSection === 'sta1'"
                            @click="saveSta1"
                        >
                            Save
                        </Button>
                    </div>

                    <!-- Roaming -->
                    <div class="wifi-panel__group-header wifi-panel__group-header--divided">
                        Roaming
                    </div>
                    <div class="cfg-panel__group">
                        <div class="cfg-panel__row">
                            <div class="cfg-panel__row-label">
                                <strong>RSSI threshold</strong>
                                <span>Switch AP below {{ roam.rssiThr }} dBm</span>
                            </div>
                            <input
                                v-model.number="roam.rssiThr"
                                type="range"
                                min="-100"
                                max="0"
                                step="1"
                                class="wifi-panel__slider"
                                @input="roamDirty = true"
                            />
                        </div>

                        <div class="cfg-panel__row">
                            <div class="cfg-panel__row-label">
                                <strong>Scan interval</strong>
                                <span>seconds (5 – 3600)</span>
                            </div>
                            <input
                                v-model.number="roam.interval"
                                type="number"
                                min="5"
                                max="3600"
                                autocomplete="off"
                                class="cfg-panel__input wifi-panel__num-input"
                                @input="roamDirty = true"
                            />
                        </div>
                    </div>

                    <div v-if="roamDirty" class="cfg-panel__footer">
                        <Button
                            type="blue"
                            size="sm"
                            :loading="savingSection === 'roam'"
                            @click="saveRoam"
                        >
                            Save
                        </Button>
                    </div>

                    <!-- Saved networks -->
                    <template v-if="supportsSavedNetworks">
                    <div class="wifi-panel__group-header wifi-panel__group-header--divided">
                        Saved networks
                    </div>
                    <div class="cfg-panel__group">
                        <div class="cfg-panel__row">
                            <span class="wifi-panel__muted">Networks the device remembers across slots.</span>
                            <Button type="blue-hollow" size="sm" @click="loadSaved">
                                Refresh
                            </Button>
                        </div>
                        <div v-if="loadingSaved" class="cfg-panel__row">
                            <span class="wifi-panel__muted">Loading…</span>
                        </div>
                        <div v-else-if="savedNetworks.length === 0" class="cfg-panel__row">
                            <span class="wifi-panel__muted">No saved networks.</span>
                        </div>
                        <div
                            v-for="n in savedNetworks"
                            v-else
                            :key="n.id"
                            class="cfg-panel__row"
                        >
                            <div class="cfg-panel__row-label">
                                <strong>{{ n.ssid || '(hidden)' }}</strong>
                                <span>id {{ n.id }}</span>
                            </div>
                            <Button type="red" size="sm" @click="deleteSaved(n)">Delete</Button>
                        </div>
                    </div>
                    </template>
                </div>
            </Collapse>

            <!-- ── Access Point ──────────────────────────────────────── -->
            <Collapse title="Access Point">
                <div class="cfg-panel__group">
                    <div class="cfg-panel__row">
                        <div class="cfg-panel__row-label"><strong>SSID</strong></div>
                        <input
                            v-model="ap.ssid"
                            autocomplete="off"
                            class="cfg-panel__input"
                            @input="apDirty = true"
                        />
                    </div>

                    <div class="cfg-panel__row">
                        <div class="cfg-panel__row-label"><strong>Password</strong></div>
                        <input
                            v-model="ap.pass"
                            type="password"
                            autocomplete="new-password"
                            class="cfg-panel__input"
                            placeholder="••••••••"
                            @input="apDirty = true"
                        />
                    </div>

                    <div class="cfg-panel__row">
                        <div class="cfg-panel__row-label"><strong>Open (no password)</strong></div>
                        <Checkbox v-model="ap.is_open" @update:model-value="apDirty = true" />
                    </div>

                    <div class="cfg-panel__row">
                        <div class="cfg-panel__row-label">
                            <strong>Enable</strong>
                            <span>Use the device's physical button to disable AP fallback.</span>
                        </div>
                        <Checkbox
                            v-model="ap.enable"
                            :title="AP_DISABLE_TOOLTIP"
                            @update:model-value="onApEnableToggle"
                        />
                    </div>

                    <div class="cfg-panel__row">
                        <div class="cfg-panel__row-label">
                            <strong>Range extender</strong>
                            <span>Forward connected clients to the upstream network.</span>
                        </div>
                        <Checkbox v-model="ap.rangeExtender" @update:model-value="apDirty = true" />
                    </div>
                </div>

                <div v-if="apDirty" class="cfg-panel__footer">
                    <Button
                        type="blue"
                        size="sm"
                        :loading="savingSection === 'ap'"
                        @click="saveAp"
                    >
                        Save
                    </Button>
                </div>
            </Collapse>
        </form>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, reactive, ref, watch} from 'vue';
import {useDevicesStore} from '@/stores/devices';
import {useToastStore} from '@/stores/toast';
import {sendRPC} from '@/tools/websocket';
import Button from './Button.vue';
import Checkbox from './Checkbox.vue';
import Collapse from './Collapse.vue';
import Dropdown from './Dropdown.vue';

interface StaConfig {
    ssid?: string | null;
    pass?: string | null;
    enable?: boolean;
    is_open?: boolean;
    ipv4mode?: string;
    ip?: string | null;
    netmask?: string | null;
    gw?: string | null;
    nameserver?: string | null;
}

interface ApConfig {
    ssid?: string;
    pass?: string | null;
    is_open?: boolean;
    enable?: boolean;
    range_extender?: {enable?: boolean};
}

interface RoamConfig {
    rssi_thr?: number;
    interval?: number;
}

interface WifiConfigShape {
    sta?: StaConfig;
    sta1?: StaConfig;
    ap?: ApConfig;
    roam?: RoamConfig;
}

interface ScanNetwork {
    ssid?: string;
    bssid?: string;
    rssi?: number;
    channel?: number;
    auth?: string;
    [k: string]: unknown;
}

interface SavedNetwork {
    id: number;
    ssid?: string;
    [k: string]: unknown;
}

type Section = 'sta' | 'sta1' | 'ap' | 'roam';

const IPV4_MODE_LABELS = ['DHCP', 'Static'];
const STA_IP_FIELDS = [
    {key: 'ip' as const, label: 'IP address', placeholder: '192.168.1.50'},
    {key: 'netmask' as const, label: 'Netmask', placeholder: '255.255.255.0'},
    {key: 'gw' as const, label: 'Gateway', placeholder: '192.168.1.1'},
    {
        key: 'nameserver' as const,
        label: 'DNS server',
        placeholder: '1.1.1.1'
    }
] as const;
const AP_DISABLE_TOOLTIP =
    "Use the device's physical button to disable AP fallback";

const props = defineProps<{shellyID: string}>();
const deviceStore = useDevicesStore();
const toast = useToastStore();

const config = ref<WifiConfigShape | null>(null);
const savingSection = ref<Section | null>(null);

const sta = reactive<StaConfig & {pass: string}>({
    ssid: '',
    pass: '',
    enable: true
});
const staEditing = ref(false);
const staDirty = ref(false);

const sta1 = reactive<StaConfig & {pass: string; ipv4mode: string}>({
    ssid: '',
    pass: '',
    enable: false,
    ipv4mode: 'dhcp',
    ip: '',
    netmask: '',
    gw: '',
    nameserver: ''
});
const sta1Dirty = ref(false);

const ap = reactive({
    ssid: '',
    pass: '',
    is_open: false,
    enable: true,
    rangeExtender: false
});
const apDirty = ref(false);

const roam = reactive({rssiThr: -80, interval: 60});
const roamDirty = ref(false);

const scanResults = ref<ScanNetwork[]>([]);
const scanning = ref(false);
const savedNetworks = ref<SavedNetwork[]>([]);
const loadingSaved = ref(false);

const deviceEntry = computed(() => deviceStore.devices[props.shellyID]);
const wifiLive = computed(() => (deviceEntry.value?.status as any)?.wifi);

// True if methods list is empty (unknown) or explicitly includes this method.
// Prevents calling SavedNetworks.List on devices that don't support it.
const supportsSavedNetworks = computed(() => {
    const methods = deviceEntry.value?.methods;
    return !methods?.length || methods.includes('Wifi.SavedNetworks.List');
});

const wifiStatusText = computed(() => {
    const live = wifiLive.value;
    if (!live?.ssid) return 'Not connected';
    const status = live.status ?? '';
    return status === 'got ip' ? live.ssid : `${live.ssid} · ${status}`;
});

const wifiStatusIconClass = computed(() => {
    const live = wifiLive.value;
    if (!live?.ssid) return 'wifi-panel__status-icon--off';
    return live.status === 'got ip'
        ? 'wifi-panel__status-icon--on'
        : 'wifi-panel__status-icon--warn';
});

const wifiRssiClass = computed(() => {
    const rssi = wifiLive.value?.rssi;
    if (typeof rssi !== 'number') return '';
    if (rssi >= -60) return 'wifi-panel__rssi--good';
    if (rssi >= -75) return 'wifi-panel__rssi--ok';
    return 'wifi-panel__rssi--warn';
});

const staSummary = computed(() => {
    const live = wifiLive.value;
    if (live?.ssid) {
        const rssi =
            typeof live.rssi === 'number' ? `, ${live.rssi} dBm` : '';
        const status = live.status ?? 'unknown';
        return `${live.ssid} (${status}${rssi})`;
    }
    return config.value?.sta?.ssid ?? '(not configured)';
});

function ipv4Label(mode: string | undefined): string {
    return mode === 'static' ? 'Static' : 'DHCP';
}

function labelToIpv4(label: string): string {
    return label === 'Static' ? 'static' : 'dhcp';
}

function loadConfig(): void {
    const c = deviceStore.devices[props.shellyID]?.settings
        ?.wifi as WifiConfigShape | undefined;
    if (!c) {
        config.value = null;
        return;
    }
    config.value = c;

    sta.ssid = c.sta?.ssid ?? '';
    sta.pass = '';
    sta.enable = c.sta?.enable ?? true;
    staEditing.value = false;
    staDirty.value = false;

    sta1.ssid = c.sta1?.ssid ?? '';
    sta1.pass = '';
    sta1.enable = c.sta1?.enable ?? false;
    sta1.ipv4mode = c.sta1?.ipv4mode ?? 'dhcp';
    sta1.ip = c.sta1?.ip ?? '';
    sta1.netmask = c.sta1?.netmask ?? '';
    sta1.gw = c.sta1?.gw ?? '';
    sta1.nameserver = c.sta1?.nameserver ?? '';
    sta1Dirty.value = false;

    ap.ssid = c.ap?.ssid ?? '';
    ap.pass = '';
    ap.is_open = c.ap?.is_open ?? false;
    ap.enable = c.ap?.enable ?? true;
    ap.rangeExtender = c.ap?.range_extender?.enable ?? false;
    apDirty.value = false;

    roam.rssiThr = c.roam?.rssi_thr ?? -80;
    roam.interval = c.roam?.interval ?? 60;
    roamDirty.value = false;
}

async function saveSection(
    section: Section,
    slice: WifiConfigShape,
    label: string,
    onSuccess?: () => void
): Promise<void> {
    savingSection.value = section;
    try {
        await sendRPC('FLEET_MANAGER', 'Wifi.SetConfig', {
            shellyID: props.shellyID,
            config: slice
        });
        toast.success(label);
        onSuccess?.();
    } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : ((err as any)?.message ?? String(err)));
    } finally {
        savingSection.value = null;
    }
}

function cancelStaEdit(): void {
    staEditing.value = false;
    staDirty.value = false;
    if (config.value?.sta) {
        sta.ssid = config.value.sta.ssid ?? '';
        sta.pass = '';
        sta.enable = config.value.sta.enable ?? true;
    }
}

async function confirmAndSaveSta(): Promise<void> {
    if (!confirm('Wrong credentials will disconnect the device. Continue?')) {
        return;
    }
    const slice: StaConfig = {ssid: sta.ssid || null, enable: sta.enable};
    if (sta.pass) slice.pass = sta.pass;
    await saveSection('sta', {sta: slice}, 'Primary Wi-Fi saved', () => {
        staDirty.value = false;
        staEditing.value = false;
        sta.pass = '';
    });
}

async function saveSta1(): Promise<void> {
    const slice: StaConfig = {
        ssid: sta1.ssid || null,
        enable: sta1.enable,
        ipv4mode: sta1.ipv4mode
    };
    if (sta1.pass) slice.pass = sta1.pass;
    if (sta1.ipv4mode === 'static') {
        slice.ip = sta1.ip || null;
        slice.netmask = sta1.netmask || null;
        slice.gw = sta1.gw || null;
        slice.nameserver = sta1.nameserver || null;
    }
    await saveSection('sta1', {sta1: slice}, 'Backup Wi-Fi saved', () => {
        sta1Dirty.value = false;
        sta1.pass = '';
    });
}

async function saveAp(): Promise<void> {
    const slice: ApConfig = {
        ssid: ap.ssid,
        is_open: ap.is_open,
        enable: ap.enable,
        range_extender: {enable: ap.rangeExtender}
    };
    if (ap.pass) slice.pass = ap.pass;
    await saveSection('ap', {ap: slice}, 'AP fallback saved', () => {
        apDirty.value = false;
        ap.pass = '';
    });
}

async function saveRoam(): Promise<void> {
    await saveSection(
        'roam',
        {roam: {rssi_thr: roam.rssiThr, interval: roam.interval}},
        'Roaming settings saved',
        () => {
            roamDirty.value = false;
        }
    );
}

function onApEnableToggle(value: boolean): void {
    if (!value) {
        ap.enable = true;
        toast.info(AP_DISABLE_TOOLTIP);
        return;
    }
    apDirty.value = true;
}

async function scan(): Promise<void> {
    scanning.value = true;
    try {
        const res = await sendRPC<
            {results?: ScanNetwork[]} | ScanNetwork[]
        >('FLEET_MANAGER', 'Wifi.Scan', {shellyID: props.shellyID});
        scanResults.value = Array.isArray(res) ? res : (res?.results ?? []);
        if (scanResults.value.length === 0) {
            toast.info('Scan finished — no networks reported');
        }
    } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : ((err as any)?.message ?? String(err)));
    } finally {
        scanning.value = false;
    }
}

function scanRowSubtitle(net: ScanNetwork): string {
    const parts: string[] = [];
    if (typeof net.rssi === 'number') parts.push(`${net.rssi} dBm`);
    if (typeof net.channel === 'number') parts.push(`ch ${net.channel}`);
    if (net.auth) parts.push(net.auth);
    return parts.join(' · ');
}

function useScanResult(net: ScanNetwork): void {
    if (!net.ssid) {
        toast.error('Network has no SSID');
        return;
    }
    sta1.ssid = net.ssid;
    sta1.enable = true;
    sta1Dirty.value = true;
    toast.info(`sta1 staged with ${net.ssid} — set password and Save`);
}

async function loadSaved(): Promise<void> {
    if (!supportsSavedNetworks.value) return;
    loadingSaved.value = true;
    try {
        const res = await sendRPC<
            {networks?: SavedNetwork[]} | SavedNetwork[]
        >('FLEET_MANAGER', 'Wifi.SavedNetworks.List', {
            shellyID: props.shellyID
        });
        savedNetworks.value = Array.isArray(res)
            ? res
            : (res?.networks ?? []);
    } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : ((err as any)?.message ?? String(err)));
        savedNetworks.value = [];
    } finally {
        loadingSaved.value = false;
    }
}

async function deleteSaved(n: SavedNetwork): Promise<void> {
    if (!confirm(`Delete saved network "${n.ssid ?? `id ${n.id}`}"?`)) return;
    try {
        await sendRPC('FLEET_MANAGER', 'Wifi.SavedNetworks.Delete', {
            shellyID: props.shellyID,
            id: n.id
        });
        toast.success('Saved network deleted');
        await loadSaved();
    } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : ((err as any)?.message ?? String(err)));
    }
}

onMounted(() => {
    loadConfig();
    void loadSaved();
});

watch(
    () => props.shellyID,
    () => {
        loadConfig();
        scanResults.value = [];
        void loadSaved();
    }
);
</script>

<style scoped>
/* ── Panel wrapper ── */
.wifi-panel {
    display: flex;
    flex-direction: column;
}

/* ── Live status bar ── */
.wifi-panel__status-bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--color-border-default);
}

.wifi-panel__status-icon {
    font-size: var(--type-caption);
    color: var(--color-text-disabled);
    width: var(--icon-size-sm);
    text-align: center;
}

.wifi-panel__status-icon--on  { color: var(--color-success-text); }
.wifi-panel__status-icon--warn { color: var(--color-warning-text); }
.wifi-panel__status-icon--off  { color: var(--color-text-disabled); }

.wifi-panel__status-ssid {
    flex: 1;
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.wifi-panel__status-rssi {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
}

.wifi-panel__rssi--good { color: var(--color-success-text); }
.wifi-panel__rssi--ok   { color: var(--color-text-secondary); }
.wifi-panel__rssi--warn { color: var(--color-warning-text); }

/* ── Section group headers ── */
.wifi-panel__group-header {
    font-size: var(--type-caption);
    font-weight: var(--font-bold);
    color: var(--color-text-disabled);
    padding: var(--space-2) var(--space-3) 0;
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
}

.wifi-panel__group-header--divided {
    margin-top: var(--space-1);
    padding-top: var(--space-3);
    border-top: 1px solid var(--color-border-subtle);
}

/* ── SSID row: input + scan button side by side ── */
.wifi-panel__input-row {
    display: flex;
    align-items: center;
    gap: var(--space-1);
}

/* ── Scan results ── */
.wifi-panel__scan-results {
    border-top: 1px solid var(--color-border-subtle);
}

/* ── Notice (warning banner) ── */
.wifi-panel__notice {
    margin: 0 var(--space-3) var(--space-1);
}

/* ── Misc ── */
.wifi-panel__btn-group {
    display: flex;
    gap: var(--space-2);
}

.wifi-panel__muted {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    flex: 1;
}

.wifi-panel__slider {
    width: var(--floating-w-xs);
    accent-color: var(--color-primary);
}

.wifi-panel__num-input {
    width: var(--space-20);
}
</style>
