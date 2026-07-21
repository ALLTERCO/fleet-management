<template>
    <div class="cfg-panel">
        <div v-if="!config && refetching" class="cfg-panel__loading">
            Loading configuration…
        </div>
        <div v-else-if="!config" class="cfg-panel__error" role="alert">
            <p>Failed to load Wi-Fi configuration.</p>
            <Button
                type="blue-hollow"
                size="sm"
                :loading="refetching"
                @click="refetchConfig"
            >
                Retry
            </Button>
        </div>

        <form v-else class="wifi-panel" @submit.prevent autocomplete="off">
            <!-- Each nav item mounts its own instance: view picks the page. -->
            <section
                v-if="view === 'primary' || view === 'backup'"
                class="wifi-panel__workspace"
            >
                <section
                    v-if="view === 'primary'"
                    class="wifi-panel__settings-section"
                    aria-label="Wi-Fi 1 network"
                >
                    <!-- Apple's shape: name, status, Details. IP and signal
                         live behind Details. -->
                    <div
                        v-if="!staEditing"
                        class="wifi-panel__connection wifi-panel__connection--flat"
                        aria-label="Current Wi-Fi connection"
                    >
                        <i
                            class="fas fa-wifi wifi-panel__connection-icon"
                            :class="wifiStatusIconClass"
                            :title="typeof wifiLive?.rssi === 'number' ? `${wifiLive.rssi} dBm` : undefined"
                            aria-hidden="true"
                        />
                        <div class="wifi-panel__connection-copy">
                            <strong>{{ wifiRowTitle }}</strong>
                            <span :class="{'wifi-panel__connection-sub--on': wifiRowConnected}">
                                {{ wifiRowSub }}
                            </span>
                        </div>
                        <Button type="blue-hollow" size="sm" @click="staEditing = true">
                            Details
                        </Button>
                    </div>
                    <div v-if="staEditing" class="wifi-panel__rows">
                        <div v-if="wifiLive?.sta_ip" class="wifi-panel__row">
                            <span class="wifi-panel__row-label">IP address</span>
                            <span class="wifi-panel__value-text">{{ wifiLive.sta_ip }}</span>
                        </div>
                        <div v-if="typeof wifiLive?.rssi === 'number'" class="wifi-panel__row">
                            <span class="wifi-panel__row-label">Signal</span>
                            <span class="wifi-panel__value-text" :class="wifiRssiClass">
                                {{ wifiLive.rssi }} dBm
                            </span>
                        </div>
                        <label class="wifi-panel__row">
                            <span class="wifi-panel__row-label">SSID</span>
                            <input
                                v-model="sta.ssid"
                                aria-label="Primary network SSID"
                                autocomplete="off"
                                class="cfg-panel__input"
                            />
                        </label>
                        <label class="wifi-panel__row">
                            <span class="wifi-panel__row-copy">
                                <span class="wifi-panel__row-label">Password</span>
                                <span>Leave empty to keep current</span>
                            </span>
                            <input
                                v-model="sta.pass"
                                aria-label="Primary network password"
                                type="password"
                                autocomplete="new-password"
                                class="cfg-panel__input"
                                placeholder="••••••••"
                            />
                        </label>
                        <div class="wifi-panel__row">
                            <span class="wifi-panel__row-label">Enable</span>
                            <CardToggle size="row"
                                v-model="sta.enable"
                                aria-label="Enable primary network"
                            />
                        </div>
                        <div class="wifi-panel__row">
                            <span class="wifi-panel__row-label">IPv4 mode</span>
                            <Dropdown
                                aria-label="Primary network IPv4 mode"
                                :default="ipv4Label(sta.ipv4mode)"
                                :options="IPV4_MODE_LABELS"
                                @selected="(label: string) => { sta.ipv4mode = labelToIpv4(label); }"
                            />
                        </div>
                        <label
                            v-for="field in sta.ipv4mode === 'static' ? STA_IP_FIELDS : []"
                            :key="field.key"
                            class="wifi-panel__row"
                        >
                            <span class="wifi-panel__row-copy">
                                <span class="wifi-panel__row-label">{{ field.label }}</span>
                                <span
                                    v-if="staStaticFieldInvalid(field.key)"
                                    class="cfg-panel__field-error"
                                >
                                    Not a valid IPv4 address
                                </span>
                            </span>
                            <input
                                v-model="sta[field.key]"
                                :aria-label="`Primary network ${field.label}`"
                                :aria-invalid="
                                    staStaticFieldInvalid(field.key)
                                        ? 'true'
                                        : undefined
                                "
                                autocomplete="off"
                                class="cfg-panel__input"
                                :class="{
                                    'cfg-panel__input--error':
                                        staStaticFieldInvalid(field.key)
                                }"
                                :placeholder="field.placeholder"
                            />
                        </label>
                    </div>
                    <p v-if="staEditing" class="cfg-panel__notice wifi-panel__notice">
                        <i class="fas fa-triangle-exclamation" aria-hidden="true" />
                        <span v-if="staConfirming">
                            Apply these credentials now? The device may disconnect while it reconnects.
                        </span>
                        <span v-else>
                            Wrong credentials can disconnect the device. Access point fallback remains available.
                        </span>
                    </p>
                    <div v-if="staEditing" class="wifi-panel__actions">
                        <span class="cfg-panel__workspace-footer-copy">
                            {{ staDirty ? 'Unsaved primary network changes' : 'Editing primary network' }}
                        </span>
                        <div class="wifi-panel__actions-buttons">
                            <Button
                                type="blue-hollow"
                                size="sm"
                                @click="cancelStaAction"
                            >
                                {{ staConfirming ? 'Back' : 'Cancel' }}
                            </Button>
                            <Button
                                type="blue"
                                size="sm"
                                :loading="savingSection === 'sta'"
                                :disabled="!staDirty"
                                @click="submitStaAction"
                            >
                                {{ staConfirming ? 'Apply network' : 'Save' }}
                            </Button>
                        </div>
                    </div>
                </section>

                <section
                    v-if="view === 'backup'"
                    class="wifi-panel__settings-section"
                    aria-label="Wi-Fi 2 network"
                >

                    <div class="wifi-panel__rows">
                        <label class="wifi-panel__row">
                            <span class="wifi-panel__row-label">SSID</span>
                            <input
                                v-model="sta1.ssid"
                                aria-label="Backup network SSID"
                                autocomplete="off"
                                class="cfg-panel__input"
                            />
                        </label>
                        <label class="wifi-panel__row">
                            <span class="wifi-panel__row-label">Password</span>
                            <input
                                v-model="sta1.pass"
                                aria-label="Backup network password"
                                type="password"
                                autocomplete="new-password"
                                class="cfg-panel__input"
                                placeholder="••••••••"
                            />
                        </label>
                        <div class="wifi-panel__row">
                            <span class="wifi-panel__row-label">Enable</span>
                            <CardToggle size="row"
                                v-model="sta1.enable"
                                aria-label="Enable backup network"
                            />
                        </div>
                        <div class="wifi-panel__row">
                            <span class="wifi-panel__row-label">IPv4 mode</span>
                            <Dropdown
                                aria-label="Backup network IPv4 mode"
                                :default="ipv4Label(sta1.ipv4mode)"
                                :options="IPV4_MODE_LABELS"
                                @selected="(label: string) => { sta1.ipv4mode = labelToIpv4(label); }"
                            />
                        </div>
                        <label
                            v-for="field in sta1.ipv4mode === 'static' ? STA_IP_FIELDS : []"
                            :key="field.key"
                            class="wifi-panel__row"
                        >
                            <span class="wifi-panel__row-copy">
                                <span class="wifi-panel__row-label">{{ field.label }}</span>
                                <span
                                    v-if="sta1StaticFieldInvalid(field.key)"
                                    class="cfg-panel__field-error"
                                >
                                    Not a valid IPv4 address
                                </span>
                            </span>
                            <input
                                v-model="sta1[field.key]"
                                :aria-label="`Backup network ${field.label}`"
                                :aria-invalid="
                                    sta1StaticFieldInvalid(field.key)
                                        ? 'true'
                                        : undefined
                                "
                                autocomplete="off"
                                class="cfg-panel__input"
                                :class="{
                                    'cfg-panel__input--error':
                                        sta1StaticFieldInvalid(field.key)
                                }"
                                :placeholder="field.placeholder"
                            />
                        </label>
                    </div>
                    <div v-if="sta1Dirty" class="wifi-panel__actions">
                        <span class="cfg-panel__workspace-footer-copy">
                            Unsaved backup network changes
                        </span>
                        <div class="wifi-panel__actions-buttons">
                            <Button type="blue-hollow" size="sm" @click="cancelSta1">
                                Cancel
                            </Button>
                            <Button
                                type="blue"
                                size="sm"
                                :loading="savingSection === 'sta1'"
                                @click="saveSta1"
                            >
                                Save
                            </Button>
                        </div>
                    </div>
                </section>

                <section
                    class="wifi-panel__settings-section"
                    aria-labelledby="wifi-available-title"
                >
                    <div class="wifi-panel__section-heading">
                        <div>
                            <h5 id="wifi-available-title">Other networks</h5>
                        </div>
                        <Button
                            type="blue-hollow"
                            size="sm"
                            :loading="scanning"
                            @click="scan"
                        >
                            Scan
                        </Button>
                    </div>
                    <div
                        v-if="scanning"
                        class="wifi-panel__async-state"
                        role="status"
                        aria-live="polite"
                    >
                        <i class="fas fa-spinner fa-spin" aria-hidden="true" />
                        <p>Looking for networks...</p>
                    </div>
                    <div
                        v-else-if="scanError"
                        class="wifi-panel__async-state wifi-panel__async-state--error"
                        role="alert"
                    >
                        <i class="fas fa-circle-exclamation" aria-hidden="true" />
                        <p>{{ scanError }}</p>
                        <Button type="blue-hollow" size="sm" @click="scan">Retry</Button>
                    </div>
                    <div
                        v-else-if="availableNetworks.length > 0"
                        class="wifi-panel__network-list"
                        role="group"
                        aria-label="Available Wi-Fi networks"
                    >
                        <div
                            v-for="net in availableNetworks"
                            :key="net.bssid ?? net.ssid"
                            class="wifi-panel__network wifi-panel__network--selectable"
                            role="button"
                            tabindex="0"
                            :aria-label="`Use network ${net.ssid || 'hidden'}`"
                            @click="useScanResult(net)"
                            @keydown.enter.prevent="useScanResult(net)"
                            @keydown.space.prevent="useScanResult(net)"
                        >
                            <i :class="scanSignalIconClass(net)" aria-hidden="true" />
                            <div class="wifi-panel__network-copy">
                                <strong>{{ net.ssid || '(hidden)' }}</strong>
                                <span>{{ scanRowSubtitle(net) }}</span>
                            </div>
                            <i
                                v-if="net.auth && net.auth !== 'open'"
                                class="fas fa-lock wifi-panel__network-lock"
                                role="img"
                                aria-label="Secured network"
                            />
                            <i class="fas fa-chevron-right cfg-panel__row-chevron" aria-hidden="true" />
                        </div>
                    </div>
                    <p v-else class="wifi-panel__empty">
                        {{ hasScanned ? 'No other networks found.' : 'Scan to see nearby networks.' }}
                    </p>
                </section>


                <section
                    v-if="view === 'primary' && supportsSavedNetworks"
                    class="wifi-panel__settings-section"
                    aria-labelledby="wifi-saved-title"
                >
                    <div class="wifi-panel__section-heading">
                        <div>
                            <h5 id="wifi-saved-title">Saved networks</h5>
                            <p>Networks remembered by the device.</p>
                        </div>
                        <Button type="blue-hollow" size="sm" @click="loadSaved">Refresh</Button>
                    </div>
                    <div
                        v-if="loadingSaved"
                        class="wifi-panel__async-state"
                        role="status"
                        aria-live="polite"
                    >
                        <i class="fas fa-spinner fa-spin" aria-hidden="true" />
                        <p>Loading saved networks...</p>
                    </div>
                    <div
                        v-else-if="savedNetworksError"
                        class="wifi-panel__async-state wifi-panel__async-state--error"
                        role="alert"
                    >
                        <i class="fas fa-circle-exclamation" aria-hidden="true" />
                        <p>{{ savedNetworksError }}</p>
                        <Button type="blue-hollow" size="sm" @click="loadSaved">Retry</Button>
                    </div>
                    <p v-else-if="savedNetworks.length === 0" class="wifi-panel__empty">
                        No saved networks.
                    </p>
                    <div v-else class="wifi-panel__network-list" role="list" aria-label="Saved Wi-Fi networks">
                        <div v-for="n in savedNetworks" :key="n.id" class="wifi-panel__network" role="listitem">
                            <i class="fas fa-wifi" aria-hidden="true" />
                            <div class="wifi-panel__network-copy">
                                <strong>{{ n.ssid || '(hidden)' }}</strong>
                                <span>Saved network {{ n.id }}</span>
                            </div>
                            <div v-if="pendingSavedDeletion === n" class="wifi-panel__delete-confirm">
                                <Button
                                    type="blue-hollow"
                                    size="sm"
                                    @click="pendingSavedDeletion = null"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="red"
                                    size="sm"
                                    :loading="deletingSaved"
                                    @click="deleteSaved(n)"
                                >
                                    Delete
                                </Button>
                            </div>
                            <Button v-else type="red" size="sm" @click="pendingSavedDeletion = n">
                                Delete
                            </Button>
                        </div>
                    </div>
                </section>

                <Collapse
                    v-if="view === 'primary'"
                    class="cfg-panel__disclosure"
                    title="Advanced settings"
                >
                    <div class="wifi-panel__rows">
                        <div class="wifi-panel__row">
                            <span class="wifi-panel__row-copy">
                                <span class="wifi-panel__row-label">Roaming</span>
                                <span>Move to a stronger access point when the signal drops.</span>
                            </span>
                            <CardToggle size="row"
                                :model-value="roamEnabled"
                                aria-label="Enable roaming"
                                @update:model-value="setRoamEnabled"
                            />
                        </div>
                        <label v-if="roamEnabled" class="wifi-panel__row">
                            <span class="wifi-panel__row-label">Signal threshold</span>
                            <span class="wifi-panel__slider-group">
                                <!-- Realistic Wi-Fi RSSI: -50 strong, -90 unusable. -->
                                <input
                                    v-model.number="roam.rssiThr"
                                    aria-label="Roaming RSSI threshold"
                                    type="range"
                                    min="-90"
                                    max="-50"
                                    step="1"
                                    class="wifi-panel__slider"
                                />
                                <span
                                    class="wifi-panel__slider-value"
                                    :class="wifiThresholdClass"
                                >
                                    {{ roam.rssiThr }} dBm
                                </span>
                            </span>
                        </label>
                        <label v-if="roamEnabled" class="wifi-panel__row">
                            <span class="wifi-panel__row-copy">
                                <span class="wifi-panel__row-label">Scan interval</span>
                                <span>5 to 3600 seconds</span>
                            </span>
                            <input
                                v-model.number="roam.interval"
                                aria-label="Roaming scan interval"
                                type="number"
                                min="5"
                                max="3600"
                                autocomplete="off"
                                class="cfg-panel__input wifi-panel__num-input"
                            />
                        </label>
                    </div>
                    <div v-if="roamDirty" class="wifi-panel__actions">
                        <span class="cfg-panel__workspace-footer-copy">
                            Unsaved roaming changes
                        </span>
                        <div class="wifi-panel__actions-buttons">
                            <Button type="blue-hollow" size="sm" @click="cancelRoam">
                                Cancel
                            </Button>
                            <Button
                                type="blue"
                                size="sm"
                                :loading="savingSection === 'roam'"
                                @click="saveRoam"
                            >
                                Save
                            </Button>
                        </div>
                    </div>
                </Collapse>
            </section>

            <section
                v-else-if="view === 'ap'"
                class="wifi-panel__workspace wifi-panel__settings-section"
            >
                <div class="wifi-panel__rows">
                    <label class="wifi-panel__row">
                        <span class="wifi-panel__row-label">SSID</span>
                        <input
                            v-model="ap.ssid"
                            aria-label="Access point SSID"
                            autocomplete="off"
                            class="cfg-panel__input"
                        />
                    </label>
                    <label class="wifi-panel__row">
                        <span class="wifi-panel__row-label">Password</span>
                        <input
                            v-model="ap.pass"
                            aria-label="Access point password"
                            type="password"
                            autocomplete="new-password"
                            class="cfg-panel__input"
                            placeholder="••••••••"
                        />
                    </label>
                    <div class="wifi-panel__row">
                        <div class="wifi-panel__row-copy">
                            <span class="wifi-panel__row-label">Open network</span>
                            <span>Allow clients to connect without a password.</span>
                        </div>
                        <CardToggle size="row"
                            v-model="ap.is_open"
                            aria-label="Use an open access point without a password"
                        />
                    </div>

                    <div class="wifi-panel__row">
                        <div class="wifi-panel__row-copy">
                            <span class="wifi-panel__row-label">Access point</span>
                            <span>Use the physical button to disable fallback.</span>
                        </div>
                        <CardToggle size="row"
                            v-model="ap.enable"
                            aria-label="Enable access point"
                            :title="AP_DISABLE_TOOLTIP"
                            @update:model-value="onApEnableToggle"
                        />
                    </div>
                </div>
                <div v-if="apDirty" class="wifi-panel__actions">
                    <span class="cfg-panel__workspace-footer-copy">
                        Unsaved access point changes
                    </span>
                    <div class="wifi-panel__actions-buttons">
                        <Button type="blue-hollow" size="sm" @click="cancelAp">
                            Cancel
                        </Button>
                        <Button
                            type="blue"
                            size="sm"
                            :loading="savingSection === 'ap'"
                            @click="saveAp"
                        >
                            Save
                        </Button>
                    </div>
                </div>
            </section>

            <section
                v-else
                class="wifi-panel__workspace wifi-panel__settings-section"
            >
                <div class="wifi-panel__rows">
                    <div class="wifi-panel__row">
                        <div class="wifi-panel__row-copy">
                            <span class="wifi-panel__row-label">Range extender</span>
                        </div>
                        <CardToggle size="row"
                            v-model="ap.rangeExtender"
                            aria-label="Enable range extender"
                        />
                    </div>
                </div>
                <div v-if="rangeDirty" class="wifi-panel__actions">
                    <span class="cfg-panel__workspace-footer-copy">
                        Unsaved range extender changes
                    </span>
                    <div class="wifi-panel__actions-buttons">
                        <Button type="blue-hollow" size="sm" @click="cancelRange">
                            Cancel
                        </Button>
                        <Button
                            type="blue"
                            size="sm"
                            :loading="savingSection === 'ap'"
                            @click="saveRange"
                        >
                            Save
                        </Button>
                    </div>
                </div>
            </section>
        </form>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, reactive, ref, watch} from 'vue';
