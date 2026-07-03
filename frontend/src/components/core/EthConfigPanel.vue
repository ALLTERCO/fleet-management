<template>
    <div class="cfg-panel">
        <div class="cfg-panel__status-row">
            <span
                class="cfg-panel__status"
                :class="linkUp
                    ? 'cfg-panel__status--on'
                    : 'cfg-panel__status--off'"
            >
                {{ linkLabel }}
            </span>
        </div>

        <form v-if="config" @submit.prevent autocomplete="off">
            <div class="cfg-panel__row">
                <div class="cfg-panel__row-label">
                    <strong>Enable Ethernet</strong>
                </div>
                <Checkbox v-model="local.enable" @update:model-value="markDirty" />
            </div>

            <div class="cfg-panel__row">
                <div class="cfg-panel__row-label">
                    <strong>IPv4 mode</strong>
                </div>
                <Dropdown
                    :default="ipv4Label(local.ipv4mode)"
                    :options="IPV4_MODE_LABELS"
                    @selected="(label: string) => {
                        local.ipv4mode = labelToIpv4(label);
                        markDirty();
                    }"
                />
            </div>

            <template v-if="local.ipv4mode === 'static'">
                <div
                    v-for="f in IP_FIELDS"
                    :key="f.key"
                    class="cfg-panel__row"
                >
                    <div class="cfg-panel__row-label">
                        <strong>{{ f.label }}</strong>
                        <span
                            v-if="local[f.key] && !ipv4Valid(local[f.key])"
                            class="eth-panel__invalid"
                        >
                            Not a valid IPv4 address
                        </span>
                    </div>
                    <input
                        v-model="local[f.key]"
                        class="cfg-panel__input"
                        :placeholder="f.placeholder"
                        @input="markDirty"
                    />
                </div>
            </template>

            <p v-if="addressDirty" class="cfg-panel__notice">
                <i class="fas fa-triangle-exclamation" />
                Address changes require a device reboot to take effect.
            </p>

            <div v-if="dirty" class="cfg-panel__footer">
                <Button
                    type="blue"
                    size="sm"
                    :loading="saving"
                    @click="onSave"
                >
                    Save
                </Button>
            </div>

            <Collapse title="Connected clients">
                <div class="eth-panel__clients">
                    <div class="cfg-panel__row">
                        <span class="eth-panel__muted">
                            DHCP leases reported by the device
                        </span>
                        <Button
                            type="blue-hollow"
                            size="sm"
                            :loading="loadingClients"
                            @click="loadClients"
                        >
                            Refresh
                        </Button>
                    </div>

                    <div
                        v-if="clients.length === 0 && !loadingClients"
                        class="cfg-panel__row"
                    >
                        <span class="eth-panel__muted">No clients reported.</span>
                    </div>

                    <div
                        v-for="(c, i) in clients"
                        :key="(c.mac as string) ?? i"
                        class="cfg-panel__row"
                    >
                        <div class="cfg-panel__row-label">
                            <strong>{{ c.hostname || c.ip || 'Unknown' }}</strong>
                            <span>{{ clientSubtitle(c) }}</span>
                        </div>
                    </div>
                </div>
            </Collapse>
        </form>

        <div v-else class="cfg-panel__error">
            <p>Failed to load Ethernet configuration.</p>
            <Button type="blue-hollow" size="sm" @click="reload">Retry</Button>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import {useDeviceConfigPanel} from '@/composables/useDeviceConfigPanel';
import {useDevicesStore} from '@/stores/devices';
import {useToastStore} from '@/stores/toast';
import {sendRPC} from '@/tools/websocket';
import Button from './Button.vue';
import Checkbox from './Checkbox.vue';
import Collapse from './Collapse.vue';
import Dropdown from './Dropdown.vue';

interface EthConfig {
    enable?: boolean;
    ipv4mode?: string;
    ip?: string | null;
    netmask?: string | null;
    gw?: string | null;
    nameserver?: string | null;
}

interface EthClient {
    ip?: string;
    mac?: string;
    hostname?: string;
    [k: string]: unknown;
}

interface LocalForm {
    enable: boolean;
    ipv4mode: string;
    ip: string;
    netmask: string;
    gw: string;
    nameserver: string;
}

