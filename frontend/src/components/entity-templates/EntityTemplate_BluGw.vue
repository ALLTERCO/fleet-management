<template>
    <div class="et-blugw">
        <div class="et-blugw__row">
            <span class="et-blugw__label">System LED</span>
            <Checkbox
                :model-value="settings?.sys_led_enable ?? true"
                :disabled="!canExecute"
                @update:model-value="(val) => setConfig({sys_led_enable: val})"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import {useDevicesStore} from '@/stores/devices';
import {useToastStore} from '@/stores/toast';
import {sendRPC} from '@/tools/websocket';
import Checkbox from '../core/Checkbox.vue';

const props = defineProps<{
    status: any;
    settings: any;
    canExecute: boolean;
    shellyID: string;
}>();

const deviceStore = useDevicesStore();
const toast = useToastStore();

async function setConfig(update: Record<string, any>) {
    try {
        await sendRPC('FLEET_MANAGER', 'BluGw.SetConfig', {
            shellyID: props.shellyID,
            config: update
        });
        toast.success('BLU Gateway updated');
    } catch (err: any) {
        toast.error(err?.message ?? 'Failed to update');
    }
}
</script>

<style scoped>
.et-blugw {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.et-blugw__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-1) 0;
}
.et-blugw__label {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}
</style>