import Collapse from '@/components/core/Collapse.vue';
import {ipv4Valid} from '@/helpers/ipv4';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {useDevicesStore} from '@/stores/devices';
import {useToastStore} from '@/stores/toast';
import {sendRPC} from '@/tools/websocket';
import CardToggle from '../cards/CardToggle.vue';
import Button from './Button.vue';
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
/** Which settings page this instance renders — one nav item per view. */
export type WifiPanelView = 'primary' | 'backup' | 'ap' | 'range';

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
const ROAM_RSSI_MIN = -100;
const ROAM_RSSI_MAX = 0;
const ROAM_INTERVAL_MIN = 5;
const ROAM_INTERVAL_MAX = 3600;

const props = defineProps<{shellyID: string; view: WifiPanelView}>();
const emit = defineEmits<{'dirty-change': [dirty: boolean]}>();
const deviceStore = useDevicesStore();
const toast = useToastStore();

const config = ref<WifiConfigShape | null>(null);
const savingSection = ref<Section | null>(null);

const sta = reactive<
    StaConfig & {pass: string; ipv4mode: string; enable: boolean}
>({
    ssid: '',
    pass: '',
    enable: true,
    ipv4mode: 'dhcp',
    ip: '',
    netmask: '',
    gw: '',
    nameserver: ''
});
const staEditing = ref(false);
const staConfirming = ref(false);
// Dirty per section is a live diff — undoing an edit clears it by itself.
const serializeSta = () => JSON.stringify(sta);
const staBaseline = ref(serializeSta());
const staDirty = computed(() => serializeSta() !== staBaseline.value);

