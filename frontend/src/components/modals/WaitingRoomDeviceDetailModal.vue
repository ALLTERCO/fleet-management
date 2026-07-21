<template>
    <Modal :visible="visible" large @close="close">
        <template #title>
            <span class="wrd-title">{{ titleText }}</span>
        </template>

        <template v-if="device" #default>
            <div class="wrd">
                <!-- Hero: the device's own product photo + identity -->
                <header class="wrd-hero">
                    <div class="wrd-hero__frame">
                        <img
                            :src="deviceImage"
                            :alt="`${info.model || 'Device'} photo`"
                            class="wrd-hero__photo"
                            @error="onImageError"
                        />
                    </div>
                    <div class="wrd-hero__meta">
                        <p class="wrd-hero__name">{{ titleText }}</p>
                        <p class="wrd-hero__sid">{{ device.shellyID }}</p>
                        <div class="wrd-pills">
                            <Pill v-if="info.gen" variant="neutral" icon="fas fa-microchip">Gen {{ info.gen }}</Pill>
                            <Pill v-if="info.profile" variant="neutral" icon="fas fa-sliders">{{ info.profile }}</Pill>
                            <Pill v-if="info.eth.ip" variant="success" icon="fas fa-network-wired">Ethernet</Pill>
                            <Pill v-if="info.wifi.ip" :variant="info.eth.ip ? 'info' : 'success'" icon="fas fa-wifi">Wi-Fi</Pill>
                            <Pill v-if="!info.eth.ip && !info.wifi.ip" variant="warning" icon="fas fa-circle-exclamation">No link</Pill>
                            <Pill v-if="info.cloudConnected" variant="info" icon="fas fa-cloud">Cloud</Pill>
                            <Pill v-if="info.mqttConnected" variant="info" icon="fas fa-comment-dots">MQTT</Pill>
                            <Pill v-if="info.bleEnabled" variant="info" icon="fab fa-bluetooth-b">BLE</Pill>
                            <Pill v-if="info.authEnabled" variant="warning" icon="fas fa-lock">Auth</Pill>
                            <Pill v-if="info.fwUpdate" variant="info" icon="fas fa-arrow-up">FW {{ info.fwUpdate }}</Pill>
                        </div>
                    </div>
                </header>

                <div class="wrd-cols">
                    <section class="wrd-col">
                        <SectionHeading icon="fas fa-network-wired">Network</SectionHeading>
                        <dl class="wrd-grid">
                            <div v-if="info.eth.ip" class="wrd-row"><dt>Ethernet IP</dt><dd>{{ info.eth.ip }}</dd></div>
                            <div v-if="info.wifi.ip" class="wrd-row"><dt>Wi-Fi IP</dt><dd>{{ info.wifi.ip }}</dd></div>
                            <div v-if="info.wifi.ssid" class="wrd-row"><dt>SSID</dt><dd>{{ info.wifi.ssid }}</dd></div>
                            <div v-if="info.wifi.rssi != null" class="wrd-row">
                                <dt>Signal</dt>
                                <dd :class="['wrd-row__rssi', `wrd-row__rssi--${rssiTier(info.wifi.rssi)}`]">
                                    {{ info.wifi.rssi }} dBm
                                </dd>
                            </div>
                            <div class="wrd-row"><dt>MAC</dt><dd>{{ info.mac || '—' }}</dd></div>
                        </dl>
                    </section>

                    <section class="wrd-col">
                        <SectionHeading icon="fas fa-microchip">System</SectionHeading>
                        <dl class="wrd-grid">
                            <div v-if="info.app" class="wrd-row"><dt>App</dt><dd>{{ info.app }}</dd></div>
                            <div v-if="info.model" class="wrd-row"><dt>Model</dt><dd>{{ info.model }}</dd></div>
                            <div class="wrd-row"><dt>Firmware</dt><dd>{{ info.firmware || '—' }}</dd></div>
                            <div v-if="info.fwId" class="wrd-row"><dt>Build</dt><dd :title="info.fwId">{{ info.fwId }}</dd></div>
                            <div v-if="info.fwUpdate" class="wrd-row"><dt>Update</dt><dd>{{ info.fwUpdate }}</dd></div>
                            <div v-if="info.uptime" class="wrd-row"><dt>Uptime</dt><dd>{{ info.uptime }}</dd></div>
                            <div v-if="info.deviceTime" class="wrd-row"><dt>Device time</dt><dd>{{ info.deviceTime }}</dd></div>
                        </dl>
                    </section>
                </div>

                <template v-if="componentReadings.length">
                    <SectionHeading icon="fas fa-puzzle-piece">Components</SectionHeading>
                    <div class="wrd-components">
                        <Pill v-for="c in componentReadings" :key="c.key" variant="neutral">{{ c.label }}</Pill>
                    </div>
                </template>
            </div>
        </template>

        <template #footer>
            <div class="wrd-footer">
                <Button type="blue-hollow" @click="close">Close</Button>
                <Button
                    v-if="showReject"
                    type="red"
                    :disabled="!canReject"
                    :title="!canReject ? noPermissionTitle : 'Reject device'"
                    @click="emitAndClose('reject')"
                >
                    Reject
                </Button>
                <Button
                    type="green"
                    :disabled="!canAccept"
                    :title="!canAccept ? noPermissionTitle : 'Accept device'"
                    @click="emitAndClose('accept')"
                >
                    Accept
                </Button>
            </div>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import Pill from '@/components/core/Pill.vue';
