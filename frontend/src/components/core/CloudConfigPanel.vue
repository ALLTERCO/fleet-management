<template>
    <div class="cfg-panel">
        <div class="cfg-panel__status-row">
            <span
                class="cfg-panel__status"
                :class="cloudConnected
                    ? 'cfg-panel__status--on'
                    : 'cfg-panel__status--off'"
            >
                {{ cloudConnected ? 'Connected' : 'Disconnected' }}
            </span>
        </div>

        <form v-if="config" @submit.prevent autocomplete="off">
            <div class="cfg-panel__row">
                <div class="cfg-panel__row-label">
                    <strong>Enable Shelly Cloud</strong>
                    <span>Connection to Shelly Cloud for remote control</span>
                </div>
                <Checkbox v-model="local.enable" @update:model-value="markDirty" />
            </div>

            <div v-if="config.server" class="cfg-panel__row">
                <div class="cfg-panel__row-label">
                    <strong>Server</strong>
                    <span>Read-only — provisioned by firmware</span>
                </div>
                <code class="cloud-panel__server">{{ config.server }}</code>
            </div>

            <div v-if="dirty" class="cfg-panel__footer">
                <Button type="blue" size="sm" :loading="saving" @click="save">
                    Save
                </Button>
            </div>
        </form>

        <div v-else class="cfg-panel__error">
            <p>Failed to load Cloud configuration.</p>
            <Button type="blue-hollow" size="sm" @click="reload">Retry</Button>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {useDeviceConfigPanel} from '@/composables/useDeviceConfigPanel';
import {useDevicesStore} from '@/stores/devices';
import Button from './Button.vue';
import Checkbox from './Checkbox.vue';

interface CloudConfig {
    enable?: boolean;
    server?: string;
}

const props = defineProps<{shellyID: string}>();
const deviceStore = useDevicesStore();

const {config, local, dirty, saving, markDirty, save, reload} =
    useDeviceConfigPanel<CloudConfig, {enable: boolean}>({
        shellyID: () => props.shellyID,
        settingsKey: 'cloud',
        method: 'Cloud.SetConfig',
        initialLocal: {enable: false},
        mapToLocal: (c) => ({enable: c.enable ?? false}),
        mapToUpdate: (l) => ({enable: l.enable}),
        successToast: 'Cloud configuration saved'
    });

const cloudConnected = computed(
    () => deviceStore.devices[props.shellyID]?.status?.cloud?.connected === true
);
</script>

<style scoped>
.cloud-panel__server {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    word-break: break-all;
    text-align: right;
}
</style>