const sta1 = reactive<StaConfig & {pass: string; ipv4mode: string; enable: boolean}>({
    ssid: '',
    pass: '',
    enable: false,
    ipv4mode: 'dhcp',
    ip: '',
    netmask: '',
    gw: '',
    nameserver: ''
});
const serializeSta1 = () => JSON.stringify(sta1);
const sta1Baseline = ref(serializeSta1());
const sta1Dirty = computed(() => serializeSta1() !== sta1Baseline.value);

const ap = reactive({
    ssid: '',
    pass: '',
    is_open: false,
    enable: true,
    rangeExtender: false
});
const serializeAp = () =>
    JSON.stringify([ap.ssid, ap.pass, ap.is_open, ap.enable]);
const apBaseline = ref(serializeAp());
const apDirty = computed(() => serializeAp() !== apBaseline.value);
// The range extender has its own page; its dirty state is separate so the
// two nav items flag independently.
const rangeBaseline = ref('false');
const rangeDirty = computed(
    () => String(ap.rangeExtender) !== rangeBaseline.value
);

const roam = reactive({rssiThr: -80, interval: 60});
const serializeRoam = () => JSON.stringify(roam);
const roamBaseline = ref(serializeRoam());
const roamDirty = computed(() => serializeRoam() !== roamBaseline.value);
// interval 0 disables roaming (per the Wifi API) — the toggle drives that.
const roamEnabled = computed(() => roam.interval > 0);
let lastRoamInterval = 60;
function setRoamEnabled(enabled: boolean): void {
    if (enabled) {
        roam.interval = lastRoamInterval > 0 ? lastRoamInterval : 60;
    } else {
        if (roam.interval > 0) lastRoamInterval = roam.interval;
        roam.interval = 0;
    }
}
const wifiThresholdClass = computed(() => {
    if (roam.rssiThr >= -60) return 'wifi-panel__rssi--good';
    if (roam.rssiThr >= -75) return 'wifi-panel__rssi--ok';
    return 'wifi-panel__rssi--warn';
});

