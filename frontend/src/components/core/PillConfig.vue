<template>
    <div class="pill-config p-3 rounded-lg space-y-4">
        <div class="flex items-center justify-between">
            <h3 class="heading-card">Pill Configuration</h3>
            <Button v-if="hasChanges" type="blue" size="sm" @click="saveConfig" :disabled="saving">
                <Spinner v-if="saving" class="w-4 h-4" />
                <span v-else>Save</span>
            </Button>
        </div>

        <div v-if="loading" class="flex justify-center py-4">
            <Spinner />
        </div>

        <template v-else-if="config">
            <!-- Peripheral Mode -->
            <div class="space-y-2">
                <label class="pill-config__label text-sm">Peripheral Mode</label>
                <Dropdown
                    :default="localConfig.mode"
                    :options="modeOptions"
                    @selected="(val) => localConfig.mode = val"
                />
                <p class="pill-config__hint text-xs">
                    {{ getModeDescription(localConfig.mode) }}
                </p>
            </div>

            <!-- Pin Configuration (shown for digital_io mode) -->
            <template v-if="localConfig.mode === 'digital_io'">
                <div class="space-y-3">
                    <span class="pill-config__label text-sm">Pin Configuration</span>

                    <div class="flex items-center gap-3">
                        <span class="text-sm w-16">Pin 0</span>
                        <Dropdown
                            :default="localConfig.pin0 || 'none'"
                            :options="pinModeOptions"
                            @selected="(val) => localConfig.pin0 = val"
                        />
                    </div>
                    <div class="flex items-center gap-3">
                        <span class="text-sm w-16">Pin 1</span>
                        <Dropdown
                            :default="localConfig.pin1 || 'none'"
                            :options="pinModeOptions"
                            @selected="(val) => localConfig.pin1 = val"
                        />
                    </div>
                    <div class="flex items-center gap-3">
                        <span class="text-sm w-16">Pin 2</span>
                        <Dropdown
                            :default="localConfig.pin2 || 'none'"
                            :options="pinModeOptions"
                            @selected="(val) => localConfig.pin2 = val"
                        />
                    </div>
                </div>
            </template>

            <!-- Info about discovered entities based on mode -->
            <div class="pill-config__info p-2 rounded text-xs">
                <i class="fas fa-info-circle mr-1"></i>
                <span>{{ getModeEntityInfo(localConfig.mode) }}</span>
            </div>
        </template>

        <div v-else class="pill-config__label text-center">
            <p>Failed to load configuration</p>
            <Button size="sm" class="mt-2" @click="loadConfig">Retry</Button>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, reactive, ref, watch} from 'vue';
import {useDevicesStore} from '@/stores/devices';
import {useToastStore} from '@/stores/toast';
import Button from './Button.vue';
import Dropdown from './Dropdown.vue';
import Spinner from './Spinner.vue';

const props = defineProps<{
    shellyID: string;
}>();

const deviceStore = useDevicesStore();
const toastStore = useToastStore();

const loading = ref(true);
const saving = ref(false);
const config = ref<any>(null);
const localConfig = reactive<{
    mode: string;
    pin0?: string;
    pin1?: string;
    pin2?: string;
}>({
    mode: 'none'
});

const modeOptions = [
    'none',
    'onewire',
    'dht22',
    'digital_io',
    'analog_in',
    'ssr'
];
const pinModeOptions = ['none', 'digital_in', 'digital_out', 'reserved'];

const hasChanges = computed(() => {
    if (!config.value) return false;
    return (
        JSON.stringify({
            mode: localConfig.mode,
            pin0: localConfig.pin0,
            pin1: localConfig.pin1,
            pin2: localConfig.pin2
        }) !==
        JSON.stringify({
            mode: config.value.mode,
            pin0: config.value.pin0,
            pin1: config.value.pin1,
            pin2: config.value.pin2
        })
    );
});

function getModeDescription(mode: string): string {
    const descriptions: Record<string, string> = {
        none: 'Peripheral is disabled',
        onewire: 'DS18B20 temperature sensors (up to 5)',
        dht22: 'DHT22 temperature & humidity sensor',
        digital_io: 'Digital I/O pins for inputs/switches',
        analog_in: 'Analog input (voltmeter)',
        ssr: 'Solid State Relay addon (2 channels)'
    };
    return descriptions[mode] || 'Unknown mode';
}

function getModeEntityInfo(mode: string): string {
    const info: Record<string, string> = {
        none: 'No additional entities will be created',
        onewire: 'Temperature sensors will appear at indexes 200-204',
        dht22: 'Humidity sensor will appear at index 200',
        digital_io:
            'Input/Switch entities will appear at indexes 200-202 based on pin configuration',
        analog_in: 'Voltmeter entity will appear at index 200',
        ssr: 'Relay switch entities will appear. IO3 may also be available.'
    };
    return info[mode] || 'Entity configuration depends on the selected mode';
}

async function loadConfig() {
    loading.value = true;
    try {
        const resp = await deviceStore.sendRPC(
            props.shellyID,
            'Pill.GetConfig',
            {}
        );
        config.value = resp;
        Object.assign(localConfig, {
            mode: resp.mode || 'none',
            pin0: resp.pin0 || 'none',
            pin1: resp.pin1 || 'none',
            pin2: resp.pin2 || 'none'
        });
    } catch (error) {
        console.error('Failed to load Pill config:', error);
        config.value = null;
    } finally {
        loading.value = false;
    }
}

async function saveConfig() {
    saving.value = true;
    try {
        const newConfig: any = {mode: localConfig.mode};

        if (localConfig.mode === 'digital_io') {
            newConfig.pin0 = localConfig.pin0;
            newConfig.pin1 = localConfig.pin1;
            newConfig.pin2 = localConfig.pin2;
        }

        await deviceStore.sendRPC(props.shellyID, 'Pill.SetConfig', {
            config: newConfig
        });
        toastStore.success('Pill configuration saved');

        // Reload to get updated values
        await loadConfig();
    } catch (error) {
        console.error('Failed to save Pill config:', error);
        toastStore.error('Failed to save Pill configuration');
    } finally {
        saving.value = false;
    }
}

onMounted(() => {
    loadConfig();
});

watch(
    () => props.shellyID,
    () => {
        loadConfig();
    }
);
</script>

<style scoped>
.pill-config {
    background-color: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
}
.pill-config__label {
    color: var(--color-text-tertiary);
}
.pill-config__hint {
    color: var(--color-text-disabled);
}
.pill-config__info {
    background-color: var(--color-surface-3);
    color: var(--color-text-secondary);
}
</style>
