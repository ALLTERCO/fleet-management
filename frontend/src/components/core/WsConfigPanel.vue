<template>
    <div class="cfg-panel ws-panel">
        <form
            v-if="config"
            class="cfg-panel__form"
            autocomplete="off"
            @submit.prevent
        >
            <section class="cfg-panel__workspace-section" aria-label="WebSocket settings">
                <div class="cfg-panel__toggle-grid">
                    <div class="cfg-panel__toggle">
                        <div class="cfg-panel__toggle-label">
                            <strong>Enable outbound WebSocket</strong>
                        </div>
                        <CardToggle size="row"
                            v-model="local.enable"
                            aria-label="Enable outbound WebSocket"
                            @update:model-value="markDirty"
                        />
                    </div>
                </div>

                <div class="cfg-panel__field-grid">
                    <label class="cfg-panel__field cfg-panel__field--wide" for="ws-server">
                        <strong>Server</strong>
                        <input
                            id="ws-server"
                            v-model="local.server"
                            class="cfg-panel__workspace-input ws-panel__input"
                            placeholder="wss://example.com/shelly"
                            @input="markDirty"
                        />
                    </label>
                    <div class="cfg-panel__field cfg-panel__field--wide">
                        <strong>Certificate validation</strong>
                        <Dropdown
                            aria-label="WebSocket certificate validation"
                            :default="tlsLabel(local.ssl_ca)"
                            :options="tlsOptions"
                            @selected="setTlsMode"
                        />
                    </div>
                </div>

                <p class="cfg-panel__notice">
                    Changing this connection can make the device unreachable.
                </p>

                <ConfigPanelFooter
                    label="WebSocket"
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
            <p>Failed to load outbound WebSocket configuration.</p>
            <Button type="blue-hollow" size="sm" :loading="refetching" @click="refetch">Retry</Button>
        </div>
    </div>
</template>

<script setup lang="ts">
import {useDeviceConfigPanel} from '@/composables/useDeviceConfigPanel';
import Button from './Button.vue';
import ConfigPanelFooter from './ConfigPanelFooter.vue';
import Dropdown from './Dropdown.vue';
import CardToggle from '../cards/CardToggle.vue';

interface WsConfig {
    enable?: boolean;
    server?: string | null;
    ssl_ca?: string;
}

const props = defineProps<{shellyID: string}>();

const tlsModes: Record<string, string> = {
    '': 'No TLS',
    '*': 'Validation disabled',
    'ca.pem': 'Built-in CA bundle',
    'user_ca.pem': 'User-provided CA'
};
const tlsOptions = Object.values(tlsModes);

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
} = useDeviceConfigPanel<
    WsConfig,
    {enable: boolean; server: string; ssl_ca: string}
>({
    shellyID: () => props.shellyID,
    settingsKey: 'ws',
    method: 'WS.SetConfig',
    initialLocal: {enable: false, server: '', ssl_ca: ''},
    mapToLocal: (value) => ({
        enable: value.enable ?? false,
        server: value.server ?? '',
        ssl_ca: value.ssl_ca ?? ''
    }),
    mapToUpdate: (value) => ({
        enable: value.enable,
        server: value.server || null,
        ssl_ca: value.ssl_ca || ''
    }),
    successToast: 'WebSocket configuration saved'
});

function tlsLabel(value?: string): string {
    return tlsModes[value ?? ''] ?? tlsModes[''];
}

function setTlsMode(label: string): void {
    local.ssl_ca =
        Object.entries(tlsModes).find(([, value]) => value === label)?.[0] ?? '';
    markDirty();
}
</script>
