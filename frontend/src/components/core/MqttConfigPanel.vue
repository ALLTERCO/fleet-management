<template>
    <div class="mqtt-panel">
        <div class="mqtt-panel__status-row">
            <span class="mqtt-panel__status" :class="mqttConnected ? 'mqtt-panel__status--on' : 'mqtt-panel__status--off'">
                {{ mqttConnected ? 'Connected' : 'Disconnected' }}
            </span>
        </div>

        <form v-if="config" @submit.prevent autocomplete="off">
            <!-- Enable -->
            <div class="mqtt-panel__row">
                <div class="mqtt-panel__row-label">
                    <strong>Enable</strong>
                </div>
                <Checkbox v-model="local.enable" @update:model-value="markDirty" />
            </div>

            <!-- Server -->
            <div class="mqtt-panel__row">
                <div class="mqtt-panel__row-label">
                    <strong>Server</strong>
                </div>
                <input
                    v-model="local.server"
                    class="mqtt-panel__input"
                    placeholder="Eg: my-server.com:1883"
                    @input="markDirty"
                />
            </div>

            <!-- Client ID -->
            <div class="mqtt-panel__row">
                <div class="mqtt-panel__row-label">
                    <strong>Client ID</strong>
                </div>
                <input
                    v-model="local.client_id"
                    class="mqtt-panel__input"
                    placeholder="Eg: kitchen-lights"
                    @input="markDirty"
                />
            </div>

            <!-- Username -->
            <div class="mqtt-panel__row">
                <div class="mqtt-panel__row-label">
                    <strong>Username</strong>
                </div>
                <input
                    v-model="local.user"
                    class="mqtt-panel__input"
                    placeholder="(none)"
                    @input="markDirty"
                />
            </div>

            <!-- Password -->
            <div class="mqtt-panel__row">
                <div class="mqtt-panel__row-label">
                    <strong>Password</strong>
                </div>
                <input
                    v-model="local.pass"
                    type="password"
                    autocomplete="current-password"
                    class="mqtt-panel__input"
                    placeholder="••••••••"
                    @input="markDirty"
                />
            </div>

            <!-- Topic Prefix -->
            <div class="mqtt-panel__row">
                <div class="mqtt-panel__row-label">
                    <strong>MQTT Prefix</strong>
                </div>
                <input
                    v-model="local.topic_prefix"
                    class="mqtt-panel__input"
                    @input="markDirty"
                />
            </div>

            <!-- Connection type -->
            <div class="mqtt-panel__row">
                <div class="mqtt-panel__row-label">
                    <strong>Connection Type</strong>
                </div>
                <Dropdown
                    :default="tlsModeLabel(local.ssl_ca)"
                    :options="tlsModeOptions"
                    @selected="(val) => { local.ssl_ca = tlsLabelToValue(val); markDirty(); }"
                />
            </div>

            <!-- mTLS toggle (only if device supports client certs) -->
            <div v-if="hasTlsClientCert" class="mqtt-panel__row">
                <div class="mqtt-panel__row-label">
                    <strong>Use client certificate for identification</strong>
                </div>
                <Checkbox v-model="local.use_client_cert" @update:model-value="markDirty" />
            </div>

            <!-- Certificate upload buttons (when TLS is configured) -->
            <div v-if="local.ssl_ca && local.ssl_ca !== ''" class="mqtt-panel__cert-section">
                <div class="mqtt-panel__section-label">Certificates</div>

                <div v-if="hasTlsUserCA" class="mqtt-panel__row">
                    <div class="mqtt-panel__row-label">
                        <strong>Custom certificate authority (CA) PEM bundle</strong>
                    </div>
                    <div class="mqtt-panel__cert-actions">
                        <Button type="blue" size="sm" @click="uploadCert('ca')">
                            Upload
                        </Button>
                        <Button type="red" size="sm" @click="deleteCert('ca')">Clear</Button>
                    </div>
                </div>

                <template v-if="hasTlsClientCert && local.use_client_cert">
                    <div class="mqtt-panel__row">
                        <div class="mqtt-panel__row-label">
                            <strong>Custom client certificate</strong>
                        </div>
                        <div class="mqtt-panel__cert-actions">
                            <Button type="blue" size="sm" @click="uploadCert('client_cert')">
                                Upload
                            </Button>
                            <Button type="red" size="sm" @click="deleteCert('client_cert')">Clear</Button>
                        </div>
                    </div>

                    <div class="mqtt-panel__row">
                        <div class="mqtt-panel__row-label">
                            <strong>Custom client key</strong>
                        </div>
                        <div class="mqtt-panel__cert-actions">
                            <Button type="blue" size="sm" @click="uploadCert('client_key')">
                                Upload
                            </Button>
                            <Button type="red" size="sm" @click="deleteCert('client_key')">Clear</Button>
                        </div>
                    </div>
                </template>
            </div>

            <!-- Advanced toggles -->
            <div class="mqtt-panel__section-label">Advanced</div>

            <div class="mqtt-panel__row">
                <div class="mqtt-panel__row-label"><strong>Enable 'MQTT Control'</strong></div>
                <Checkbox v-model="local.enable_control" @update:model-value="markDirty" />
            </div>

            <div class="mqtt-panel__row">
                <div class="mqtt-panel__row-label"><strong>Enable RPC over MQTT</strong></div>
                <Checkbox v-model="local.enable_rpc" @update:model-value="markDirty" />
            </div>

            <div class="mqtt-panel__row">
                <div class="mqtt-panel__row-label"><strong>RPC status notifications over MQTT</strong></div>
                <Checkbox v-model="local.rpc_ntf" @update:model-value="markDirty" />
            </div>

            <div class="mqtt-panel__row">
                <div class="mqtt-panel__row-label"><strong>Generic status update over MQTT</strong></div>
                <Checkbox v-model="local.status_ntf" @update:model-value="markDirty" />
            </div>

            <!-- Save / Reboot -->
            <div v-if="dirty" class="mqtt-panel__footer">
                <Button type="blue" size="sm" :loading="saving" @click="saveConfig">
                    Save
                </Button>
                <p class="mqtt-panel__warn">
                    <i class="fas fa-triangle-exclamation" /> MQTT changes require a device reboot.
                </p>
            </div>

            <div v-if="needsReboot" class="mqtt-panel__reboot-banner">
                <span><i class="fas fa-rotate" /> Reboot required to apply changes.</span>
                <Button type="blue" size="sm" :loading="rebooting" @click="rebootDevice">Reboot Now</Button>
            </div>
        </form>

        <div v-else class="mqtt-panel__error">
            <p>Failed to load MQTT configuration.</p>
            <Button type="blue-hollow" size="sm" @click="loadConfig">Retry</Button>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, reactive, ref, watch} from 'vue';