const scanResults = ref<ScanNetwork[]>([]);
const scanning = ref(false);
const hasScanned = ref(false);
const scanError = ref<string | null>(null);
const savedNetworks = ref<SavedNetwork[]>([]);
const loadingSaved = ref(false);
const savedNetworksError = ref<string | null>(null);
const deletingSaved = ref(false);
const pendingSavedDeletion = ref<SavedNetwork | null>(null);
const savedNetworksDeviceID = ref<string | null>(null);
let savedNetworksRequestGeneration = 0;
let saveRequestGeneration = 0;
let scanRequestGeneration = 0;
let deleteSavedRequestGeneration = 0;

const deviceEntry = computed(() => deviceStore.devices[props.shellyID]);
const wifiLive = computed(() => (deviceEntry.value?.status as any)?.wifi);
// Dirty per view — each nav item reports only its own page's edits.
const isDirty = computed(() => {
    switch (props.view) {
        case 'primary':
            return (
                staDirty.value ||
                staConfirming.value ||
                roamDirty.value ||
                pendingSavedDeletion.value !== null
            );
        case 'backup':
            return sta1Dirty.value;
        case 'ap':
            return apDirty.value;
        case 'range':
            return rangeDirty.value;
    }
    return false;
});

// True if methods list is empty (unknown) or explicitly includes this method.
// Prevents calling SavedNetworks.List on devices that don't support it.
const supportsSavedNetworks = computed(() => {
    const methods = deviceEntry.value?.methods;
    return !methods?.length || methods.includes('Wifi.SavedNetworks.List');
});

