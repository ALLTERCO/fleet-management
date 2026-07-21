<template>
    <div class="cfg-panel">
        <form v-if="config" class="cfg-panel__form" @submit.prevent autocomplete="off">
            <section class="cfg-panel__workspace-section" aria-label="Connection settings">
                <div class="cfg-panel__toggle-grid">
                    <div class="cfg-panel__toggle">
                        <div class="cfg-panel__toggle-label">
                            <strong>Enable MQTT</strong>
                        </div>
                        <CardToggle size="row"
                            v-model="local.enable"
                            aria-label="Enable MQTT"
                            @update:model-value="markDirty"
                        />
                    </div>
                </div>

                <div class="cfg-panel__field-grid">
                    <label class="cfg-panel__field cfg-panel__field--wide" for="mqtt-server">
                        <strong>Server</strong>
                        <input
                            id="mqtt-server"
                            v-model="local.server"
                            class="cfg-panel__workspace-input"
                            placeholder="Eg: my-server.com:1883"
                            @input="markDirty"
                        />
                    </label>
                    <label class="cfg-panel__field" for="mqtt-username">
                        <strong>Username</strong>
                        <input
                            id="mqtt-username"
                            v-model="local.user"
                            class="cfg-panel__workspace-input"
                            placeholder="(none)"
                            autocomplete="username"
                            @input="markDirty"
                        />
                    </label>
                    <label class="cfg-panel__field" for="mqtt-password">
                        <strong>Password</strong>
                        <input
                            id="mqtt-password"
                            v-model="local.pass"
                            type="password"
                            autocomplete="current-password"
                            class="cfg-panel__workspace-input"
                            placeholder="••••••••"
                            @input="markDirty"
                        />
                    </label>
                </div>
            </section>

            <section class="cfg-panel__section cfg-panel__section--disclosure" aria-label="Advanced MQTT settings">
                <Collapse class="cfg-panel__disclosure" title="Advanced settings">
                    <div class="cfg-panel__toggle-grid">
                        <div class="cfg-panel__toggle">
                            <div class="cfg-panel__toggle-label">
                                <strong>Enable MQTT control</strong>
                            </div>
                            <CardToggle size="row"
                                v-model="local.enable_control"
                                aria-label="Enable MQTT control"
                                @update:model-value="markDirty"
                            />
                        </div>
                        <div class="cfg-panel__toggle">
                            <div class="cfg-panel__toggle-label">
                                <strong>Enable RPC over MQTT</strong>
                            </div>
                            <CardToggle size="row"
                                v-model="local.enable_rpc"
                                aria-label="Enable RPC over MQTT"
                                @update:model-value="markDirty"
                            />
                        </div>
                        <div class="cfg-panel__toggle">
                            <div class="cfg-panel__toggle-label">
                                <strong>RPC status notifications</strong>
                            </div>
                            <CardToggle size="row"
                                v-model="local.rpc_ntf"
                                aria-label="RPC status notifications over MQTT"
                                @update:model-value="markDirty"
                            />
                        </div>
                        <div class="cfg-panel__toggle">
                            <div class="cfg-panel__toggle-label">
                                <strong>Generic status updates</strong>
                            </div>
                            <CardToggle size="row"
                                v-model="local.status_ntf"
                                aria-label="Generic status update over MQTT"
                                @update:model-value="markDirty"
                            />
                        </div>
                        <div v-if="hasTlsClientCert" class="cfg-panel__toggle">
                            <div class="cfg-panel__toggle-label">
                                <strong>Use client certificate</strong>
                            </div>
                            <CardToggle size="row"
                                v-model="local.use_client_cert"
                                aria-label="Use client certificate for identification"
                                @update:model-value="markDirty"
                            />
                        </div>
                    </div>

                    <div class="cfg-panel__field-grid">
                        <label class="cfg-panel__field" for="mqtt-client-id">
                            <strong>Client ID</strong>
                            <input
                                id="mqtt-client-id"
                                v-model="local.client_id"
                                class="cfg-panel__workspace-input"
                                placeholder="Eg: kitchen-lights"
                                @input="markDirty"
                            />
                        </label>
                        <label class="cfg-panel__field" for="mqtt-topic-prefix">
                            <strong>MQTT prefix</strong>
                            <input
                                id="mqtt-topic-prefix"
                                v-model="local.topic_prefix"
                                class="cfg-panel__workspace-input"
                                @input="markDirty"
                            />
                        </label>
                    </div>

                    <div class="cfg-panel__group">
                        <div class="cfg-panel__row">
                            <div class="cfg-panel__row-label">
                                <strong>Connection type</strong>
                            </div>
                            <div class="cfg-panel__control">
                                <Dropdown
                                    aria-label="TLS connection type"
                                    :default="tlsModeLabel(local.ssl_ca)"
                                    :options="tlsModeOptions"
                                    @selected="(val) => { local.ssl_ca = tlsLabelToValue(val); markDirty(); }"
                                />
                            </div>
                        </div>

                        <template v-if="local.ssl_ca">
                            <div v-if="hasTlsUserCA" class="cfg-panel__row">
                                <div class="cfg-panel__row-label">
                                    <strong>Custom certificate authority (CA) PEM bundle</strong>
                                </div>
                                <div class="mqtt-panel__cert-actions">
                                    <Button type="blue" size="sm" @click="uploadCert('ca')">
                                        Upload
                                    </Button>
                                    <Button type="red" size="sm" @click="deleteCert('ca')">
                                        Delete
                                    </Button>
                                </div>
                            </div>

                            <template v-if="hasTlsClientCert && local.use_client_cert">
                                <div class="cfg-panel__row">
                                    <div class="cfg-panel__row-label">
                                        <strong>Custom client certificate</strong>
                                    </div>
                                    <div class="mqtt-panel__cert-actions">
                                        <Button type="blue" size="sm" @click="uploadCert('client_cert')">
                                            Upload
                                        </Button>
                                        <Button type="red" size="sm" @click="deleteCert('client_cert')">
                                            Delete
                                        </Button>
                                    </div>
                                </div>

                                <div class="cfg-panel__row">
                                    <div class="cfg-panel__row-label">
                                        <strong>Custom client key</strong>
                                    </div>
                                    <div class="mqtt-panel__cert-actions">
                                        <Button type="blue" size="sm" @click="uploadCert('client_key')">
                                            Upload
                                        </Button>
                                        <Button type="red" size="sm" @click="deleteCert('client_key')">
                                            Delete
                                        </Button>
                                    </div>
                                </div>
                            </template>
                        </template>
                    </div>
                </Collapse>
            </section>

            <ConfigPanelFooter
                label="MQTT"
                :dirty="dirty"
                :saving="saving"
                :restart-required="restartRequired"
                :rebooting="rebooting"
                :external-changed="externalConfigChanged"
                @save="save"
                @reboot="rebootDevice"
                @refresh="reload"
            />
        </form>

        <div v-else-if="refetching" class="cfg-panel__loading">
            Loading configuration…
        </div>
        <div v-else class="cfg-panel__error">
            <p>Failed to load MQTT configuration.</p>
            <Button type="blue-hollow" size="sm" :loading="refetching" @click="refetch">Retry</Button>
        </div>

        <ConfirmationModal ref="certConfirm" />
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import {useDeviceConfigPanel} from '@/composables/useDeviceConfigPanel';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {useDevicesStore} from '@/stores/devices';
import {useToastStore} from '@/stores/toast';
import {sendRPC} from '@/tools/websocket';
import ConfirmationModal from '../modals/ConfirmationModal.vue';
import Button from './Button.vue';
import Collapse from './Collapse.vue';
import ConfigPanelFooter from './ConfigPanelFooter.vue';
import Dropdown from './Dropdown.vue';
import CardToggle from '../cards/CardToggle.vue';

