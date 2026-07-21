<template>
    <div class="cfg-panel knx-panel">
        <form
            v-if="config"
            class="cfg-panel__form"
            autocomplete="off"
            @submit.prevent
        >
            <section
                class="cfg-panel__workspace-section"
                aria-label="KNX settings"
            >
                <div class="cfg-panel__row">
                    <div class="cfg-panel__row-label">
                        <strong>Enable KNX</strong>
                        <span>Connect this device to the KNX installation over IP routing.</span>
                    </div>
                    <CardToggle size="row"
                        v-model="local.enable"
                        aria-label="Enable KNX"
                        @update:model-value="markDirty"
                    />
                </div>

                <div class="cfg-panel__field-grid">
                    <label class="cfg-panel__field" for="knx-ia">
                        <strong>Individual address</strong>
                        <span class="cfg-panel__field-help">
                            Must be unique in the KNX installation.
                        </span>
                        <input
                            id="knx-ia"
                            v-model="local.ia"
                            class="cfg-panel__workspace-input knx-panel__mono"
                            placeholder="1.1.9"
                            spellcheck="false"
                            aria-label="KNX individual address"
                            @input="markDirty"
                        />
                    </label>
                    <label class="cfg-panel__field" for="knx-routing-addr">
                        <strong>Routing multicast address</strong>
                        <span class="cfg-panel__field-help">
                            Multicast address and port as IP:port. The KNX
                            default is 224.0.23.12:3671.
                        </span>
                        <input
                            id="knx-routing-addr"
                            v-model="local.routingAddr"
                            class="cfg-panel__workspace-input knx-panel__mono"
                            placeholder="224.0.23.12:3671"
                            spellcheck="false"
                            aria-label="KNX routing multicast address"
                            @input="markDirty"
                        />
                    </label>
                </div>

                <ConfigPanelFooter
                    label="KNX"
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
            <p>Failed to load KNX configuration.</p>
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
import {useDeviceConfigPanel} from '@/composables/useDeviceConfigPanel';
import CardToggle from '../cards/CardToggle.vue';
import Button from './Button.vue';
import ConfigPanelFooter from './ConfigPanelFooter.vue';

interface KnxConfig {
    enable?: boolean;
    ia?: string;
    routing?: {addr?: string};
}

interface KnxLocalForm {
    enable: boolean;
    ia: string;
    routingAddr: string;
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
    reload,
    refetch,
    refetching
} = useDeviceConfigPanel<KnxConfig, KnxLocalForm>({
    shellyID: () => props.shellyID,
    settingsKey: 'knx',
    method: 'KNX.SetConfig',
    initialLocal: {enable: false, ia: '', routingAddr: ''},
    mapToLocal: (c) => ({
        enable: c.enable ?? false,
        ia: c.ia ?? '',
        routingAddr: c.routing?.addr ?? ''
    }),
    // Empty fields are left out so the device keeps its current values.
    mapToUpdate: (l) => {
        const update: KnxConfig = {enable: l.enable};
        if (l.ia) update.ia = l.ia;
        if (l.routingAddr) update.routing = {addr: l.routingAddr};
        return update;
    },
    successToast: 'KNX configuration saved'
});
</script>

<style scoped>
.knx-panel__mono {
    font-family: var(--font-mono);
}
</style>
