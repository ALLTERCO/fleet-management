<template>
    <div class="device-diagnostics">
        <ViewToggle
            v-model="activeView"
            :options="viewOptions"
            class="route-tabs--fluid"
            aria-label="Diagnostic view"
        />

        <div v-if="activeView === 'tools'" class="device-diagnostics__tools">
            <div class="device-diagnostics__tool-row">
                <div class="device-diagnostics__tool-copy">
                    <strong>Ping device</strong>
                    <span>Round trip through Fleet Manager to the device.</span>
                </div>
                <Button
                    type="blue-hollow"
                    size="sm"
                    :loading="pinging"
                    :disabled="!online"
                    @click="pingDevice"
                >
                    Ping
                </Button>
            </div>
            <p
                v-if="pingResult"
                class="device-diagnostics__tool-result"
                role="status"
            >
                {{ pingResult }}
            </p>
            <p v-if="!online" class="device-diagnostics__notice">
                The device must be online to ping it.
            </p>

            <div class="device-diagnostics__tool-row">
                <div class="device-diagnostics__tool-copy">
                    <strong>Download diagnostics</strong>
                    <span>
                        Saves a JSON file with device info, status and
                        configuration for support tickets.
                    </span>
                </div>
                <Button type="blue-hollow" size="sm" @click="downloadDiagnostics">
                    Download
                </Button>
            </div>

            <div v-if="canBackup" class="device-diagnostics__tool-row">
                <div class="device-diagnostics__tool-copy">
                    <strong>Download device config</strong>
                    <span>
                        Saves the device's own settings backup file.
                    </span>
                </div>
                <Button
                    type="blue-hollow"
                    size="sm"
                    :loading="downloadingConfig"
                    :disabled="!online"
                    @click="downloadDeviceConfig"
                >
                    Download
                </Button>
            </div>
            <p
                v-if="configDownloadError"
                class="device-diagnostics__error"
                role="alert"
            >
                {{ configDownloadError }}
            </p>
        </div>

        <div v-else-if="activeView === 'command'" class="device-diagnostics__command">
            <form class="device-diagnostics__form" @submit.prevent="sendCommand">
                <div class="device-diagnostics__command-row">
                    <label class="device-diagnostics__field" for="diagnostic-rpc-method">
                        <span>Method</span>
                        <input
                            id="diagnostic-rpc-method"
                            v-model="commandMethod"
                            type="text"
                            list="diagnostic-rpc-methods"
                            placeholder="Shelly.GetStatus"
                            autocomplete="off"
                            spellcheck="false"
                            :disabled="sending"
                        />
                    </label>
                    <Button
                        type="blue"
                        size="sm"
                        submit
                        :loading="sending"
                        :disabled="!canSend"
                    >
                        Send command
                    </Button>
                </div>
                <datalist id="diagnostic-rpc-methods">
                    <option
                        v-for="method in availableMethods"
                        :key="method"
                        :value="method"
                    />
                </datalist>

                <label class="device-diagnostics__field" for="diagnostic-rpc-params">
                    <span>Parameters</span>
                    <textarea
                        id="diagnostic-rpc-params"
                        v-model="commandParams"
                        rows="7"
                        spellcheck="false"
                        :disabled="sending"
                    />
                </label>

                <p v-if="!online" class="device-diagnostics__notice">
                    The device must be online to send a command.
                </p>
                <p v-if="validationError" class="device-diagnostics__error" role="alert">
                    {{ validationError }}
                </p>
            </form>

            <section v-if="commandResponse" class="device-diagnostics__response">
                <h4>Response</h4>
                <JSONViewer :data="commandResponse" />
            </section>
        </div>

        <JSONViewer v-else :data="activeData" />
    </div>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, ref, watch} from 'vue';
import {
    canRunDiagnosticMethod,
    diagnosticMethods
} from '@/helpers/deviceDiagnostics';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {sendRPC} from '@/tools/websocket';
import Button from '../core/Button.vue';
import JSONViewer from '../core/JSONViewer.vue';
import ViewToggle, {type ViewToggleOption} from '../core/ViewToggle.vue';

type DiagnosticView = 'info' | 'status' | 'settings' | 'tools' | 'command';