const wifiRowConnected = computed(
    () => wifiLive.value?.status === 'got ip' || Boolean(wifiLive.value?.sta_ip)
);
const wifiRowTitle = computed(() => {
    const live = wifiLive.value;
    if (live?.ssid) return live.ssid;
    return config.value?.sta?.ssid ?? 'No network configured';
});
const wifiRowSub = computed(() => {
    const live = wifiLive.value;
    if (wifiRowConnected.value) return 'Connected';
    if (live?.ssid) return 'Connecting';
    if (config.value?.sta?.ssid) {
        return sta.enable ? 'Not connected' : 'Disabled';
    }
    return 'Choose a network below';
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

watch(
    isDirty,
    (dirty) => {
        emit('dirty-change', dirty);
    },
    {immediate: true}
);

function ipv4Label(mode: string | undefined): string {
    return mode === 'static' ? 'Static' : 'DHCP';
}

function labelToIpv4(label: string): string {
    return label === 'Static' ? 'static' : 'dhcp';
}

function scanSignalIconClass(net: ScanNetwork): string[] {
    const rssi = typeof net.rssi === 'number' ? net.rssi : null;
    const strength =
        rssi === null || rssi >= -60
            ? 'wifi-panel__network-signal--strong'
            : rssi >= -75
              ? 'wifi-panel__network-signal--ok'
              : 'wifi-panel__network-signal--weak';
    return ['fas', 'fa-wifi', 'wifi-panel__network-signal', strength];
}

function applySta(c: WifiConfigShape): void {
    sta.ssid = c.sta?.ssid ?? '';
    sta.pass = '';
    sta.enable = c.sta?.enable ?? true;
    sta.ipv4mode = c.sta?.ipv4mode ?? 'dhcp';
    sta.ip = c.sta?.ip ?? '';
    sta.netmask = c.sta?.netmask ?? '';
    sta.gw = c.sta?.gw ?? '';
    sta.nameserver = c.sta?.nameserver ?? '';
    staEditing.value = false;
    staConfirming.value = false;
    staBaseline.value = serializeSta();
}

function applySta1(c: WifiConfigShape): void {
    sta1.ssid = c.sta1?.ssid ?? '';
    sta1.pass = '';
    sta1.enable = c.sta1?.enable ?? false;
    sta1.ipv4mode = c.sta1?.ipv4mode ?? 'dhcp';
    sta1.ip = c.sta1?.ip ?? '';
    sta1.netmask = c.sta1?.netmask ?? '';
    sta1.gw = c.sta1?.gw ?? '';
    sta1.nameserver = c.sta1?.nameserver ?? '';
    sta1Baseline.value = serializeSta1();
}

function applyAp(c: WifiConfigShape): void {
    ap.ssid = c.ap?.ssid ?? '';
    ap.pass = '';
    ap.is_open = c.ap?.is_open ?? false;
    ap.enable = c.ap?.enable ?? true;
    ap.rangeExtender = c.ap?.range_extender?.enable ?? false;
    apBaseline.value = serializeAp();
    rangeBaseline.value = String(ap.rangeExtender);
}

function applyRoam(c: WifiConfigShape): void {
    roam.rssiThr = c.roam?.rssi_thr ?? -80;
    roam.interval = c.roam?.interval ?? 60;
    roamBaseline.value = serializeRoam();
}

function applyConfig(c: WifiConfigShape): void {
    config.value = c;
    applySta(c);
    applySta1(c);
    applyAp(c);
    applyRoam(c);
}

function loadConfig(): void {
    const c = deviceStore.devices[props.shellyID]?.settings
        ?.wifi as WifiConfigShape | undefined;
    if (!c) {
        config.value = null;
        return;
    }
    applyConfig(c);
}

const refetching = ref(false);

// Fetch path: the store had nothing usable, so ask the device directly.
// Silent mode is the automatic attempt on open — failures leave the Retry
// block, without toast spam.
async function fetchConfigFromDevice(silent: boolean): Promise<void> {
    const shellyID = props.shellyID;
    refetching.value = true;
    try {
        const res = await sendRPC<WifiConfigShape>(
            'FLEET_MANAGER',
            'Wifi.GetConfig',
            {shellyID}
        );
        if (shellyID !== props.shellyID) return;
        if (res === undefined || res === null) {
            if (!silent) {
                toast.error('The device returned no configuration');
            }
            return;
        }
        applyConfig(res);
    } catch (err: unknown) {
        if (!silent) {
            toast.error(
                rpcErrorMessage(err, 'Failed to load Wi-Fi configuration')
            );
        }
    } finally {
        refetching.value = false;
    }
}

// Manual Retry — parameterless so the template can bind it to @click.
function refetchConfig(): Promise<void> {
    return fetchConfigFromDevice(false);
}

// Load on open without a Retry click: when the store has no config yet and
// the device is reachable, fetch it right away.
function autoRefetchConfig(): void {
    if (config.value) return;
    if (!deviceEntry.value?.online) return;
    void fetchConfigFromDevice(true);
}

function cancelSta1(): void {
    if (config.value) applySta1(config.value);
}

function cancelAp(): void {
    if (config.value) applyAp(config.value);
}

function cancelRoam(): void {
    if (config.value) applyRoam(config.value);
}

function sta1StaticFieldInvalid(key: (typeof STA_IP_FIELDS)[number]['key']): boolean {
    const value = sta1[key];
    return Boolean(value) && !ipv4Valid(value ?? '');
}

function staStaticFieldInvalid(key: (typeof STA_IP_FIELDS)[number]['key']): boolean {
    const value = sta[key];
    return Boolean(value) && !ipv4Valid(value ?? '');
}

async function saveSection(
    section: Section,
    slice: WifiConfigShape,
    label: string,
    onSuccess?: () => void
): Promise<void> {
    const shellyID = props.shellyID;
    const generation = ++saveRequestGeneration;
    savingSection.value = section;
    try {
        await sendRPC('FLEET_MANAGER', 'Wifi.SetConfig', {
            shellyID,
            config: slice
        });
        if (!isCurrentSaveRequest(generation, shellyID)) return;
        updateSavedConfig(slice);
        toast.success(label);
        onSuccess?.();
    } catch (err: unknown) {
        if (!isCurrentSaveRequest(generation, shellyID)) return;
        toast.error(rpcErrorMessage(err, 'Failed to save Wi-Fi settings'));
    } finally {
        if (isCurrentSaveRequest(generation, shellyID)) {
            savingSection.value = null;
        }
    }
}

function isCurrentSaveRequest(generation: number, shellyID: string): boolean {
    return generation === saveRequestGeneration && shellyID === props.shellyID;
}

function withoutPassword<T extends {pass?: string | null}>(value: T): Omit<T, 'pass'> {
    const copy = {...value};
    delete copy.pass;
    return copy;
}

function updateSavedConfig(slice: WifiConfigShape): void {
    if (!config.value) return;
    const next = {...config.value};
    if (slice.sta) {
        next.sta = {...config.value.sta, ...withoutPassword(slice.sta)};
    }
    if (slice.sta1) {
        next.sta1 = {...config.value.sta1, ...withoutPassword(slice.sta1)};
    }
    if (slice.ap) {
        next.ap = {...config.value.ap, ...withoutPassword(slice.ap)};
    }
    if (slice.roam) {
        next.roam = {...config.value.roam, ...slice.roam};
    }
    config.value = next;
}

function cancelStaEdit(): void {
    if (config.value) {
        applySta(config.value);
        return;
    }
    staEditing.value = false;
    staConfirming.value = false;
}

function cancelStaAction(): void {
    if (staConfirming.value) {
        staConfirming.value = false;
        return;
    }
    cancelStaEdit();
}

function submitStaAction(): void {
    if (!staConfirming.value) {
        staConfirming.value = true;
        return;
    }
    void saveSta();
}

async function saveSta(): Promise<void> {
    if (sta.ipv4mode === 'static') {
        const invalid = STA_IP_FIELDS.find((f) => staStaticFieldInvalid(f.key));
        if (invalid) {
            toast.error(`${invalid.label} is not a valid IPv4 address`);
            return;
        }
    }
    const slice: StaConfig = {
        ssid: sta.ssid || null,
        enable: sta.enable,
        ipv4mode: sta.ipv4mode
    };
    if (sta.pass) slice.pass = sta.pass;
    if (sta.ipv4mode === 'static') {
        slice.ip = sta.ip || null;
        slice.netmask = sta.netmask || null;
        slice.gw = sta.gw || null;
        slice.nameserver = sta.nameserver || null;
    }
    await saveSection('sta', {sta: slice}, 'Primary Wi-Fi saved', () => {
        staEditing.value = false;
        staConfirming.value = false;
        sta.pass = '';
        staBaseline.value = serializeSta();
    });
}

async function saveSta1(): Promise<void> {
    if (sta1.ipv4mode === 'static') {
        const invalid = STA_IP_FIELDS.find((f) =>
            sta1StaticFieldInvalid(f.key)
        );
        if (invalid) {
            toast.error(`${invalid.label} is not a valid IPv4 address`);
            return;
        }
    }
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
        sta1.pass = '';
        sta1Baseline.value = serializeSta1();
    });
}

