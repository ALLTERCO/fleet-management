<template>
    <Modal :visible="visible" @close="emit('close')">
        <template #title>
            <h3>Pair a BLE sensor</h3>
        </template>

        <div class="btpw">
            <div v-if="!selectedGatewayID" class="btpw__picker">
                <p class="btpw__hint">Select the BLE gateway the sensor will pair through:</p>
                <div v-if="loading" class="btpw__empty">Loading gateways…</div>
                <div v-else-if="loadError" class="btpw__error">{{ loadError }}</div>
                <div v-else-if="bleGateways.length === 0" class="btpw__empty">
                    No BLE-capable gateway online.
                </div>
                <button
                    v-for="gw in bleGateways"
                    :key="gw.shellyID"
                    type="button"
                    class="btpw__gateway"
                    @click="selectedGatewayID = gw.shellyID"
                >
                    <i class="fab fa-bluetooth-b btpw__bt-icon" />
                    <div class="btpw__gateway-info">
                        <span class="btpw__gateway-name">{{ gw.name }}</span>
                        <span class="btpw__gateway-id">{{ gw.shellyID }}</span>
                    </div>
                    <i class="fas fa-chevron-right" />
                </button>
            </div>

            <div v-else class="btpw__config">
                <button
                    type="button"
                    class="btpw__back"
                    @click="selectedGatewayID = null"
                >
                    <i class="fas fa-chevron-left" /> Change gateway
                </button>
                <BtHomeConfig :shelly-i-d="selectedGatewayID" />
            </div>
        </div>

        <template #footer>
            <div class="btpw__footer">
                <Button type="blue-hollow" size="sm" @click="emit('close')">Close</Button>
            </div>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import {type BTHomeGateway, bluetoothDevices} from '@host/bluetoothDevices';
import {ref, watch} from 'vue';
import BtHomeConfig from '@/components/core/BtHomeConfig.vue';
import Button from '@/components/core/Button.vue';
import Modal from '@/components/modals/Modal.vue';

const props = defineProps<{visible: boolean}>();
const emit = defineEmits<{close: []}>();

const selectedGatewayID = ref<string | null>(null);
const bleGateways = ref<BTHomeGateway[]>([]);
const loading = ref(false);
const loadError = ref('');

async function loadGateways() {
    loading.value = true;
    loadError.value = '';
    try {
        const res = await bluetoothDevices.listGateways();
        bleGateways.value = res?.items ?? [];
    } catch (err) {
        loadError.value = err instanceof Error ? err.message : String(err);
        bleGateways.value = [];
    } finally {
        loading.value = false;
    }
}

watch(
    () => props.visible,
    (open) => {
        if (!open) return;
        selectedGatewayID.value = null;
        loadGateways();
    }
);
</script>

<style scoped>
.btpw {
    width: 100%;
    max-width: var(--floating-w-xl);
}
@media (min-width: 480px) {
    .btpw { min-width: var(--floating-w-form); }
}
.btpw__hint {
    margin: 0 0 var(--gap-md);
    color: var(--color-text-secondary);
    font-size: var(--type-body);
}
.btpw__empty {
    padding: var(--gap-xl);
    text-align: center;
    color: var(--color-text-disabled);
    font-size: var(--type-body);
}
.btpw__error {
    padding: var(--gap-md);
    color: var(--color-danger-text);
    font-size: var(--type-body);
}
.btpw__gateway {
    display: flex;
    align-items: center;
    gap: var(--gap-md);
    width: 100%;
    min-height: var(--touch-target-min);
    padding: var(--gap-sm) var(--gap-md);
    margin-bottom: var(--gap-xs);
    background: var(--color-surface-3);
    border: 1px solid var(--color-border-default);
    border-radius: var(--btn-radius);
    color: var(--color-text-primary);
    font-family: inherit;
    cursor: pointer;
    transition: border-color var(--duration-fast);
}
.btpw__gateway:hover {
    border-color: var(--color-border-focus);
}
.btpw__bt-icon {
    color: var(--color-primary);
}
.btpw__gateway-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
}
.btpw__gateway-name {
    font-weight: var(--font-medium);
}
.btpw__gateway-id {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.btpw__back {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-xs);
    margin-bottom: var(--gap-md);
    padding: var(--gap-xs) var(--gap-sm);
    background: transparent;
    border: none;
    color: var(--color-text-secondary);
    cursor: pointer;
    font-size: var(--type-body);
}
.btpw__back:hover {
    color: var(--color-text-primary);
}
.btpw__footer {
    display: flex;
    justify-content: flex-end;
}
</style>
