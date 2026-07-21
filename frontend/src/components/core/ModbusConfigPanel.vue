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
                        <strong>Enable Modbus TCP</strong>
                        <span>Allow third-party Modbus clients on the local network</span>
                    </div>
                    <div class="cfg-panel__control">
                        <CardToggle size="row"
                            v-model="local.enable"
                            aria-label="Enable Modbus TCP"
                            @update:model-value="markDirty"
                        />
                    </div>
                </div>

            </section>

            <ConfigPanelFooter
                label="Modbus"
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
            <p>Failed to load Modbus configuration.</p>
            <Button type="blue-hollow" size="sm" :loading="refetching" @click="refetch">Retry</Button>
        </div>
    </div>
</template>

<script setup lang="ts">
import {useDeviceConfigPanel} from '@/composables/useDeviceConfigPanel';
import Button from './Button.vue';
import ConfigPanelFooter from './ConfigPanelFooter.vue';
import CardToggle from '../cards/CardToggle.vue';

interface ModbusConfig {
    enable?: boolean;
}

const props = defineProps<{shellyID: string}>();

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
} = useDeviceConfigPanel<ModbusConfig, {enable: boolean}>({
        shellyID: () => props.shellyID,
        settingsKey: 'modbus',
        method: 'Modbus.SetConfig',
        initialLocal: {enable: false},
        mapToLocal: (c) => ({enable: c.enable ?? false}),
        mapToUpdate: (l) => ({enable: l.enable}),
        successToast: 'Modbus configuration saved'
    });
</script>