async function saveAp(): Promise<void> {
    // range_extender is its own page — never sent from here so the two
    // pages cannot clobber each other's edits.
    const slice: ApConfig = {
        ssid: ap.ssid,
        is_open: ap.is_open,
        enable: ap.enable
    };
    if (ap.pass) slice.pass = ap.pass;
    await saveSection('ap', {ap: slice}, 'AP fallback saved', () => {
        ap.pass = '';
        apBaseline.value = serializeAp();
    });
}

function cancelRange(): void {
    if (config.value) applyAp(config.value);
}

async function saveRange(): Promise<void> {
    await saveSection(
        'ap',
        {ap: {range_extender: {enable: ap.rangeExtender}}},
        'Range extender saved',
        () => {
            rangeBaseline.value = String(ap.rangeExtender);
        }
    );
}

async function saveRoam(): Promise<void> {
    const validationError = roamValidationError();
    if (validationError) {
        toast.error(validationError);
        return;
    }
    await saveSection(
        'roam',
        {roam: {rssi_thr: roam.rssiThr, interval: roam.interval}},
        'Roaming settings saved',
        () => {
            roamBaseline.value = serializeRoam();
        }
    );
}

function roamValidationError(): string | null {
    // interval 0 = roaming off — nothing else to validate.
    if (roam.interval === 0) return null;
    if (
        !Number.isInteger(roam.rssiThr) ||
        roam.rssiThr < ROAM_RSSI_MIN ||
        roam.rssiThr > ROAM_RSSI_MAX
    ) {
        return `Roaming RSSI threshold must be a whole number from ${ROAM_RSSI_MIN} to ${ROAM_RSSI_MAX} dBm`;
    }
    if (
        !Number.isInteger(roam.interval) ||
        roam.interval < ROAM_INTERVAL_MIN ||
        roam.interval > ROAM_INTERVAL_MAX
    ) {
        return `Roaming scan interval must be a whole number from ${ROAM_INTERVAL_MIN} to ${ROAM_INTERVAL_MAX} seconds`;
    }
    return null;
}

function onApEnableToggle(value: boolean): void {
    if (!value) {
        ap.enable = true;
        toast.info(AP_DISABLE_TOOLTIP);
    }
}

