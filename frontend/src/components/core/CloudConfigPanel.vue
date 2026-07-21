<template>
    <div class="cfg-panel cloud-panel">
        <form
            v-if="config"
            class="cfg-panel__form"
            @submit.prevent
            autocomplete="off"
        >
            <section class="cfg-panel__workspace-section" aria-label="Cloud settings">
                <div class="cfg-panel__toggle-grid">
                    <div class="cfg-panel__toggle">
                        <div class="cfg-panel__toggle-label">
                            <strong>Enable Shelly Cloud</strong>
                        </div>
                        <CardToggle size="row"
                            v-model="local.enable"
                            aria-label="Enable Shelly Cloud"
                            @update:model-value="markDirty"
                        />
                    </div>
                </div>

                <div v-if="config.server" class="cfg-panel__field-grid">
                    <div class="cfg-panel__field cfg-panel__field--wide">
                        <strong>Server</strong>
                        <code class="cfg-panel__readonly-value cloud-panel__server">{{ config.server }}</code>
                    </div>
                </div>

                <ConfigPanelFooter
                    label="Cloud"
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
            <p>Failed to load Cloud configuration.</p>
            <Button type="blue-hollow" size="sm" :loading="refetching" @click="refetch">Retry</Button>
        </div>
    </div>
</template>

<script setup lang="ts">
import {useDeviceConfigPanel} from '@/composables/useDeviceConfigPanel';
import CardToggle from '../cards/CardToggle.vue';
import Button from './Button.vue';
import ConfigPanelFooter from './ConfigPanelFooter.vue';

interface CloudConfig {
    enable?: boolean;
    server?: string;
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
} = useDeviceConfigPanel<CloudConfig, {enable: boolean}>({
        shellyID: () => props.shellyID,
        settingsKey: 'cloud',
        method: 'Cloud.SetConfig',
        initialLocal: {enable: false},
        mapToLocal: (c) => ({enable: c.enable ?? false}),
        mapToUpdate: (l) => ({enable: l.enable}),
        successToast: 'Cloud configuration saved'
    });

</script>

<style scoped>
.cloud-panel__server {
    font-family: var(--font-mono);
}
</style>