import SectionHeading from '@/components/core/SectionHeading.vue';
import Modal from '@/components/modals/Modal.vue';
import {formatDuration} from '@/helpers/format';
import {
    formatMac,
    GENERIC_LOGO,
    getLogoFallback,
    getLogoFromModel,
    rssiTier
} from '@/helpers/device';

const noPermissionTitle = 'You do not have permission to perform this action';

interface PendingDevice {
    shellyID: string;
    status?: Record<string, any>;
}

const visible = defineModel<boolean>({required: true});

const props = defineProps<{
    device: PendingDevice | null;
    canAccept: boolean;
    canReject: boolean;
    showReject: boolean;
}>();

const emit = defineEmits<{accept: []; reject: []}>();

// Capitalises 'switch' → 'Switch'. Profile string comes lowercase from device.
function capitaliseProfile(p: string | undefined): string {
    if (!p) return '';
    return p.charAt(0).toUpperCase() + p.slice(1);
}

const info = computed(() => {
    const status = (props.device?.status ?? {}) as Record<string, any>;
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
              uptime?: number;
              unixtime?: number;
              fw_id?: string;
              device?: {name?: string; profile?: string; model?: string};
              available_updates?: {stable?: {version?: string}};
          }
        | undefined;
    const cloud = status.cloud as {connected?: boolean} | undefined;
    const mqtt = status.mqtt as {connected?: boolean} | undefined;
    const ble = status.ble as {enabled?: boolean} | undefined;

    const update = sys?.available_updates?.stable?.version;
    const uptime = sys?.uptime != null ? formatDuration(sys.uptime) : '';
    const deviceTime = sys?.unixtime
        ? new Date(sys.unixtime * 1000).toLocaleString()
        : '';

    // Component inventory: any key in status matching "<type>:<n>" is a
    // component instance. e.g. "switch:0", "input:1", "temperature:0".
    const components = Object.keys(status)
        .filter((k) => /^[a-z_]+:\d+$/.test(k))
        .sort();

    return {
        model: sys?.device?.model ?? '',
        app: sys?.app ?? '',
        gen: sys?.gen,
        profile: capitaliseProfile(sys?.device?.profile?.trim()),
        deviceName: sys?.device?.name?.trim() ?? '',
        eth: {ip: eth?.ip ?? ''},
        wifi: {
            ip: wifi?.sta_ip ?? '',
            ssid: wifi?.ssid ?? '',
            rssi: typeof wifi?.rssi === 'number' ? wifi.rssi : null
        },
        mac: formatMac(sys?.mac ?? ''),
        firmware: sys?.ver ?? '',
        fwUpdate: update,
        uptime,
        deviceTime,
        cloudConnected: cloud?.connected === true,
        mqttConnected: mqtt?.connected === true,
        bleEnabled: ble?.enabled === true,
        authEnabled: status.auth_en === true,
        fwId: sys?.fw_id ?? '',
        components
    };
});