const props = withDefaults(
    defineProps<{
        shellyID: string;
        information?: Record<string, unknown>;
        status?: Record<string, unknown>;
        configuration?: Record<string, unknown>;
        methods?: string[];
        online?: boolean;
        canExecute?: boolean;
        canBackup?: boolean;
    }>(),
    {
        information: () => ({}),
        status: () => ({}),
        configuration: () => ({}),
        methods: () => [],
        online: false,
        canExecute: false,
        canBackup: false
    }
);

const DATA_VIEWS: ViewToggleOption<DiagnosticView>[] = [
    {value: 'info', label: 'Information', icon: 'fas fa-circle-info'},
    {value: 'status', label: 'Current status', icon: 'fas fa-wave-square'},
    {value: 'settings', label: 'Configuration', icon: 'fas fa-sliders'},
    {value: 'tools', label: 'Tools', icon: 'fas fa-screwdriver-wrench'}
];

const activeView = ref<DiagnosticView>('info');
const commandMethod = ref('Shelly.GetStatus');
const commandParams = ref('{}');
const commandResponse = ref<Record<string, unknown> | null>(null);
const validationError = ref('');
const sending = ref(false);
let requestSequence = 0;

const availableMethods = computed(() => diagnosticMethods(props.methods));

const viewOptions = computed<ViewToggleOption<DiagnosticView>[]>(() =>
    props.canExecute
        ? [
              ...DATA_VIEWS,
              {value: 'command', label: 'Command', icon: 'fas fa-terminal'}
          ]
        : DATA_VIEWS
);

const activeData = computed<Record<string, unknown>>(() => {
    if (activeView.value === 'status') return props.status;
    if (activeView.value === 'settings') return props.configuration;
    return props.information;
});

const pinging = ref(false);
const pingResult = ref('');
let pingSequence = 0;

async function pingDevice(): Promise<void> {
    const target = props.shellyID;
    const requestId = ++pingSequence;
    pinging.value = true;
    pingResult.value = '';
    const startedAt = performance.now();
    try {
        await sendRPC('FLEET_MANAGER', 'Shelly.GetDeviceInfo', {
            shellyID: target
        });
        if (requestId !== pingSequence || target !== props.shellyID) return;
        const elapsed = Math.round(performance.now() - startedAt);
        pingResult.value = `Reply in ${elapsed} ms`;
    } catch (error) {
        if (requestId !== pingSequence || target !== props.shellyID) return;
        pingResult.value = rpcErrorMessage(error, 'No reply from the device');
    } finally {
        if (requestId === pingSequence) pinging.value = false;
    }
}

function saveJsonFile(name: string, data: unknown): void {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
}

function downloadDiagnostics(): void {
    saveJsonFile(`${props.shellyID}-diagnostics.json`, {
        shellyID: props.shellyID,
        generatedAt: new Date().toISOString(),
        information: props.information,
        status: props.status,
        configuration: props.configuration,
        methods: props.methods
    });
}

const downloadingConfig = ref(false);
const configDownloadError = ref('');
let configSequence = 0;

async function downloadDeviceConfig(): Promise<void> {
    const target = props.shellyID;
    const requestId = ++configSequence;
    downloadingConfig.value = true;
    configDownloadError.value = '';
    try {
        const response = await sendRPC('FLEET_MANAGER', 'Sys.DownloadSettings', {
            shellyID: target
        });
        if (requestId !== configSequence || target !== props.shellyID) return;
        if (response === undefined || response === null) {
            configDownloadError.value =
                'The device returned no settings backup.';
            return;
        }
        saveJsonFile(`${target}-config.json`, response);
    } catch (error) {
        if (requestId !== configSequence || target !== props.shellyID) return;
        configDownloadError.value = rpcErrorMessage(
            error,
            'Config download failed'
        );
    } finally {
        if (requestId === configSequence) downloadingConfig.value = false;
    }
}

const canSend = computed(
    () =>
        props.canExecute &&
        props.online &&
        commandMethod.value.trim().length > 0 &&
        !sending.value
);

function parseParams(): Record<string, unknown> | null {
    try {
        const parsed: unknown = JSON.parse(commandParams.value || '{}');
        if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
            validationError.value = 'Parameters must be a JSON object.';
            return null;
        }
        return parsed as Record<string, unknown>;
    } catch {
        validationError.value = 'Parameters contain invalid JSON.';
        return null;
    }
}

function responseObject(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return {result: value};
}

