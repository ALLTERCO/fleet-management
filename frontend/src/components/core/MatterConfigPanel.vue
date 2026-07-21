<template>
    <div class="cfg-panel matter-panel">
        <form
            v-if="config"
            class="cfg-panel__form"
            autocomplete="off"
            @submit.prevent
        >
            <section
                class="cfg-panel__workspace-section"
                aria-label="Matter settings"
            >
                <div class="cfg-panel__toggle-grid">
                    <div class="cfg-panel__toggle">
                        <div class="cfg-panel__toggle-label">
                            <strong>Enable Matter</strong>
                        </div>
                        <CardToggle size="row"
                            v-model="local.enable"
                            aria-label="Enable Matter"
                            @update:model-value="markDirty"
                        />
                    </div>
                </div>

                <div v-if="matterStatus" class="cfg-panel__field-grid">
                    <div
                        v-if="matterStatus.commissionable !== undefined"
                        class="cfg-panel__field"
                    >
                        <strong>Ready to pair</strong>
                        <span class="cfg-panel__field-help">
                            Reported by the device. When no, restart the
                            device to reopen pairing.
                        </span>
                        <code class="cfg-panel__readonly-value">
                            {{ matterStatus.commissionable ? 'Yes' : 'No' }}
                        </code>
                    </div>
                    <div
                        v-if="matterStatus.num_fabrics !== undefined"
                        class="cfg-panel__field"
                    >
                        <strong>Joined fabrics</strong>
                        <span class="cfg-panel__field-help">
                            Matter networks this device belongs to.
                        </span>
                        <code class="cfg-panel__readonly-value">
                            {{ matterStatus.num_fabrics }}
                        </code>
                    </div>
                </div>
            </section>

            <section
                class="cfg-panel__workspace-section"
                aria-label="Matter setup code"
            >
                <div class="cfg-panel__field-grid">
                    <div class="cfg-panel__field cfg-panel__field--wide">
                        <strong>Setup code</strong>
                        <span class="cfg-panel__field-help">
                            You need this code to pair the device with a
                            Matter controller.
                        </span>
                        <div
                            v-if="loadingSetupCode"
                            class="cfg-panel__field-help"
                            role="status"
                            aria-live="polite"
                        >
                            <i class="fas fa-spinner fa-spin" aria-hidden="true" />
                            Loading setup code…
                        </div>
                        <div
                            v-else-if="setupCode"
                            class="matter-panel__pairing"
                        >
                            <img
                                v-if="qrDataUrl"
                                :src="qrDataUrl"
                                alt="Matter pairing QR code"
                                class="matter-panel__qr"
                            />
                            <div
                                v-if="setupCode.manual_code"
                                class="matter-panel__manual"
                            >
                                <span class="matter-panel__manual-label">
                                    Manual pairing code
                                </span>
                                <div class="matter-panel__manual-row">
                                    <span class="matter-panel__code-wrap">
                                        <code class="matter-panel__manual-code">
                                            {{ setupCode.manual_code }}
                                        </code>
                                        <button
                                            type="button"
                                            class="matter-panel__copy"
                                            :title="copied ? 'Copied!' : 'Copy'"
                                            aria-label="Copy pairing code"
                                            @click="copyCode"
                                        >
                                            <i
                                                :class="copied ? 'fas fa-check' : 'fas fa-copy'"
                                                :style="copied ? 'color: var(--color-success-text)' : ''"
                                                aria-hidden="true"
                                            />
                                        </button>
                                    </span>
                                </div>
                            </div>
                        </div>
                        <template v-else>
                            <span class="cfg-panel__field-help">
                                Setup code unavailable.
                            </span>
                            <Button
                                type="blue-hollow"
                                size="sm"
                                @click="fetchSetupCode"
                            >
                                Retry
                            </Button>
                        </template>
                    </div>
                </div>
            </section>

            <ConfigPanelFooter
                label="Matter"
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
            <p>Failed to load Matter configuration.</p>
            <Button
                type="blue-hollow"
                size="sm"
                :loading="refetching"
                @click="refetch"
            >
                Retry
            </Button>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, ref, watch} from 'vue';
