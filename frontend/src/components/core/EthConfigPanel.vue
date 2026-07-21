<template>
    <div class="cfg-panel">
        <form
            v-if="config"
            class="cfg-panel__form"
            @submit.prevent
            autocomplete="off"
        >
            <section class="cfg-panel__section">
                <div class="cfg-panel__row">
                    <div class="cfg-panel__row-label">
                        <strong>Enable Ethernet</strong>
                    </div>
                    <div class="cfg-panel__control">
                        <CardToggle size="row"
                            v-model="local.enable"
                            aria-label="Enable Ethernet"
                            @update:model-value="markDirty"
                        />
                    </div>
                </div>

                <div class="cfg-panel__row">
                    <div class="cfg-panel__row-label">
                        <strong>IPv4 mode</strong>
                    </div>
                    <div class="cfg-panel__control">
                        <Dropdown
                            aria-label="IPv4 mode"
                            :default="ipv4Label(local.ipv4mode)"
                            :options="IPV4_MODE_LABELS"
                            @selected="(label: string) => {
                                local.ipv4mode = labelToIpv4(label);
                                markDirty();
                            }"
                        />
                    </div>
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
                                class="cfg-panel__field-error"
                            >
                                Not a valid IPv4 address
                            </span>
                        </div>
                        <input
                            v-model="local[f.key]"
                            class="cfg-panel__input"
                            :class="{
                                'cfg-panel__input--error':
                                    local[f.key] && !ipv4Valid(local[f.key])
                            }"
                            :aria-label="f.label"
                            :aria-invalid="
                                local[f.key] && !ipv4Valid(local[f.key])
                                    ? 'true'
                                    : undefined
                            "
                            :placeholder="f.placeholder"
                            @input="markDirty"
                        />
                    </div>
                </template>

                <p v-if="addressDirty" class="cfg-panel__notice">
                    <i class="fas fa-triangle-exclamation" />
                    Address changes require a device reboot to take effect.
                </p>

            </section>

            <section class="cfg-panel__section cfg-panel__section--disclosure">
                <Collapse class="cfg-panel__disclosure" title="Connected clients">
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
            </section>

            <ConfigPanelFooter
                label="Ethernet"
                :dirty="dirty"
                :saving="saving"
                :restart-required="restartRequired"
                :rebooting="rebooting"
                :external-changed="externalConfigChanged"
                @save="onSave"
                @reboot="rebootDevice"
                @refresh="reload"
            />
        </form>

        <div v-else-if="refetching" class="cfg-panel__loading">
            Loading configuration…
        </div>
        <div v-else class="cfg-panel__error">
            <p>Failed to load Ethernet configuration.</p>
            <Button type="blue-hollow" size="sm" :loading="refetching" @click="refetch">Retry</Button>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import {useDeviceConfigPanel} from '@/composables/useDeviceConfigPanel';
import {ipv4Valid} from '@/helpers/ipv4';
import {useToastStore} from '@/stores/toast';
import {sendRPC} from '@/tools/websocket';
import Button from './Button.vue';
import Collapse from './Collapse.vue';
import ConfigPanelFooter from './ConfigPanelFooter.vue';
import Dropdown from './Dropdown.vue';
import CardToggle from '../cards/CardToggle.vue';

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
const toast = useToastStore();

const {
    config,
    local,
    dirty,
    saving,
    restartRequired,
    rebooting,
    externalConfigChanged,
    markDirty,
    save,
    rebootDevice,
    refetch,
    refetching,
    reload
} = useDeviceConfigPanel<EthConfig, LocalForm>({
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
</style>
