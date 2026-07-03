<template>
    <div class="cfg-panel">
        <div v-if="!fields.length" class="cfg-panel__error">
            <p>LedStrip configuration not available on this device.</p>
            <Button type="blue-hollow" size="sm" @click="reload">Retry</Button>
        </div>

        <form
            v-else
            class="cfg-panel__group"
            @submit.prevent
            autocomplete="off"
        >
            <LedStripField
                v-for="field in fields"
                :key="field.key"
                :field="field"
                :value="localValue(field.key)"
                :catalog="catalog"
                :allowlist="null"
                @change="(v) => updateField(field.key, v)"
            />

            <div v-if="dirty" class="cfg-panel__footer">
                <Button type="blue" size="sm" :loading="saving" @click="save">
                    Save
                </Button>
            </div>
        </form>
    </div>
</template>

<script setup lang="ts">
import type {LedStripCatalog, LedStripUiField} from '@api/ledstrip';
import {computed} from 'vue';
import {useDeviceConfigPanel} from '@/composables/useDeviceConfigPanel';
import Button from './Button.vue';
import LedStripField from './LedStripField.vue';

type LocalForm = Record<string, unknown>;

interface LedStripConfigRead {
    name?: string | null;
    num_leds?: number;
    protocol?: string;
    effects?: string[];
    initial_state?: number;
    _catalog?: LedStripCatalog;
    _meta?: {ui?: {configFields?: LedStripUiField[]}};
}

const props = defineProps<{shellyID: string}>();

const {config, local, dirty, saving, markDirty, save, reload} =
    useDeviceConfigPanel<LedStripConfigRead, LocalForm>({
        shellyID: () => props.shellyID,
        settingsKey: 'ledstrip:0',
        method: 'LedStrip.SetConfig',
        extraParams: () => ({id: 0}),
        initialLocal: {},
        mapToLocal: copyConfiguredFields,
        mapToUpdate: (l) => ({...l}),
        successToast: 'LedStrip configuration saved'
    });

function copyConfiguredFields(c: LedStripConfigRead): LocalForm {
    const fields = c._meta?.ui?.configFields ?? [];
    const out: LocalForm = {};
    for (const field of fields) {
        out[field.key] = (c as Record<string, unknown>)[field.key];
    }
    return out;
}

const fields = computed<LedStripUiField[]>(
    () => config.value?._meta?.ui?.configFields ?? []
);

const catalog = computed(() => config.value?._catalog ?? {});

function localValue(key: string): unknown {
    return (local as LocalForm)[key];
}

function updateField(key: string, value: unknown): void {
    (local as LocalForm)[key] = value;
    markDirty();
}
</script>