const CHUNK_SIZE = 4096;

const props = defineProps<{
    shellyID: string;
}>();

const deviceStore = useDevicesStore();
const toast = useToastStore();

const certConfirm = ref<InstanceType<typeof ConfirmationModal> | null>(null);

interface MqttConfig {
    enable?: boolean;
    server?: string | null;
    client_id?: string | null;
    user?: string | null;
    pass?: string | null;
    ssl_ca?: string | null;
    topic_prefix?: string | null;
    rpc_ntf?: boolean;
    status_ntf?: boolean;
    use_client_cert?: boolean;
    enable_rpc?: boolean;
    enable_control?: boolean;
}

interface MqttLocalForm {
    enable: boolean;
    server: string;
    client_id: string;
    user: string;
    pass: string;
    ssl_ca: string;
    topic_prefix: string;
    rpc_ntf: boolean;
    status_ntf: boolean;
    use_client_cert: boolean;
    enable_rpc: boolean;
    enable_control: boolean;
}

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
} = useDeviceConfigPanel<MqttConfig, MqttLocalForm>({
    shellyID: () => props.shellyID,
    settingsKey: 'mqtt',
    method: 'Mqtt.SetConfig',
    initialLocal: {
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
    },
    mapToLocal: (c) => ({
        enable: c.enable ?? false,
        server: c.server ?? '',
        client_id: c.client_id ?? '',
        user: c.user ?? '',
        pass: '',
        ssl_ca: c.ssl_ca ?? '',
        topic_prefix: c.topic_prefix ?? '',
        rpc_ntf: c.rpc_ntf ?? true,
        status_ntf: c.status_ntf ?? false,
        use_client_cert: c.use_client_cert ?? false,
        enable_rpc: c.enable_rpc ?? true,
        enable_control: c.enable_control ?? true
    }),
    mapToUpdate: (l) => {
        const update: MqttConfig = {
            enable: l.enable,
            server: l.server || null,
            client_id: l.client_id || null,
            user: l.user || null,
            ssl_ca: l.ssl_ca || null,
            topic_prefix: l.topic_prefix || null,
            rpc_ntf: l.rpc_ntf,
            status_ntf: l.status_ntf,
            use_client_cert: l.use_client_cert,
            enable_rpc: l.enable_rpc,
            enable_control: l.enable_control
        };
        if (l.pass) update.pass = l.pass;
        return update;
    },
    successToast: 'MQTT configuration saved',
    onSaved: (l) => {
        l.pass = '';
    }
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
        } catch (err: unknown) {
            toast.error(rpcErrorMessage(err));
        }
    };
    input.click();
}

const CERT_LABELS = {
    ca: 'CA certificate',
    client_cert: 'Client certificate',
    client_key: 'Client key'
} as const;

function deleteCert(type: 'ca' | 'client_cert' | 'client_key'): void {
    certConfirm.value?.storeAction(() => performCertDelete(type), {
        title: `Delete ${CERT_LABELS[type]}?`,
        message: 'This removes the certificate from the device.',
        confirmLabel: 'Delete'
    });
}

async function performCertDelete(
    type: 'ca' | 'client_cert' | 'client_key'
): Promise<void> {
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
        toast.info(`${CERT_LABELS[type]} deleted`);
    } catch (err: unknown) {
        toast.error(rpcErrorMessage(err));
    }
}
</script>

<style scoped>
.mqtt-panel__cert-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    flex-shrink: 0;
}

/* Single modal-wide mobile breakpoint — keep in sync with the
   device-settings shell in DeviceBoard.vue (767px). */
@media (max-width: 767px) {
    .mqtt-panel__cert-actions {
        justify-content: flex-start;
    }
}
</style>
