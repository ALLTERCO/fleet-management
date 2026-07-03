<template>
    <div class="et-matter">
        <!-- Header: toggle + state + reboot -->
        <div class="et-matter__header">
            <button
                v-if="canExecute"
                class="et-matter__toggle"
                :class="isEnabled && 'et-matter__toggle--on'"
                @click="emit('toggle', !isEnabled)"
            >
                <i class="fas fa-power-off" />
            </button>
            <span class="et-matter__state" :class="isEnabled ? 'et-matter__state--on' : 'et-matter__state--off'">
                {{ isEnabled ? 'Enabled' : 'Disabled' }}
            </span>
            <button
                v-if="canExecute && restartRequired"
                class="et-matter__reboot-btn"
                :disabled="rebooting"
                title="Reboot device to apply Matter changes"
                @click="rebootDevice"
            >
                <i :class="rebooting ? 'fas fa-spinner fa-spin' : 'fas fa-rotate-right'" />
                {{ rebooting ? 'Rebooting...' : 'Reboot' }}
            </button>
        </div>

        <!-- Reboot notice — only when restart is needed -->
        <div v-if="restartRequired" class="et-matter__notice">
            <i class="fas fa-triangle-exclamation" />
            <span>Restart required to apply changes</span>
        </div>

        <!-- Rebooting feedback -->
        <div v-if="rebooting" class="et-matter__notice">
            <Spinner />
            <span>Rebooting device...</span>
        </div>

        <!-- Status info -->
        <div v-if="status" class="et-matter__info">
            <div class="et-matter__info-row">
                <span class="et-matter__info-label"><i class="fas fa-network-wired" /> Fabrics</span>
                <span class="et-matter__info-value">{{ status.num_fabrics ?? 0 }}</span>
            </div>
            <div class="et-matter__info-row">
                <span class="et-matter__info-label"><i class="fas fa-link" /> Commissionable</span>
                <span class="et-matter__info-value" :class="status.commissionable ? 'et-matter__info-value--yes' : 'et-matter__info-value--no'">
                    <i :class="status.commissionable ? 'fas fa-circle-check' : 'fas fa-circle-xmark'" />
                    {{ status.commissionable ? 'Yes' : 'No' }}
                </span>
            </div>
        </div>

        <!-- QR code section -->
        <div v-if="isEnabled" class="et-matter__qr-section">
            <div v-if="loadingCode" class="et-matter__loading">
                <Spinner />
                <span>Fetching setup code...</span>
            </div>
            <div v-else-if="codeError" class="et-matter__error">
                <i class="fas fa-exclamation-triangle" />
                <span>{{ codeError }}</span>
                <button class="et-matter__retry" @click="fetchSetupCode">Retry</button>
            </div>
            <template v-else-if="setupCode">
                <img
                    v-if="qrDataUrl"
                    :src="qrDataUrl"
                    alt="Matter QR Code"
                    class="et-matter__qr-img"
                />
                <div class="et-matter__manual">
                    <span class="et-matter__manual-label">Manual pairing code</span>
                    <div class="et-matter__manual-row">
                        <code class="et-matter__manual-code">{{ setupCode.manual_code }}</code>
                        <button class="et-matter__copy" :title="copied ? 'Copied!' : 'Copy'" aria-label="Copy pairing code" @click="copyCode">
                            <i :class="copied ? 'fas fa-check' : 'fas fa-copy'" :style="copied ? 'color: var(--color-success-text)' : ''" />
                        </button>
                    </div>
                </div>
            </template>
        </div>

        <!-- Error -->
        <div v-if="rpcError" class="et-matter__error">
            <i class="fas fa-triangle-exclamation" /> {{ rpcError }}
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, ref, watch} from 'vue';
import Spinner from '@/components/core/Spinner.vue';
import {generateMatterQR} from '@/helpers/matter-qr';
import {useDevicesStore} from '@/stores/devices';
import {sendRPC} from '@/tools/websocket';

const props = defineProps<{
    status: Record<string, any> | undefined;
    settings: Record<string, any> | undefined;
    canExecute: boolean;
    shellyID?: string;
}>();

const emit = defineEmits<{
    toggle: [enabled: boolean];
}>();

const deviceStore = useDevicesStore();

const isEnabled = computed(() => props.settings?.enable === true);

// Check sys.restart_required from device status
const restartRequired = computed(() => {
    if (!props.shellyID) return false;
    const device = deviceStore.devices[props.shellyID];
    return device?.status?.sys?.restart_required === true;
});

const rpcError = ref<string | null>(null);
const rebooting = ref(false);

async function rebootDevice() {
    if (!props.shellyID) return;
    rpcError.value = null;
    rebooting.value = true;
    try {
        await sendRPC('FLEET_MANAGER', 'Shelly.Reboot', {shellyID: props.shellyID});
    } catch (e: any) {
        rpcError.value = e.message || 'Reboot failed';
        rebooting.value = false;
    }
    // rebooting stays true — device will disconnect and reconnect,
    // which resets the component via device online/offline cycle
}