async function scan(): Promise<void> {
    const shellyID = props.shellyID;
    const generation = ++scanRequestGeneration;
    scanResults.value = [];
    scanError.value = null;
    scanning.value = true;
    try {
        const res = await sendRPC<
            {results?: ScanNetwork[]} | ScanNetwork[]
        >('FLEET_MANAGER', 'Wifi.Scan', {shellyID});
        if (!isCurrentScanRequest(generation, shellyID)) return;
        scanResults.value = Array.isArray(res) ? res : (res?.results ?? []);
        hasScanned.value = true;
        if (scanResults.value.length === 0) {
            toast.info('Scan finished — no networks reported');
        }
    } catch (err: unknown) {
        if (!isCurrentScanRequest(generation, shellyID)) return;
        const message = rpcErrorMessage(err, 'Failed to scan Wi-Fi networks');
        hasScanned.value = true;
        scanError.value = `Could not scan for networks: ${message}`;
    } finally {
        if (isCurrentScanRequest(generation, shellyID)) {
            scanning.value = false;
        }
    }
}

function isCurrentScanRequest(generation: number, shellyID: string): boolean {
    return generation === scanRequestGeneration && shellyID === props.shellyID;
}

function scanRowSubtitle(net: ScanNetwork): string {
    const parts: string[] = [];
    if (typeof net.rssi === 'number') parts.push(`${net.rssi} dBm`);
    if (typeof net.channel === 'number') parts.push(`ch ${net.channel}`);
    if (net.auth) parts.push(net.auth);
    return parts.join(' · ');
}

function stagePrimaryNetwork(ssid: string): void {
    sta.ssid = ssid;
    sta.enable = true;
    staEditing.value = true;
    staConfirming.value = false;
}

function stageBackupNetwork(ssid: string): void {
    sta1.ssid = ssid;
    sta1.enable = true;
}

// The connected network is already shown in the card above — the list
// holds the others, like every OS Wi-Fi page.
const availableNetworks = computed(() =>
    scanResults.value.filter(
        (net) => !net.ssid || net.ssid !== wifiLive.value?.ssid
    )
);

function useScanResult(net: ScanNetwork): void {
    if (!net.ssid) {
        toast.error('Network has no SSID');
        return;
    }
    if (props.view === 'backup') {
        stageBackupNetwork(net.ssid);
    } else {
        stagePrimaryNetwork(net.ssid);
    }
    toast.info(
        `${props.view === 'backup' ? 'Backup' : 'Primary'} network staged with ${net.ssid} — set password and save`
    );
}

async function loadSaved(): Promise<void> {
    const shellyID = props.shellyID;
    const generation = ++savedNetworksRequestGeneration;
    savedNetworks.value = [];
    savedNetworksDeviceID.value = null;
    savedNetworksError.value = null;
    if (!supportsSavedNetworks.value) {
        loadingSaved.value = false;
        return;
    }
    loadingSaved.value = true;
    try {
        const res = await sendRPC<
            {networks?: SavedNetwork[]} | SavedNetwork[]
        >('FLEET_MANAGER', 'Wifi.SavedNetworks.List', {
            shellyID
        });
        if (!isCurrentSavedNetworksRequest(generation, shellyID)) return;
        savedNetworks.value = Array.isArray(res)
            ? res
            : (res?.networks ?? []);
        savedNetworksDeviceID.value = shellyID;
    } catch (err: unknown) {
        if (!isCurrentSavedNetworksRequest(generation, shellyID)) return;
        const message = rpcErrorMessage(err, 'Failed to load saved networks');
        savedNetworksError.value = `Could not load saved networks: ${message}`;
        savedNetworks.value = [];
    } finally {
        if (isCurrentSavedNetworksRequest(generation, shellyID)) {
            loadingSaved.value = false;
        }
    }
}

function isCurrentSavedNetworksRequest(
    generation: number,
    shellyID: string
): boolean {
    return (
        generation === savedNetworksRequestGeneration &&
        shellyID === props.shellyID
    );
}

async function deleteSaved(n: SavedNetwork): Promise<void> {
    const shellyID = savedNetworksDeviceID.value;
    if (
        !shellyID ||
        shellyID !== props.shellyID ||
        !savedNetworks.value.includes(n)
    ) {
        toast.error('Saved networks changed; refresh and try again');
        return;
    }
    const generation = ++deleteSavedRequestGeneration;
    deletingSaved.value = true;
    try {
        await sendRPC('FLEET_MANAGER', 'Wifi.SavedNetworks.Delete', {
            shellyID,
            id: n.id
        });
        if (!isCurrentDeleteSavedRequest(generation, shellyID)) return;
        toast.success('Saved network deleted');
        pendingSavedDeletion.value = null;
        await loadSaved();
    } catch (err: unknown) {
        if (!isCurrentDeleteSavedRequest(generation, shellyID)) return;
        toast.error(rpcErrorMessage(err, 'Failed to delete saved network'));
    } finally {
        if (isCurrentDeleteSavedRequest(generation, shellyID)) {
            deletingSaved.value = false;
        }
    }
}

function isCurrentDeleteSavedRequest(
    generation: number,
    shellyID: string
): boolean {
    return (
        generation === deleteSavedRequestGeneration &&
        shellyID === props.shellyID
    );
}

onMounted(() => {
    loadConfig();
    autoRefetchConfig();
    if (props.view === 'primary') void loadSaved();
});

watch(
    () => props.shellyID,
    () => {
        saveRequestGeneration++;
        scanRequestGeneration++;
        deleteSavedRequestGeneration++;
        savingSection.value = null;
        scanning.value = false;
        deletingSaved.value = false;
        pendingSavedDeletion.value = null;
        loadConfig();
        autoRefetchConfig();
        scanResults.value = [];
        hasScanned.value = false;
        scanError.value = null;
        if (props.view === 'primary') void loadSaved();
    }
);
</script>

<style scoped>
.wifi-panel {
    display: flex;
    flex-direction: column;
    gap: var(--gap-md);
}

.wifi-panel__workspace {
    display: flex;
    flex-direction: column;
    gap: var(--gap-lg);
}

.wifi-panel__section-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-sm);
}

.wifi-panel__section-heading h5,
.wifi-panel__section-heading p {
    margin: 0;
}

