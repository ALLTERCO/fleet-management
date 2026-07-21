<template>
    <div class="mov" :class="{on: visible}" @click.self="emit('close')">
        <div class="modal" role="dialog" aria-modal="true">
            <div class="mhd">
                <div><h3>Dashboard settings</h3><p class="msub">Environment</p></div>
                <button type="button" class="mx" aria-label="Close" @click="emit('close')">✕</button>
            </div>

            <div class="mbody">
                <nav class="mrail">
                    <button
                        v-for="t in TABS"
                        :key="t.key"
                        type="button"
                        class="mtab"
                        :class="{on: tab === t.key}"
                        @click="tab = t.key"
                    >
                        {{ t.label }}
                    </button>
                </nav>

                <div class="mpanel">
                    <div class="mview" :class="{on: tab === 'comfort'}">
                        <div class="frow">
                            <div class="field">
                                <div class="fl">Temp min °C</div>
                                <input v-model.number="form.tempComfortMin" type="number" step="0.5" />
                            </div>
                            <div class="field">
                                <div class="fl">Temp max °C</div>
                                <input v-model.number="form.tempComfortMax" type="number" step="0.5" />
                            </div>
                        </div>
                        <div class="frow">
                            <div class="field">
                                <div class="fl">Humidity min %</div>
                                <input v-model.number="form.humidityComfortMin" type="number" />
                            </div>
                            <div class="field">
                                <div class="fl">Humidity max %</div>
                                <input v-model.number="form.humidityComfortMax" type="number" />
                            </div>
                        </div>
                        <div class="field">
                            <div class="fl">Mold-risk humidity %</div>
                            <input v-model.number="form.moldHumidityThreshold" type="number" />
                        </div>
                    </div>

                    <div class="mview" :class="{on: tab === 'air'}">
                        <div class="frow">
                            <div class="field">
                                <div class="fl">CO₂ fair ppm</div>
                                <input v-model.number="form.co2FairPpm" type="number" />
                            </div>
                            <div class="field">
                                <div class="fl">CO₂ poor ppm</div>
                                <input v-model.number="form.co2PoorPpm" type="number" />
                            </div>
                        </div>
                        <div class="frow">
                            <div class="field">
                                <div class="fl">PM2.5 fair</div>
                                <input v-model.number="form.pm25FairUgm3" type="number" />
                            </div>
                            <div class="field">
                                <div class="fl">PM2.5 poor</div>
                                <input v-model.number="form.pm25PoorUgm3" type="number" />
                            </div>
                        </div>
                    </div>

                    <div class="mview" :class="{on: tab === 'light'}">
                        <div class="field">
                            <div class="fl">Daylight threshold lux</div>
                            <input v-model.number="form.daylightLux" type="number" />
                        </div>
                    </div>
                </div>
            </div>

            <div class="mft">
                <button type="button" class="btn-ghost" @click="emit('close')">Cancel</button>
                <button type="button" class="btn-primary" @click="onSave">Save</button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {reactive, ref, watch} from 'vue';
import {
    DEFAULT_ENV_SETTINGS,
    type EnvSettings
} from './environmentDashboard.types';

const props = defineProps<{visible: boolean; settings: EnvSettings}>();
const emit = defineEmits<{close: []; save: [settings: EnvSettings]}>();

const TABS = [
    {key: 'comfort', label: 'Comfort'},
    {key: 'air', label: 'Air quality'},
    {key: 'light', label: 'Light'}
] as const;
const tab = ref<(typeof TABS)[number]['key']>('comfort');

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