const IPV4_MODE_LABELS = ['DHCP', 'Static'];
const IP_FIELDS = [
    {key: 'ip' as const, label: 'IP address', placeholder: '192.168.1.50'},
    {key: 'netmask' as const, label: 'Netmask', placeholder: '255.255.255.0'},
    {key: 'gw' as const, label: 'Gateway', placeholder: '192.168.1.1'},
    {
        key: 'nameserver' as const,
        label: 'DNS server',
        placeholder: '1.1.1.1'
    }
] as const;

const props = defineProps<{shellyID: string}>();
const deviceStore = useDevicesStore();
const toast = useToastStore();

const {config, local, dirty, saving, markDirty, save, reload} =
    useDeviceConfigPanel<EthConfig, LocalForm>({
        shellyID: () => props.shellyID,
        settingsKey: 'eth',
        method: 'Eth.SetConfig',
        initialLocal: {
            enable: true,
            ipv4mode: 'dhcp',
            ip: '',
            netmask: '',
            gw: '',
            nameserver: ''
        },
        mapToLocal: (c) => ({
            enable: c.enable ?? true,
            ipv4mode: c.ipv4mode ?? 'dhcp',
            ip: c.ip ?? '',
            netmask: c.netmask ?? '',
            gw: c.gw ?? '',
            nameserver: c.nameserver ?? ''
        }),
        mapToUpdate: (l) => {
            const u: EthConfig = {enable: l.enable, ipv4mode: l.ipv4mode};
            if (l.ipv4mode === 'static') {
                u.ip = l.ip || null;
                u.netmask = l.netmask || null;
                u.gw = l.gw || null;
                u.nameserver = l.nameserver || null;
            } else {
                u.ip = null;
                u.netmask = null;
                u.gw = null;
                u.nameserver = null;
            }
            return u;
        },
        successToast: 'Ethernet configuration saved'
    });

const clients = ref<EthClient[]>([]);
const loadingClients = ref(false);

const linkUp = computed(() => {
    const ip = deviceStore.devices[props.shellyID]?.status?.eth?.ip;
    return typeof ip === 'string' && ip.length > 0;
});

const linkLabel = computed(() => {
    const ip = deviceStore.devices[props.shellyID]?.status?.eth?.ip;
    return ip ? `Link up · ${ip}` : 'No link';
});

const addressDirty = computed(() => {
    if (!config.value) return false;
    if ((config.value.ipv4mode ?? 'dhcp') !== local.ipv4mode) return true;
    if (local.ipv4mode !== 'static') return false;
    return (
        (config.value.ip ?? '') !== local.ip ||
        (config.value.netmask ?? '') !== local.netmask ||
        (config.value.gw ?? '') !== local.gw ||
        (config.value.nameserver ?? '') !== local.nameserver
    );
});

function ipv4Label(mode: string): string {
    return mode === 'static' ? 'Static' : 'DHCP';
}

function labelToIpv4(label: string): string {
    return label === 'Static' ? 'static' : 'dhcp';
}

function ipv4Valid(s: string): boolean {
    return /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/.test(
        s
    );
}

async function onSave(): Promise<void> {
    if (local.ipv4mode === 'static') {
        const invalid = IP_FIELDS.find(
            (f) => local[f.key] && !ipv4Valid(local[f.key])
        );
        if (invalid) {
            toast.error(`${invalid.label} is not a valid IPv4 address`);
            return;
        }
    }
    await save();
}

async function loadClients(): Promise<void> {
    loadingClients.value = true;
    try {
        const res = await sendRPC<
            {clients?: EthClient[]} | EthClient[]
        >('FLEET_MANAGER', 'Eth.ListClients', {shellyID: props.shellyID});
        clients.value = Array.isArray(res) ? res : (res?.clients ?? []);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`Failed to list Ethernet clients: ${msg}`);
        clients.value = [];
    } finally {
        loadingClients.value = false;
    }
}

function clientSubtitle(c: EthClient): string {
    const parts: string[] = [];
    if (c.ip) parts.push(c.ip as string);
    if (c.mac) parts.push(c.mac as string);
    return parts.join(' · ');
}

watch(
    () => props.shellyID,
    () => {
        clients.value = [];
    }
);
</script>

<style scoped>
.eth-panel__clients {
    display: flex;
    flex-direction: column;
}

.eth-panel__muted {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    flex: 1;
}

.eth-panel__invalid {
    color: var(--color-danger-text);
}
</style>