import {useDevicesStore} from '@/stores/devices';
import {useToastStore} from '@/stores/toast';
import {sendRPC} from '@/tools/websocket';
import Button from './Button.vue';
import Checkbox from './Checkbox.vue';
import Dropdown from './Dropdown.vue';

const CHUNK_SIZE = 4096;

const props = defineProps<{
    shellyID: string;
}>();

const deviceStore = useDevicesStore();
const toast = useToastStore();

const saving = ref(false);
const rebooting = ref(false);
const dirty = ref(false);
const needsReboot = ref(false);
const config = ref<any>(null);

const local = reactive({
    enable: false,
    server: '',
    client_id: '',
    user: '',
    pass: '',
    ssl_ca: '',
    topic_prefix: '',
    rpc_ntf: true,
    status_ntf: false,
    use_client_cert: false,
    enable_rpc: true,
    enable_control: true
});

// ── MQTT status ──
const mqttConnected = computed(() => {
    const dev = deviceStore.devices[props.shellyID];
    return dev?.status?.mqtt?.connected === true;
});

// ── TLS capability (derived from Shelly.ListMethods on device connect) ──
const hasTlsUserCA = computed(() => {
    return (
        deviceStore.devices[props.shellyID]?.capabilities?.tlsUserCA !== false
    );
});

const hasTlsClientCert = computed(() => {
    return (
        deviceStore.devices[props.shellyID]?.capabilities?.tlsClientCert !==
        false
    );
});