.wifi-panel__section-heading h5 {
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}

.wifi-panel__section-heading p {
    margin-top: var(--gap-xs);
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}

.wifi-panel__connection {
    display: grid;
    grid-template-columns: var(--icon-size-md) minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--gap-sm);
    padding: var(--gap-sm) var(--gap-md);
    border: var(--space-px) solid var(--color-border-default);
    border-radius: var(--radius-xl);
    background: var(--color-surface-0);
}

/* Inside a section card — no card-in-card border. */
.wifi-panel__connection--flat {
    padding: var(--gap-xs) 0;
    border: 0;
    background: transparent;
}

.wifi-panel__connection-icon,
.wifi-panel__network-signal {
    width: var(--icon-size-md);
    color: var(--color-text-tertiary);
    font-size: var(--icon-size-sm);
    text-align: center;
}

.wifi-panel__connection-copy,
.wifi-panel__network-copy,
.wifi-panel__row-copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: var(--gap-xs);
}

.wifi-panel__connection-copy strong,
.wifi-panel__network-copy strong,
.wifi-panel__row-label {
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}

.wifi-panel__connection-copy span,
.wifi-panel__network-copy span,
.wifi-panel__row-copy > span:last-child {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}

.wifi-panel__status-rssi {
    flex-shrink: 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    font-variant-numeric: tabular-nums;
}

/* Read-only stand-in shown where the control appears in edit mode. */
.wifi-panel__value-text {
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
}

/* Connection state and signal quality speak the status axis — the same
   green as the nav dots, never the outcome green. */
.wifi-panel__status-icon--on,
.wifi-panel__rssi--good,
.wifi-panel__network-signal--strong {
    color: var(--color-status-on);
}

.wifi-panel__status-icon--warn,
.wifi-panel__rssi--warn,
.wifi-panel__network-signal--weak {
    color: var(--color-status-warn);
}

.wifi-panel__status-icon--off {
    color: var(--color-status-off);
}

.wifi-panel__rssi--ok,
.wifi-panel__network-signal--ok {
    color: var(--color-text-secondary);
}

.wifi-panel__network-list {
    border: var(--space-px) solid var(--color-border-default);
    border-radius: var(--radius-xl);
    background: var(--color-surface-0);
    padding: 0 var(--gap-md);
}




/* Slider with its live value beside it. */
.wifi-panel__connection-sub--on {
    color: var(--color-status-on);
}

.wifi-panel__slider-group {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
}

.wifi-panel__slider-value {
    min-width: 4.5rem;
    font-variant-numeric: tabular-nums;
    text-align: right;
}



.wifi-panel__network:last-child,
.wifi-panel__row:last-child {
    border-bottom: 0;
}

.wifi-panel__network,
.wifi-panel__row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(var(--touch-target-min), var(--floating-w-xs));
    align-items: center;
    gap: var(--gap-sm);
    min-height: var(--touch-target-min);
    padding: var(--gap-sm) 0;
    border-bottom: var(--space-px) solid var(--color-border-subtle);
}

.wifi-panel__network {
    grid-template-columns: var(--icon-size-md) minmax(0, 1fr) auto auto;
}

/* Whole row is the action — click a network to use it. */
.wifi-panel__network--selectable {
    cursor: pointer;
    transition: background-color var(--motion-hover);
}

.wifi-panel__network--selectable:hover {
    background: var(--state-hover-bg);
}

.wifi-panel__network-lock {
    color: var(--color-text-tertiary);
    font-size: var(--icon-size-xs);
}

.wifi-panel__network-choice {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--gap-xs);
}

.wifi-panel__network-choice > span {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    white-space: nowrap;
}

.wifi-panel__settings-section {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
    padding: var(--gap-sm) var(--gap-md);
    border: var(--space-px) solid var(--color-border-default);
    border-radius: var(--radius-xl);
    background: var(--color-surface-0);
}

.wifi-panel__empty {
    margin: 0;
    padding: var(--gap-sm) var(--gap-md);
    border: var(--space-px) solid var(--color-border-default);
    border-radius: var(--radius-xl);
    background: var(--color-surface-0);
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}

.wifi-panel__async-state {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    padding: var(--gap-sm) var(--gap-md);
    border: var(--space-px) solid var(--color-border-default);
    border-radius: var(--radius-xl);
    background: var(--color-surface-0);
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}

.wifi-panel__async-state p {
    flex: 1;
    margin: 0;
}

.wifi-panel__async-state--error {
    color: var(--color-danger-text);
}

.wifi-panel__notice {
    margin: 0;
}

/* Per-section save bar — same anatomy as the shared workspace footer
   (copy left, actions right, strong hairline). Deliberately NOT sticky:
   several Wi-Fi sections can be dirty at once and stacked sticky bars
   would overlap at the same bottom edge. */
.wifi-panel__actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-sm);
    min-height: var(--touch-target-min);
    padding: var(--space-3) 0;
    border-top: var(--space-px) solid var(--color-border-strong);
}

.wifi-panel__actions-buttons {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
}

.wifi-panel__delete-confirm {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
}

.wifi-panel__slider {
    width: 100%;
    accent-color: var(--color-primary);
}

.wifi-panel__num-input {
    width: 100%;
}

/* Single modal-wide mobile breakpoint — keep in sync with the
   device-settings shell in DeviceBoard.vue (767px). */
@media (max-width: 767px) {
    .wifi-panel__actions {
        align-items: stretch;
        flex-direction: column;
    }

    .wifi-panel__actions-buttons {
        justify-content: flex-end;
    }

    .wifi-panel__section-heading {
        align-items: flex-start;
    }

    .wifi-panel__network {
        grid-template-columns: var(--icon-size-md) minmax(0, 1fr) auto;
    }

    .wifi-panel__network-lock {
        display: none;
    }

    .wifi-panel__network-choice {
        grid-column: 2 / -1;
        flex-wrap: wrap;
    }

    .wifi-panel__row {
        grid-template-columns: 1fr;
    }
}
</style>
