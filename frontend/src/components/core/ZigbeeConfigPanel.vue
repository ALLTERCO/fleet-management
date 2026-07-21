<template>
    <div class="cfg-panel zigbee-panel">
        <form
            v-if="config"
            class="cfg-panel__form"
            autocomplete="off"
            @submit.prevent
        >
            <section
                class="cfg-panel__workspace-section"
                aria-label="Zigbee settings"
            >
                <div class="cfg-panel__toggle-grid">
                    <div class="cfg-panel__toggle">
                        <div class="cfg-panel__toggle-label">
                            <strong>Enable Zigbee</strong>
                        </div>
                        <CardToggle size="row"
                            v-model="local.enable"
                            aria-label="Enable Zigbee"
                            @update:model-value="markDirty"
                        />
                    </div>
                </div>

                <div v-if="networkState" class="cfg-panel__field-grid">
                    <div class="cfg-panel__field">
                        <strong>Network state</strong>
                        <span class="cfg-panel__field-help">
                            Reported by the device.
                        </span>
                        <code class="cfg-panel__readonly-value">
                            {{ networkState }}
                        </code>
                    </div>
                </div>

                <p class="cfg-panel__field-help zigbee-panel__help">
                    Joining a Zigbee network is done from the device web
                    interface.
                </p>

                <ConfigPanelFooter
                    label="Zigbee"
                    :dirty="dirty"
                    :saving="saving"
                    :restart-required="restartRequired"
                    :rebooting="rebooting"
                    :external-changed="externalConfigChanged"
                    @save="save"
                    @reboot="rebootDevice"
                    @refresh="reload"
                />
            </section>
        </form>

        <div v-else-if="refetching" class="cfg-panel__loading">
            Loading configuration…
        </div>
        <div v-else class="cfg-panel__error">
            <p>Failed to load Zigbee configuration.</p>
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
import {computed} from 'vue';
import {useDeviceConfigPanel} from '@/composables/useDeviceConfigPanel';
import {useDevicesStore} from '@/stores/devices';
import Button from './Button.vue';
import ConfigPanelFooter from './ConfigPanelFooter.vue';
import CardToggle from '../cards/CardToggle.vue';

interface ZigbeeConfig {
    enable?: boolean;
}

const props = defineProps<{shellyID: string}>();
const deviceStore = useDevicesStore();

const networkState = computed<string | null>(() => {
    const state =
        deviceStore.devices[props.shellyID]?.status?.zigbee?.network_state;
    return typeof state === 'string' ? state : null;
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
} = useDeviceConfigPanel<ZigbeeConfig, {enable: boolean}>({
    shellyID: () => props.shellyID,
    settingsKey: 'zigbee',
    method: 'Zigbee.SetConfig',
    initialLocal: {enable: false},
    mapToLocal: (c) => ({enable: c.enable ?? false}),
    mapToUpdate: (l) => ({enable: l.enable}),
    successToast: 'Zigbee configuration saved'
});
</script>

<style scoped>
.zigbee-panel__help {
    padding: var(--space-2) var(--space-3) 0;
}
</style>