async function sendCommand(): Promise<void> {
    validationError.value = '';
    if (!canSend.value) return;
    const method = commandMethod.value.trim();
    if (!canRunDiagnosticMethod(method, props.methods)) {
        validationError.value =
            'Choose a read-only method advertised by this device.';
        return;
    }
    const params = parseParams();
    if (!params) return;

    const requestId = ++requestSequence;
    const target = props.shellyID;
    sending.value = true;
    commandResponse.value = null;
    try {
        const response = await sendRPC(
            target,
            method,
            params
        );
        if (requestId !== requestSequence || target !== props.shellyID) return;
        commandResponse.value = responseObject(response);
    } catch (error) {
        if (requestId !== requestSequence || target !== props.shellyID) return;
        commandResponse.value = {
            error: {message: rpcErrorMessage(error, 'Command failed')}
        };
    } finally {
        if (requestId === requestSequence) sending.value = false;
    }
}

function reset(): void {
    requestSequence += 1;
    pingSequence += 1;
    configSequence += 1;
    downloadingConfig.value = false;
    configDownloadError.value = '';
    activeView.value = 'info';
    commandMethod.value = 'Shelly.GetStatus';
    commandParams.value = '{}';
    commandResponse.value = null;
    validationError.value = '';
    sending.value = false;
    pinging.value = false;
    pingResult.value = '';
}

watch(() => props.shellyID, reset);
watch(
    () => props.canExecute,
    (allowed) => {
        if (!allowed && activeView.value === 'command') activeView.value = 'info';
    }
);
onBeforeUnmount(() => {
    requestSequence += 1;
    pingSequence += 1;
});
</script>

<style scoped>
.device-diagnostics {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: var(--gap-md);
}
.device-diagnostics__command,
.device-diagnostics__form,
.device-diagnostics__field,
.device-diagnostics__response {
    display: flex;
    min-width: 0;
    flex-direction: column;
}
.device-diagnostics__command {
    gap: var(--gap-md);
}
.device-diagnostics__tools {
    display: flex;
    min-width: 0;
    flex-direction: column;
}
.device-diagnostics__tool-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-md);
    min-height: var(--touch-target-min);
    padding: var(--space-2) var(--space-3);
    border-bottom: var(--space-px) solid var(--color-border-subtle);
}
.device-diagnostics__tool-row:last-of-type {
    border-bottom: none;
}
.device-diagnostics__tool-copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
}
.device-diagnostics__tool-copy strong {
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}
.device-diagnostics__tool-copy span {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.device-diagnostics__tool-result {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    color: var(--color-text-secondary);
    font-family: var(--font-mono);
    font-size: var(--type-caption);
}
.device-diagnostics__form {
    gap: var(--gap-sm);
}
.device-diagnostics__command-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
    gap: var(--gap-sm);
}
.device-diagnostics__field {
    gap: var(--gap-xs);
}
.device-diagnostics__field > span,
.device-diagnostics__response h4 {
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}
.device-diagnostics__field input,
.device-diagnostics__field textarea {
    width: 100%;
    min-height: var(--touch-target-min);
    padding: var(--input-padding) var(--space-3);
    border: var(--space-px) solid var(--input-border);
    border-radius: var(--input-radius);
    background: var(--input-bg);
    color: var(--color-text-primary);
    font-family: var(--font-mono, monospace);
    font-size: var(--type-body);
    resize: vertical;
}
.device-diagnostics__field input:focus-visible,
.device-diagnostics__field textarea:focus-visible {
    border-color: var(--input-focus-ring);
    box-shadow: 0 0 0 var(--focus-ring-width) var(--focus-ring-color);
    outline: none;
}
.device-diagnostics__notice,
.device-diagnostics__error {
    margin: 0;
    font-size: var(--type-body);
}
.device-diagnostics__notice {
    color: var(--color-text-secondary);
}
.device-diagnostics__error {
    color: var(--color-danger-text);
}
.device-diagnostics__response {
    gap: var(--gap-sm);
    padding-top: var(--gap-md);
    border-top: var(--space-px) solid var(--color-border-subtle);
}
.device-diagnostics__response h4 {
    margin: 0;
}
@media (max-width: 767px) {
    .device-diagnostics__command-row {
        grid-template-columns: minmax(0, 1fr);
    }

    .device-diagnostics__tool-row {
        align-items: stretch;
        flex-direction: column;
        gap: var(--space-2);
        padding: var(--space-3);
    }
}
</style>
