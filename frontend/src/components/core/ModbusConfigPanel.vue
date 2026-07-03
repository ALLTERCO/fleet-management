<template>
    <div class="cfg-panel">
        <form v-if="config" @submit.prevent autocomplete="off">
            <div class="cfg-panel__row">
                <div class="cfg-panel__row-label">
                    <strong>Enable Modbus TCP</strong>
                    <span>Allow third-party Modbus clients on the local network</span>
                </div>
                <Checkbox v-model="local.enable" @update:model-value="markDirty" />
            </div>

            <div v-if="dirty" class="cfg-panel__footer">
                <Button type="blue" size="sm" :loading="saving" @click="save">
                    Save
                </Button>
            </div>
        </form>

        <div v-else class="cfg-panel__error">
            <p>Failed to load Modbus configuration.</p>
            <Button type="blue-hollow" size="sm" @click="reload">Retry</Button>
        </div>
    </div>
</template>

<script setup lang="ts">
import {useDeviceConfigPanel} from '@/composables/useDeviceConfigPanel';
import Button from './Button.vue';
import Checkbox from './Checkbox.vue';

interface ModbusConfig {
    enable?: boolean;
}

const props = defineProps<{shellyID: string}>();

const {config, local, dirty, saving, markDirty, save, reload} =
    useDeviceConfigPanel<ModbusConfig, {enable: boolean}>({
        shellyID: () => props.shellyID,
        settingsKey: 'modbus',
        method: 'Modbus.SetConfig',
        initialLocal: {enable: false},
        mapToLocal: (c) => ({enable: c.enable ?? false}),
        mapToUpdate: (l) => ({enable: l.enable}),
        successToast: 'Modbus configuration saved'
    });
</script>