// Setup code state
const loadingCode = ref(false);
const codeError = ref<string | null>(null);
const setupCode = ref<{qr_code: string; manual_code: string} | null>(null);
const qrDataUrl = ref<string | null>(null);
const copied = ref(false);

async function fetchSetupCode() {
    if (!props.shellyID) return;
    loadingCode.value = true;
    codeError.value = null;
    setupCode.value = null;
    qrDataUrl.value = null;

    try {
        const result = await sendRPC<{qr_code: string; manual_code: string}>(
            'FLEET_MANAGER',
            'Matter.GetSetupCode',
            {shellyID: props.shellyID}
        );
        setupCode.value = result;
        if (result?.qr_code) {
            qrDataUrl.value = generateMatterQR(result.qr_code);
        }
    } catch (e: any) {
        codeError.value = e.message || 'Failed to get setup code';
    } finally {
        loadingCode.value = false;
    }
}

let copiedTimer: ReturnType<typeof setTimeout> | undefined;
function copyCode() {
    if (!setupCode.value) return;
    navigator.clipboard?.writeText(setupCode.value.manual_code).then(() => {
        copied.value = true;
        if (copiedTimer !== undefined) clearTimeout(copiedTimer);
        copiedTimer = setTimeout(() => {
            copied.value = false;
            copiedTimer = undefined;
        }, 1500);
    });
}

onBeforeUnmount(() => {
    if (copiedTimer !== undefined) clearTimeout(copiedTimer);
});

// Fetch setup code when enabled
watch(
    isEnabled,
    (v) => {
        if (v && !setupCode.value) fetchSetupCode();
    },
    {immediate: true}
);
</script>

<style scoped>
.et-matter {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

/* Header with toggle + state + reboot */
.et-matter__header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
.et-matter__state {
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    letter-spacing: var(--tracking-wide);
    flex: 1;
}
.et-matter__state--on {
    color: var(--color-success-text);
}
.et-matter__state--off {
    color: var(--color-text-disabled);
}
.et-matter__toggle {
    width: 36px;
    height: 36px;
    border-radius: var(--radius-full);
    border: 1px solid var(--color-border-default);
    background-color: var(--color-surface-3);
    color: var(--color-text-tertiary);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: var(--type-body);
    flex-shrink: 0;
    transition: background-color var(--duration-fast) var(--ease-default),
                color var(--duration-fast) var(--ease-default);
}
.et-matter__toggle:hover {
    background-color: var(--color-surface-3);
    color: var(--color-text-primary);
}
.et-matter__toggle--on {
    background-color: var(--color-success);
    border-color: var(--color-success);
    color: var(--color-text-primary);
}
.et-matter__reboot-btn {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) 0.625rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default);
    background-color: var(--color-surface-2);
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    cursor: pointer;
    flex-shrink: 0;
    transition: background-color var(--duration-fast) var(--ease-default),
                color var(--duration-fast) var(--ease-default);
}
.et-matter__reboot-btn:hover {
    background-color: var(--color-surface-3);
    color: var(--color-warning-text);
}

/* Reboot notice */
.et-matter__notice {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--type-body);
    color: var(--color-warning-text);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    background-color: color-mix(in srgb, var(--color-warning) 10%, transparent);
}

/* Status info rows */
.et-matter__info {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    padding: var(--space-1-5) var(--space-2);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-2);
}
.et-matter__info-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: var(--type-body);
}
.et-matter__info-label {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--color-text-disabled);
}
.et-matter__info-value {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--color-text-primary);
    font-weight: var(--font-semibold);
}
.et-matter__info-value--yes {
    color: var(--color-success-text);
}
.et-matter__info-value--no {
    color: var(--color-text-disabled);
}

/* QR code section */
.et-matter__qr-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    padding-top: var(--space-2);
    border-top: 1px solid var(--color-border-default);
}
.et-matter__loading {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}
.et-matter__error {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-danger-text);
    font-size: var(--type-body);
}
.et-matter__retry {
    color: var(--color-primary);
    font-size: var(--type-body);
    cursor: pointer;
    text-decoration: underline;
}
.et-matter__qr-img {
    width: 12rem;
    height: 12rem;
    border-radius: var(--radius-md);
    /* QR code needs pure white. */
    background: white;
    padding: var(--space-2);
}
.et-matter__manual {
    text-align: center;
    width: 100%;
}
.et-matter__manual-label {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.et-matter__manual-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    margin-top: var(--space-1);
}
.et-matter__manual-code {
    font-size: var(--type-subheading);
    font-family: monospace;
    letter-spacing: normal;
    color: var(--color-text-primary);
}
.et-matter__copy {
    color: var(--color-text-tertiary);
    cursor: pointer;
    padding: var(--space-1);
}
.et-matter__copy:hover {
    color: var(--color-text-primary);
}
</style>
