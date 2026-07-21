<template>
    <div class="cfg-panel">
        <div v-if="!fields.length && refetching" class="cfg-panel__loading">
            Loading configuration…
        </div>
        <div v-else-if="!fields.length" class="cfg-panel__error">
            <p>LedStrip configuration not available on this device.</p>
            <Button type="blue-hollow" size="sm" :loading="refetching" @click="refetch">Retry</Button>
        </div>

        <form
            v-else
            class="cfg-panel__form"
            @submit.prevent
            autocomplete="off"
        >
            <section class="cfg-panel__section" aria-label="LED settings">
                <LedStripField
                    v-for="field in fields"
                    :key="field.key"
                    :field="field"
                    :value="localValue(field.key)"
                    :catalog="catalog"
                    :allowlist="null"
                    @change="(v) => updateField(field.key, v)"
                />
            </section>

            <ConfigPanelFooter
                label="LED strip"
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
    </div>
</template>

<script setup lang="ts">
import type {LedStripCatalog, LedStripUiField} from '@api/ledstrip';
import {computed} from 'vue';
import {useDeviceConfigPanel} from '@/composables/useDeviceConfigPanel';
import Button from './Button.vue';
import ConfigPanelFooter from './ConfigPanelFooter.vue';
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
} = useDeviceConfigPanel<LedStripConfigRead, LocalForm>({
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
