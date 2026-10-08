<template>
    <Modal :visible="visible" large tall @close="emit('close')">
        <template #title>
            <ModalHeader title="Dashboard settings" description="Environment" />
        </template>

        <template #default>
            <div class="envs-body">
                <ModalTabRail
                    v-model="tab"
                    :tabs="TABS"
                    aria-label="Environment settings sections"
                />

                <div class="envs-panel">
                    <section v-show="tab === 'comfort'" class="envs-stack">
                        <div class="envs-row">
                            <FormField label="Temp min °C">
                                <input v-model.number="form.tempComfortMin" :class="INPUT_CLASS" type="number" step="0.5" />
                            </FormField>
                            <FormField label="Temp max °C">
                                <input v-model.number="form.tempComfortMax" :class="INPUT_CLASS" type="number" step="0.5" />
                            </FormField>
                        </div>
                        <div class="envs-row">
                            <FormField label="Humidity min %">
                                <input v-model.number="form.humidityComfortMin" :class="INPUT_CLASS" type="number" />
                            </FormField>
                            <FormField label="Humidity max %">
                                <input v-model.number="form.humidityComfortMax" :class="INPUT_CLASS" type="number" />
                            </FormField>
                        </div>
                        <FormField label="Mold-risk humidity %">
                            <input v-model.number="form.moldHumidityThreshold" :class="INPUT_CLASS" type="number" />
                        </FormField>
                    </section>

                    <section v-show="tab === 'air'" class="envs-stack">
                        <div class="envs-row">
                            <FormField label="CO₂ fair ppm">
                                <input v-model.number="form.co2FairPpm" :class="INPUT_CLASS" type="number" />
                            </FormField>
                            <FormField label="CO₂ poor ppm">
                                <input v-model.number="form.co2PoorPpm" :class="INPUT_CLASS" type="number" />
                            </FormField>
                        </div>
                        <div class="envs-row">
                            <FormField label="PM2.5 fair">
                                <input v-model.number="form.pm25FairUgm3" :class="INPUT_CLASS" type="number" />
                            </FormField>
                            <FormField label="PM2.5 poor">
                                <input v-model.number="form.pm25PoorUgm3" :class="INPUT_CLASS" type="number" />
                            </FormField>
                        </div>
                    </section>

                    <section v-show="tab === 'light'" class="envs-stack">
                        <FormField label="Daylight threshold lux">
                            <input v-model.number="form.daylightLux" :class="INPUT_CLASS" type="number" />
                        </FormField>
                    </section>
                </div>
            </div>
        </template>

        <template #footer>
            <ModalFooter>
                <template #secondary>
                    <Button type="blue-hollow" @click="emit('close')">Cancel</Button>
                </template>
                <template #primary>
                    <Button type="blue" @click="onSave">Save</Button>
                </template>
            </ModalFooter>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import {reactive, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import FormField from '@/components/core/FormField.vue';
import ModalFooter from '@/components/core/ModalFooter.vue';
import ModalHeader from '@/components/core/ModalHeader.vue';
import ModalTabRail, {type TabRailItem} from '@/components/core/ModalTabRail.vue';
import Modal from '@/components/modals/Modal.vue';
import {
    DEFAULT_ENV_SETTINGS,
    type EnvSettings
} from './environmentDashboard.types';

const props = defineProps<{visible: boolean; settings: EnvSettings}>();
const emit = defineEmits<{close: []; save: [settings: EnvSettings]}>();

// The shared Input atom renders exactly these classes; native number inputs
// reuse them so every field in the modal looks identical.
const INPUT_CLASS = 'core-input border text-base rounded-lg block w-full p-2';

const TABS: TabRailItem[] = [
    {key: 'comfort', label: 'Comfort', icon: 'fa-temperature-half'},
    {key: 'air', label: 'Air quality', icon: 'fa-wind'},
    {key: 'light', label: 'Light', icon: 'fa-sun'}
];
const tab = ref('comfort');

const form = reactive<EnvSettings>({...props.settings});

// Re-seed on open so a cancelled edit is discarded.
watch(
    () => props.visible,
    (open) => {
        if (open) Object.assign(form, props.settings);
    }
);

// Empty inputs yield NaN; fall back to the default per field.
function sanitized(): EnvSettings {
    const out = {} as EnvSettings;
    for (const key of Object.keys(DEFAULT_ENV_SETTINGS) as (keyof EnvSettings)[]) {
        out[key] = Number.isFinite(form[key]) ? form[key] : DEFAULT_ENV_SETTINGS[key];
    }
    return out;
}

function onSave() {
    emit('save', sanitized());
}
</script>

<style scoped>
.envs-body {
    display: grid;
    grid-template-columns: var(--form-tab-rail-width) minmax(0, 1fr);
    gap: var(--gap-md);
    align-items: start;
}

.envs-panel {
    min-width: 0;
}

.envs-stack {
    display: flex;
    flex-direction: column;
    gap: var(--gap-md);
}

.envs-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--gap-sm);
    align-items: start;
}

@media (max-width: 900px) {
    .envs-body {
        grid-template-columns: 1fr;
    }
}

@media (max-width: 640px) {
    .envs-row {
        grid-template-columns: 1fr;
    }
}
</style>
