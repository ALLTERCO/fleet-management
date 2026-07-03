<template>
    <Modal :visible="visible" wide @close="emit('close')">
        <template #title>Deploy Configuration</template>
        <template #default>
            <!-- Review phase -->
            <div v-if="phase === 'review'" class="cd">
                <div class="cd-summary">
                    <div class="cd-summary__item">
                        <i class="fas fa-file-lines cd-summary__icon" />
                        <span class="cd-summary__label">Config</span>
                        <span class="cd-summary__value">{{ configName }}</span>
                    </div>
                    <div class="cd-summary__item">
                        <i class="fas fa-layer-group cd-summary__icon" />
                        <span class="cd-summary__label">Groups</span>
                        <span class="cd-summary__value">{{ groups.length }}</span>
                    </div>
                    <div class="cd-summary__item">
                        <i class="fas fa-hard-drive cd-summary__icon" />
                        <span class="cd-summary__label">Devices</span>
                        <span class="cd-summary__value">{{ totalDevices }}</span>
                    </div>
                </div>

                <div class="cd-groups">
                    <div v-for="group in groups" :key="group.id" class="cd-group">
                        <i class="fas fa-folder cd-group__icon" />
                        <span class="cd-group__name">{{ group.name }}</span>
                        <span class="cd-group__count">{{ group.deviceCount }} devices</span>
                    </div>
                </div>

                <div class="cd-settings">
                    <div class="cd-settings__title">Settings to push</div>
                    <div class="cd-settings__grid">
                        <div v-for="[section, values] in configSections" :key="section" class="cd-settings__item">
                            <span class="cd-settings__key">{{ section }}</span>
                            <span class="cd-settings__val">{{ typeof values === 'object' ? (values as any)?.enable != null ? ((values as any).enable ? 'Enabled' : 'Disabled') : Object.keys(values as object).length + ' fields' : String(values) }}</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Deploying phase -->
            <div v-else-if="phase === 'deploying'" class="cd cd-deploying">
                <Spinner size="md" />
                <span class="cd-deploying__text">Deploying to {{ totalDevices }} devices… ({{ completedCount }}/{{ totalDevices }})</span>
                <div class="cd-progress">
                    <div class="cd-progress__bar" :style="{width: progressPercent + '%'}" />
                </div>
            </div>

            <!-- Results phase -->
            <div v-else class="cd">
                <div class="cd-results-summary">
                    <span class="cd-results-stat cd-results-stat--ok"><i class="fas fa-check" /> {{ okCount }} OK</span>
                    <span v-if="failCount > 0" class="cd-results-stat cd-results-stat--fail"><i class="fas fa-xmark" /> {{ failCount }} Failed</span>
                </div>
                <div class="cd-results">
                    <div v-for="[deviceId, status] in Object.entries(results)" :key="deviceId" class="cd-result" :class="{'cd-result--fail': status === 'error'}">
                        <i :class="status === 'ok' ? 'fas fa-check-circle cd-ok' : 'fas fa-times-circle cd-fail'" />
                        <span class="cd-result__id">{{ deviceId }}</span>
                        <span class="cd-result__status">{{ status === 'ok' ? 'Success' : 'Failed' }}</span>
                    </div>
                </div>
            </div>
        </template>
        <template #footer>
            <div class="cd-footer">
                <Button v-if="phase === 'review'" type="blue-hollow" @click="emit('close')">Cancel</Button>
                <Button v-if="phase === 'review'" type="green" @click="startDeploy">Deploy to {{ totalDevices }} devices</Button>
                <Button v-if="phase === 'results' && failCount > 0" type="blue-hollow" @click="retryFailed">Retry failed ({{ failCount }})</Button>
                <Button v-if="phase === 'results'" type="blue-hollow" @click="emit('close')">Close</Button>
            </div>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import Spinner from '@/components/core/Spinner.vue';
import {
    fetchActionVariables,
    substituteVariablesSync
} from '@/helpers/substituteVariables';
import {sendRPC} from '@/tools/websocket';
import Modal from './Modal.vue';

const props = defineProps<{
    visible: boolean;
    configName: string;
    config: Record<string, any>;
    groups: Array<{
        id: number;
        name: string;
        deviceCount: number;
        devices: string[];
    }>;
}>();

const emit = defineEmits<{close: []}>();

const phase = ref<'review' | 'deploying' | 'results'>('review');
const results = ref<Record<string, 'ok' | 'error'>>({});
const completedCount = ref(0);
let resolvedConfig: Record<string, any> = {};

const totalDevices = computed(() =>
    props.groups.reduce((sum, g) => sum + g.devices.length, 0)
);
const allDevices = computed(() => props.groups.flatMap((g) => g.devices));
const configSections = computed(() =>
    Object.entries(props.config).filter(([k]) => k !== 'name' && k !== '__meta')
);

const okCount = computed(
    () => Object.values(results.value).filter((s) => s === 'ok').length
);
const failCount = computed(
    () => Object.values(results.value).filter((s) => s === 'error').length
);
const progressPercent = computed(() =>
    totalDevices.value
        ? Math.round((completedCount.value / totalDevices.value) * 100)
        : 0
);

// Map config keys to Shelly RPC component names (PascalCase)
// Map config keys to Shelly RPC component names
// Why no sys_led: LED config needs special Sys.SetConfig params, handled separately
const RPC_COMPONENT_MAP: Record<string, string> = {
    sys: 'Sys',
    wifi: 'WiFi',
    ws: 'WS',
    mqtt: 'Mqtt',
    bluetooth: 'BLE',
    switch: 'Switch',
    cover: 'Cover',
    input: 'Input',
    light: 'Light'
};

