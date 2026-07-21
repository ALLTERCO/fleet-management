<template>
    <div class="cfg-panel sys-panel">
        <form
            v-if="config"
            class="cfg-panel__form"
            autocomplete="off"
            @submit.prevent
        >
            <section
                class="cfg-panel__workspace-section"
                aria-labelledby="sys-power-title"
            >
                <h5 id="sys-power-title" class="cfg-panel__section-title">
                    Power
                </h5>
                <div class="cfg-panel__row">
                    <div class="cfg-panel__row-label">
                        <strong>Eco mode</strong>
                        <span>Lower power use. Commands may respond a little slower.</span>
                    </div>
                    <CardToggle size="row"
                        v-model="local.ecoMode"
                        aria-label="Enable eco mode"
                        @update:model-value="markDirty"
                    />
                </div>
            </section>

            <section
                class="cfg-panel__workspace-section"
                aria-labelledby="sys-time-title"
            >
                <h5 id="sys-time-title" class="cfg-panel__section-title">
                    Time and location
                </h5>
                <div class="cfg-panel__field-grid">
                    <label class="cfg-panel__field" for="sys-timezone">
                        <strong>Timezone</strong>
                        <input
                            id="sys-timezone"
                            v-model="local.tz"
                            class="cfg-panel__workspace-input"
                            list="sys-timezones"
                            placeholder="Europe/Sofia"
                            spellcheck="false"
                            @input="markDirty"
                        />
                        <datalist id="sys-timezones">
                            <option
                                v-for="zone in timezones"
                                :key="zone"
                                :value="zone"
                            />
                        </datalist>
                    </label>
                    <div class="cfg-panel__field">
                        <strong>Detect automatically</strong>
                        <span class="cfg-panel__field-help">
                            Asks the device to find its timezone from the
                            network.
                        </span>
                        <Button
                            type="blue-hollow"
                            size="sm"
                            :loading="detecting"
                            @click="detectLocation"
                        >
                            Detect timezone
                        </Button>
                    </div>
                    <label class="cfg-panel__field" for="sys-sntp">
                        <strong>Time server (SNTP)</strong>
                        <input
                            id="sys-sntp"
                            v-model="local.sntpServer"
                            class="cfg-panel__workspace-input"
                            placeholder="time.google.com"
                            spellcheck="false"
                            @input="markDirty"
                        />
                    </label>
                </div>
            </section>

            <section
                class="cfg-panel__section cfg-panel__section--disclosure"
                aria-label="Debug logs"
            >
                <Collapse class="cfg-panel__disclosure" title="Advanced settings">
                <div class="cfg-panel__toggle-grid">
                    <div class="cfg-panel__toggle">
                        <div class="cfg-panel__toggle-label">
                            <strong>Debug over MQTT</strong>
                        </div>
                        <CardToggle size="row"
                            v-model="local.debugMqtt"
                            aria-label="Stream debug logs over MQTT"
                            @update:model-value="markDirty"
                        />
                    </div>
                    <div class="cfg-panel__toggle">
                        <div class="cfg-panel__toggle-label">
                            <strong>Debug over WebSocket</strong>
                        </div>
                        <CardToggle size="row"
                            v-model="local.debugWebsocket"
                            aria-label="Stream debug logs over WebSocket"
                            @update:model-value="markDirty"
                        />
                    </div>
                </div>
                <div class="cfg-panel__field-grid">
                    <label
                        class="cfg-panel__field cfg-panel__field--wide"
                        for="sys-debug-udp"
                    >
                        <strong>Debug UDP address</strong>
                        <span class="cfg-panel__field-help">
                            Streams device logs to this address. Leave empty to
                            turn off.
                        </span>
                        <input
                            id="sys-debug-udp"
                            v-model="local.debugUdp"
                            class="cfg-panel__workspace-input sys-panel__mono"
                            placeholder="192.168.1.10:9999"
                            spellcheck="false"
                            @input="markDirty"
                        />
                    </label>
                </div>
                </Collapse>
            </section>

            <ConfigPanelFooter
                label="system"
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
            <p>Failed to load system configuration.</p>
            <Button type="blue-hollow" size="sm" :loading="refetching" @click="refetch">Retry</Button>
        </div>
    </div>
</template>

<script setup lang="ts">
import {ref} from 'vue';
import {useDeviceConfigPanel} from '@/composables/useDeviceConfigPanel';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {useToastStore} from '@/stores/toast';
import {sendRPC} from '@/tools/websocket';
import CardToggle from '../cards/CardToggle.vue';
import Button from './Button.vue';
import Collapse from './Collapse.vue';
import ConfigPanelFooter from './ConfigPanelFooter.vue';

interface SysConfig {
    device?: {eco_mode?: boolean};
    location?: {tz?: string | null; lat?: number | null; lon?: number | null};
    sntp?: {server?: string};
    debug?: {
        mqtt?: {enable?: boolean};
        websocket?: {enable?: boolean};
        udp?: {addr?: string | null};
    };
}

interface SysLocalForm {
    ecoMode: boolean;
    tz: string;
    sntpServer: string;
    debugMqtt: boolean;
    debugWebsocket: boolean;
    debugUdp: string;
}

const props = defineProps<{shellyID: string}>();
const toast = useToastStore();
const detecting = ref(false);

// IANA zones from the browser — the device accepts any valid tz string.
const timezones: string[] =
    typeof Intl.supportedValuesOf === 'function'
        ? Intl.supportedValuesOf('timeZone')
        : [];

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
} = useDeviceConfigPanel<SysConfig, SysLocalForm>({
    shellyID: () => props.shellyID,
    settingsKey: 'sys',
    method: 'Sys.SetConfig',
    initialLocal: {
        ecoMode: false,
        tz: '',
        sntpServer: '',
        debugMqtt: false,
        debugWebsocket: false,
        debugUdp: ''
    },
    mapToLocal: (c) => ({
        ecoMode: c.device?.eco_mode ?? false,
        tz: c.location?.tz ?? '',
        sntpServer: c.sntp?.server ?? '',
        debugMqtt: c.debug?.mqtt?.enable ?? false,
        debugWebsocket: c.debug?.websocket?.enable ?? false,
        debugUdp: c.debug?.udp?.addr ?? ''
    }),
    mapToUpdate: (l) => {
        const update: SysConfig = {
            device: {eco_mode: l.ecoMode},
            location: {tz: l.tz || null},
            debug: {
                mqtt: {enable: l.debugMqtt},
                websocket: {enable: l.debugWebsocket},
                udp: {addr: l.debugUdp || null}
            }
        };
        if (l.sntpServer) update.sntp = {server: l.sntpServer};
        return update;
    },
    successToast: 'System configuration saved'
});

async function detectLocation(): Promise<void> {
    detecting.value = true;
    try {
        const response = await sendRPC<{tz?: string | null}>(
            'FLEET_MANAGER',
            'Shelly.DetectLocation',
            {shellyID: props.shellyID}
        );
        if (response?.tz) {
            local.tz = response.tz;
            markDirty();
            toast.success(`Detected timezone: ${response.tz}`);
        } else {
            toast.info('The device could not detect its timezone.');
        }
    } catch (err: unknown) {
        toast.error(rpcErrorMessage(err));
    } finally {
        detecting.value = false;
    }
}
</script>

<style scoped>

.sys-panel__mono {
    font-family: var(--font-mono);
}
</style>