// ── TLS mode mapping ──
const TLS_MODES: Record<string, string> = {
    '': 'No TLS',
    '*': 'TLS no validation',
    'ca.pem': 'Default TLS',
    'user_ca.pem': 'User TLS'
};

const tlsModeOptions = computed(() => {
    const opts = ['No TLS', 'TLS no validation', 'Default TLS'];
    if (hasTlsUserCA.value) opts.push('User TLS');
    return opts;
});

function tlsModeLabel(val: string | null): string {
    return TLS_MODES[val ?? ''] ?? TLS_MODES[''];
}

function tlsLabelToValue(label: string): string {
    for (const [val, l] of Object.entries(TLS_MODES)) {
        if (l === label) return val;
    }
    return '';
}

function markDirty() {
    dirty.value = true;
}

// ── Load config from store (already fetched on device connect) ──
function loadConfig() {
    const mqtt = deviceStore.devices[props.shellyID]?.settings?.mqtt;
    if (!mqtt) {
        config.value = null;
        return;
    }
    config.value = mqtt;
    Object.assign(local, {
        enable: mqtt.enable ?? false,
        server: mqtt.server ?? '',
        client_id: mqtt.client_id ?? '',
        user: mqtt.user ?? '',
        pass: '',
        ssl_ca: mqtt.ssl_ca ?? '',
        topic_prefix: mqtt.topic_prefix ?? '',
        rpc_ntf: mqtt.rpc_ntf ?? true,
        status_ntf: mqtt.status_ntf ?? false,
        use_client_cert: mqtt.use_client_cert ?? false,
        enable_rpc: mqtt.enable_rpc ?? true,
        enable_control: mqtt.enable_control ?? true
    });
    dirty.value = false;
}

// ── Save config ──
async function saveConfig() {
    saving.value = true;
    try {
        const update: Record<string, any> = {
            enable: local.enable,
            server: local.server || null,
            client_id: local.client_id || null,
            user: local.user || null,
            ssl_ca: local.ssl_ca || null,
            topic_prefix: local.topic_prefix || null,
            rpc_ntf: local.rpc_ntf,
            status_ntf: local.status_ntf,
            use_client_cert: local.use_client_cert,
            enable_rpc: local.enable_rpc,
            enable_control: local.enable_control
        };
        if (local.pass) update.pass = local.pass;

        await sendRPC('FLEET_MANAGER', 'Mqtt.SetConfig', {
            shellyID: props.shellyID,
            config: update
        });
        toast.success('MQTT configuration saved');
        dirty.value = false;
        needsReboot.value = true;
        local.pass = '';
    } catch (err: any) {
        toast.error(err?.message ?? 'Failed to save MQTT config');
    } finally {
        saving.value = false;
    }
}

// ── Certificate upload ──
async function uploadCert(type: 'ca' | 'client_cert' | 'client_key') {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pem,.crt,.cer,.key';
    input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;

        const content = await file.text();
        const method = {
            ca: 'Security.PutUserCA',
            client_cert: 'Security.PutTLSClientCert',
            client_key: 'Security.PutTLSClientKey'
        }[type];

        try {
            const chunks: string[] = [];
            for (let i = 0; i < content.length; i += CHUNK_SIZE) {
                chunks.push(content.slice(i, i + CHUNK_SIZE));
            }

            for (let i = 0; i < chunks.length; i++) {
                await sendRPC('FLEET_MANAGER', method, {
                    shellyID: props.shellyID,
                    data: chunks[i],
                    append: i > 0
                });
                if (chunks.length > 1 && i < chunks.length - 1) {
                    await new Promise((r) => setTimeout(r, 200));
                }
            }

            const labels = {
                ca: 'CA certificate',
                client_cert: 'Client certificate',
                client_key: 'Client key'
            };
            toast.success(`${labels[type]} uploaded (${file.name})`);
        } catch (err: any) {
            toast.error(err?.message ?? 'Certificate upload failed');
        }
    };
    input.click();
}