async function deployToDevice(
    shellyID: string,
    config: Record<string, any>
): Promise<'ok' | 'error'> {
    const sections = Object.entries(config).filter(
        ([k]) => k !== 'name' && k !== '__meta' && RPC_COMPONENT_MAP[k]
    );
    try {
        for (const [key, settings] of sections) {
            const component = RPC_COMPONENT_MAP[key];
            await sendRPC('FLEET_MANAGER', 'Device.Call', {
                shellyID,
                method: `${component}.SetConfig`,
                params: {config: settings}
            });
        }
        return 'ok';
    } catch {
        return 'error';
    }
}

async function startDeploy() {
    phase.value = 'deploying';
    results.value = {};
    completedCount.value = 0;

    // Substitute ${VAR} references before deploying
    const vars = await fetchActionVariables();
    resolvedConfig = substituteVariablesSync(props.config, vars);

    const devices = allDevices.value;
    const promises = devices.map(async (shellyID) => {
        const status = await deployToDevice(shellyID, resolvedConfig);
        results.value[shellyID] = status;
        completedCount.value++;
    });

    await Promise.allSettled(promises);
    phase.value = 'results';
}

async function retryFailed() {
    const failed = Object.entries(results.value)
        .filter(([, s]) => s === 'error')
        .map(([id]) => id);
    phase.value = 'deploying';
    completedCount.value = totalDevices.value - failed.length;

    const promises = failed.map(async (shellyID) => {
        const status = await deployToDevice(shellyID, resolvedConfig);
        results.value[shellyID] = status;
        completedCount.value++;
    });

    await Promise.allSettled(promises);
    phase.value = 'results';
}

// Reset on open
watch(
    () => props.visible,
    (v) => {
        if (v) {
            phase.value = 'review';
            results.value = {};
            completedCount.value = 0;
        }
    }
);
</script>

<style scoped>
.cd { display: flex; flex-direction: column; gap: var(--gap-sm); }

/* Summary strip */
.cd-summary { display: flex; gap: var(--gap-md); }
.cd-summary__item { display: flex; align-items: center; gap: var(--gap-xs); }
.cd-summary__icon { color: var(--color-text-tertiary); }
.cd-summary__label { font-size: var(--type-body); color: var(--color-text-tertiary); }
.cd-summary__value { font-size: var(--type-body); font-weight: 700; color: var(--color-text-primary); }

/* Groups list */
.cd-groups { display: flex; flex-direction: column; gap: var(--gap-xs); }
.cd-group {
    display: flex; align-items: center; gap: var(--gap-xs);
    padding: var(--gap-xs) var(--gap-sm); border-radius: var(--radius-md);
    background: var(--color-surface-2); border: 1px solid var(--color-border-default);
}
.cd-group__icon { color: var(--color-text-tertiary); }
.cd-group__name { flex: 1; font-size: var(--type-body); font-weight: 600; color: var(--color-text-primary); }
.cd-group__count { font-size: var(--type-body); color: var(--color-text-quaternary); }

/* Settings preview */
.cd-settings__title { font-size: var(--type-body); font-weight: 700; color: var(--color-text-secondary); }
.cd-settings__grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--gap-xs); }
.cd-settings__item { display: flex; justify-content: space-between; padding: var(--gap-xs); border-radius: var(--radius-sm); background: var(--color-surface-1); }
.cd-settings__key { font-size: var(--type-body); font-weight: 600; color: var(--color-text-secondary); text-transform: capitalize; }
.cd-settings__val { font-size: var(--type-body); color: var(--color-text-primary); font-family: var(--font-mono); }

/* Deploying */
.cd-deploying { align-items: center; justify-content: center; padding: var(--gap-lg); }
.cd-deploying__text { font-size: var(--type-body); color: var(--color-text-secondary); }
.cd-progress { width: 100%; height: var(--gap-xs); border-radius: var(--radius-full); background: var(--color-surface-3); overflow: hidden; }
.cd-progress__bar { height: 100%; background: var(--color-primary); border-radius: var(--radius-full); transition: width 0.3s; }

/* Results */
.cd-results-summary { display: flex; gap: var(--gap-sm); }
.cd-results-stat { font-size: var(--type-body); font-weight: 700; display: flex; align-items: center; gap: var(--gap-xs); }
.cd-results-stat--ok { color: var(--color-status-on); }
.cd-results-stat--fail { color: var(--color-status-off); }
.cd-results { display: flex; flex-direction: column; gap: var(--gap-xs); max-height: 300px; overflow-y: auto; }
.cd-result { display: flex; align-items: center; gap: var(--gap-xs); padding: var(--gap-xs) var(--gap-sm); border-radius: var(--radius-sm); }
.cd-result--fail { background: color-mix(in srgb, var(--color-status-off) 6%, transparent); }
.cd-result__id { flex: 1; font-size: var(--type-body); font-family: var(--font-mono); color: var(--color-text-primary); }
.cd-result__status { font-size: var(--type-body); font-weight: 600; }
.cd-ok { color: var(--color-status-on); }
.cd-fail { color: var(--color-status-off); }

/* Footer */
.cd-footer { display: flex; justify-content: flex-end; gap: var(--gap-sm); }
</style>
