<template>
    <Modal :visible="visible" @close="close">
        <template #title>
            <span class="wrd-title">
                <i class="fas fa-microchip wrd-title__icon" aria-hidden="true" />
                {{ titleText }}
                <Pill v-if="device && info.gen" variant="neutral">Gen {{ info.gen }}</Pill>
                <Pill v-if="info.profile" variant="neutral">{{ info.profile }}</Pill>
            </span>
        </template>

        <template v-if="device" #default>
            <div class="wrd">
                <div class="wrd-pills">
                    <Pill v-if="info.eth.ip" variant="success" icon="fas fa-network-wired">Ethernet</Pill>
                    <Pill v-if="info.wifi.ip" :variant="info.eth.ip ? 'info' : 'success'" icon="fas fa-wifi">Wi-Fi</Pill>
                    <Pill v-if="!info.eth.ip && !info.wifi.ip" variant="warning" icon="fas fa-circle-exclamation">No link</Pill>
                    <Pill v-if="info.cloudConnected" variant="info" icon="fas fa-cloud">Cloud</Pill>
                    <Pill v-if="info.mqttConnected" variant="info" icon="fas fa-comment-dots">MQTT</Pill>
                    <Pill v-if="info.bleEnabled" variant="info" icon="fab fa-bluetooth-b">BLE</Pill>
                    <Pill v-if="info.authEnabled" variant="warning" icon="fas fa-lock">Auth</Pill>
                    <Pill v-if="info.fwUpdate" variant="info" icon="fas fa-arrow-up">FW {{ info.fwUpdate }}</Pill>
                </div>

                <SectionHeading icon="fas fa-id-card">Identity</SectionHeading>
                <dl class="wrd-grid">
                    <div v-if="info.deviceName" class="wrd-row"><dt>Name</dt><dd>{{ info.deviceName }}</dd></div>
                    <div v-if="info.app" class="wrd-row"><dt>App</dt><dd>{{ info.app }}</dd></div>
                    <div v-if="info.model" class="wrd-row"><dt>Model</dt><dd>{{ info.model }}</dd></div>
                    <div v-if="info.gen" class="wrd-row"><dt>Generation</dt><dd>Gen {{ info.gen }}</dd></div>
                    <div v-if="info.profile" class="wrd-row"><dt>Profile</dt><dd>{{ info.profile }}</dd></div>
                    <div class="wrd-row"><dt>Shelly ID</dt><dd>{{ device.shellyID }}</dd></div>
                </dl>

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

                <SectionHeading icon="fas fa-microchip">System</SectionHeading>
                <dl class="wrd-grid">
                    <div class="wrd-row"><dt>Firmware</dt><dd>{{ info.firmware || '—' }}</dd></div>
                    <div v-if="info.fwUpdate" class="wrd-row"><dt>Update available</dt><dd>{{ info.fwUpdate }}</dd></div>
                    <div v-if="info.uptime" class="wrd-row"><dt>Uptime</dt><dd>{{ info.uptime }}</dd></div>
                    <div v-if="info.deviceTime" class="wrd-row"><dt>Device time</dt><dd>{{ info.deviceTime }}</dd></div>
                </dl>

                <template v-if="info.components.length">
                    <SectionHeading icon="fas fa-puzzle-piece">Components</SectionHeading>
                    <div class="wrd-components">
                        <Pill v-for="c in info.components" :key="c" variant="neutral">{{ c }}</Pill>
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
                    :title="!canAccept ? noPermissionTitle : 'Allow device'"
                    @click="emitAndClose('accept')"
                >
                    Allow
                </Button>
            </div>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import Button from '@/components/core/Button.vue';
import Pill from '@/components/core/Pill.vue';
import SectionHeading from '@/components/core/SectionHeading.vue';
import Modal from '@/components/modals/Modal.vue';
import {formatMac, rssiTier} from '@/helpers/device';

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

function formatUptime(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ${mins % 60}m`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
}

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
              device?: {name?: string; profile?: string; model?: string};
              available_updates?: {stable?: {version?: string}};
          }
        | undefined;
    const cloud = status.cloud as {connected?: boolean} | undefined;
    const mqtt = status.mqtt as {connected?: boolean} | undefined;
    const ble = status.ble as {enabled?: boolean} | undefined;

    const update = sys?.available_updates?.stable?.version;
    const uptime = sys?.uptime != null ? formatUptime(sys.uptime) : '';
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
        components
    };
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
   .wrc-row in the waiting-room card and is the system convention
   for read-only data lists. */

.wrd-title {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--type-subheading);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
}
.wrd-title__icon {
    color: var(--color-primary);
}
.wrd {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
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