import {useDeviceConfigPanel} from '@/composables/useDeviceConfigPanel';
import {generateMatterQR} from '@/helpers/matter-qr';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {useDevicesStore} from '@/stores/devices';
import {useToastStore} from '@/stores/toast';
import {sendRPC} from '@/tools/websocket';
import Button from './Button.vue';
import ConfigPanelFooter from './ConfigPanelFooter.vue';
import CardToggle from '../cards/CardToggle.vue';

interface MatterConfig {
    enable?: boolean;
}

interface MatterStatus {
    num_fabrics?: number;
    commissionable?: boolean;
}

interface MatterSetupCode {
    qr_code?: string;
    manual_code?: string;
}

const props = defineProps<{shellyID: string}>();
const deviceStore = useDevicesStore();
const toast = useToastStore();

const loadingSetupCode = ref(false);
const setupCode = ref<MatterSetupCode | null>(null);
const qrDataUrl = ref<string | null>(null);

const matterStatus = computed<MatterStatus | null>(() => {
    const status = deviceStore.devices[props.shellyID]?.status?.matter;
    return status && typeof status === 'object'
        ? (status as MatterStatus)
        : null;
});

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
    reload,
    refetch,
    refetching
} = useDeviceConfigPanel<MatterConfig, {enable: boolean}>({
    shellyID: () => props.shellyID,
    settingsKey: 'matter',
    method: 'Matter.SetConfig',
    initialLocal: {enable: false},
    mapToLocal: (c) => ({enable: c.enable ?? false}),
    mapToUpdate: (l) => ({enable: l.enable}),
    successToast: 'Matter configuration saved'
});

async function fetchSetupCode(): Promise<void> {
    const shellyID = props.shellyID;
    loadingSetupCode.value = true;
    try {
        const response = await sendRPC<MatterSetupCode>(
            'FLEET_MANAGER',
            'Matter.GetSetupCode',
            {shellyID}
        );
        if (shellyID !== props.shellyID) return;
        setupCode.value = response ?? null;
        qrDataUrl.value = response?.qr_code
            ? generateMatterQR(response.qr_code)
            : null;
    } catch (err: unknown) {
        if (shellyID !== props.shellyID) return;
        setupCode.value = null;
        qrDataUrl.value = null;
        toast.error(rpcErrorMessage(err));
    } finally {
        if (shellyID === props.shellyID) loadingSetupCode.value = false;
    }
}

const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

async function copyCode(): Promise<void> {
    const code = setupCode.value?.manual_code;
    if (!code) return;
    await navigator.clipboard.writeText(code);
    copied.value = true;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
        copied.value = false;
    }, 2000);
}

// Pairing needs the code immediately — no reason to hide it behind a click.
onMounted(fetchSetupCode);
watch(
    () => props.shellyID,
    () => {
        setupCode.value = null;
        qrDataUrl.value = null;
        void fetchSetupCode();
    }
);
</script>

<style scoped>
/* Same pairing-block anatomy as EntityTemplate_Matter — one look. */
.matter-panel__pairing {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4) 0;
}

.matter-panel__qr {
    width: 12rem;
    height: 12rem;
    border-radius: var(--radius-md);
    /* QR code needs pure white. */
    background: white;
    padding: var(--space-2);
}

.matter-panel__manual {
    width: 100%;
    text-align: center;
}

.matter-panel__manual-label {
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}

.matter-panel__manual-row {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-top: var(--space-1);
}

/* The copy button hangs off the code's right edge, outside the centering
   math — the digits stay centered on the QR axis. */
.matter-panel__code-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
}

.matter-panel__manual-code {
    color: var(--color-text-primary);
    font-family: var(--font-mono);
    font-size: var(--type-subheading);
}

.matter-panel__copy {
    position: absolute;
    top: 50%;
    left: 100%;
    translate: 0 -50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--touch-target-min);
    min-height: var(--touch-target-min);
    color: var(--color-text-tertiary);
    cursor: pointer;
}

.matter-panel__copy:hover {
    color: var(--color-text-primary);
}

.matter-panel__copy:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
    border-radius: var(--radius-sm);
}
</style>