async function deleteCert(type: 'ca' | 'client_cert' | 'client_key') {
    const labels = {
        ca: 'CA certificate',
        client_cert: 'Client certificate',
        client_key: 'Client key'
    };
    if (!confirm(`Delete ${labels[type]} from device?`)) return;

    const method = {
        ca: 'Security.PutUserCA',
        client_cert: 'Security.PutTLSClientCert',
        client_key: 'Security.PutTLSClientKey'
    }[type];

    try {
        await sendRPC('FLEET_MANAGER', method, {
            shellyID: props.shellyID,
            data: null,
            append: false
        });
        toast.info(`${labels[type]} deleted`);
    } catch (err: any) {
        toast.error(err?.message ?? 'Failed to delete certificate');
    }
}

// ── Reboot ──
async function rebootDevice() {
    rebooting.value = true;
    try {
        await sendRPC('FLEET_MANAGER', 'Shelly.Reboot', {
            shellyID: props.shellyID
        });
        toast.info('Device rebooting…');
        needsReboot.value = false;
    } catch (err: any) {
        toast.error(err?.message ?? 'Reboot failed');
    } finally {
        rebooting.value = false;
    }
}

// ── Init ──
onMounted(loadConfig);

watch(
    () => props.shellyID,
    () => {
        needsReboot.value = false;
        dirty.value = false;
        loadConfig();
    }
);
</script>

<style scoped>
.mqtt-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}

.mqtt-panel__status-row {
    display: flex;
    justify-content: flex-end;
    padding-bottom: var(--space-1);
}

.mqtt-panel__status {
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-2xl);
    text-transform: none;
    letter-spacing: 0.04em;
}

.mqtt-panel__status--on {
    background: rgba(var(--color-status-on-rgb), 0.1);
    color: var(--color-status-on);
    border: 1px solid rgba(var(--color-status-on-rgb), 0.2);
}

.mqtt-panel__status--off {
    background: rgba(240, 78, 94, 0.1);
    color: var(--color-status-off);
    border: 1px solid rgba(240, 78, 94, 0.2);
}

/* ── Rows ── */
.mqtt-panel__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-3);
    border-bottom: 0.5px solid var(--color-border-default);
    gap: var(--space-3);
    transition: background var(--duration-fast);
}

.mqtt-panel__row:hover {
    background: rgba(249, 250, 250, 0.04);
}

.mqtt-panel__row:last-child {
    border-bottom: none;
}

.mqtt-panel__row-label {
    flex: 1;
    min-width: 0;
}

.mqtt-panel__row-label strong {
    display: block;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.mqtt-panel__row-label span {
    display: block;
    font-size: var(--type-body);
    color: var(--color-frost);
    opacity: 0.6;
    margin-top: var(--space-0-5);
}

.mqtt-panel__input {
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-family: inherit;
    outline: none;
    width: 220px;
    transition: border-color var(--duration-fast);
}

.mqtt-panel__input:focus {
    border-color: var(--color-primary);
}

.mqtt-panel__input::placeholder {
    color: var(--color-frost);
    opacity: 0.4;
}

/* ── Section label ── */
.mqtt-panel__section-label {
    font-size: var(--type-body);
    font-weight: var(--font-black);
    color: var(--color-text-disabled);
    text-transform: none;
    letter-spacing: normal;
    padding: var(--space-2) var(--space-3) 0;
}

/* ── Certificate section ── */
.mqtt-panel__cert-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}

.mqtt-panel__cert-actions {
    display: flex;
    gap: var(--space-1);
    flex-shrink: 0;
}

/* ── Footer ── */
.mqtt-panel__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-top: 1px solid var(--color-border-default);
    margin-top: var(--space-1);
}

.mqtt-panel__warn {
    font-size: var(--type-body);
    color: var(--color-status-warn);
}

.mqtt-panel__warn i {
    margin-right: var(--space-1);
}

/* ── Reboot banner ── */
.mqtt-panel__reboot-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: rgba(var(--color-primary-rgb), 0.08);
    border: 1px solid rgba(var(--color-primary-rgb), 0.2);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-primary);
}

/* ── Misc ── */
.mqtt-panel__error {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3);
    color: var(--color-text-disabled);
    font-size: var(--type-body);
}
</style>