// A pending device's status is sanitized to bare component keys (no live
// values), so we list what components it has with a friendly label
// ("switch:0" → "Switch 0"), not their readings.
const componentReadings = computed(() =>
    info.value.components.map((key) => {
        const [type, id] = key.split(':');
        return {
            key,
            label: `${type.charAt(0).toUpperCase()}${type.slice(1)} ${id}`
        };
    })
);

// Device photo — same CDN→local→generic resolution the waiting-room card uses.
const imageStage = ref<'cdn' | 'local' | 'generic'>('cdn');

function onImageError() {
    if (imageStage.value === 'cdn' && imageRef.value.hasLocalFallback) {
        imageStage.value = 'local';
    } else imageStage.value = 'generic';
}

// The modal is a single persistent instance whose device prop is swapped, so
// the load/fallback state must reset per device — otherwise a prior device's
// fallback carries over. shellyID is the device identity here (no numeric id).
watch(
    () => props.device?.shellyID,
    () => {
        imageStage.value = 'cdn';
    }
);

const imageRef = computed(() => {
    const sys = props.device?.status?.sys as
        | {app?: string; device?: {model?: string; xt1SvcType?: string}}
        | undefined;
    const xt1SvcType = sys?.device?.xt1SvcType?.trim();
    if (xt1SvcType) return {key: xt1SvcType, hasLocalFallback: false};
    if (sys?.app === 'XT1') return {key: '', hasLocalFallback: false};
    // The backend enriches waiting-room records with sys.device.model.
    return {
        key: sys?.device?.model?.trim() ?? '',
        hasLocalFallback: true
    };
});

const deviceImage = computed(() => {
    const key = imageRef.value.key;
    if (imageStage.value === 'generic' || !key) return GENERIC_LOGO;
    if (imageStage.value === 'local') return getLogoFallback(key);
    return getLogoFromModel(key);
});

// Title shows the most human-friendly identifier we have. All three values
// come straight from sys.* — no derivation.
const titleText = computed(() => {
    if (!props.device) return 'Device details';
    return info.value.deviceName || info.value.app || info.value.model || 'Device details';
});

function close() {
    visible.value = false;
}

function emitAndClose(action: 'accept' | 'reject') {
    if (action === 'accept') emit('accept');
    else emit('reject');
    close();
}
</script>

<style scoped>
/* All values are design-system tokens. dt/dd row pattern matches
   .dtc-row in the triage card and is the system convention
   for read-only data lists. */

.wrd-title {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--type-subheading);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
}
.wrd {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.wrd-hero {
    display: flex;
    gap: var(--space-4);
    align-items: center;
    padding-bottom: var(--space-4);
    border-bottom: 1px solid var(--color-border-subtle);
}
.wrd-hero__frame {
    flex: 0 0 auto;
    width: 148px;
    height: 148px;
    display: grid;
    place-items: center;
}
.wrd-hero__photo {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
}
.wrd-hero__meta {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
}
.wrd-hero__name {
    margin: 0;
    font-size: var(--type-subheading);
    line-height: 1.15;
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
}
.wrd-hero__sid {
    margin: var(--space-1) 0 var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.wrd-cols {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3) var(--space-6);
}
.wrd-col {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
}
@media (max-width: 560px) {
    .wrd-hero {
        flex-direction: column;
        align-items: flex-start;
    }
    .wrd-cols {
        grid-template-columns: 1fr;
    }
}

.wrd-pills {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
}

.wrd-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-1);
    margin: 0;
}

.wrd-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    font-size: var(--type-caption);
    line-height: 1.4;
    min-width: 0;
}
.wrd-row dt {
    flex: 0 0 auto;
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: var(--font-semibold);
}
.wrd-row dd {
    margin: 0;
    flex: 1;
    min-width: 0;
    color: var(--color-text-primary);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    text-align: right;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.wrd-row__rssi--good { color: var(--color-status-on); }
.wrd-row__rssi--ok   { color: var(--color-text-primary); }
.wrd-row__rssi--warn { color: var(--color-status-warn); }

.wrd-components {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
}

.wrd-footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
}
</style>
