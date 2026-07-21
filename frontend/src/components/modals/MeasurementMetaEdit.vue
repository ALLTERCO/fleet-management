<template>
    <div class="mme">
        <div class="mme__row">
            <label class="mme__label" :for="`${id}-ln`">Signal class</label>
            <select :id="`${id}-ln`" v-model="localLN" class="mme__select">
                <option value="">— none —</option>
                <option v-for="ln in LOGICAL_NODES" :key="ln" :value="ln">
                    {{ ln }} — {{ LOGICAL_NODE_HINTS[ln] }}
                </option>
            </select>
        </div>

        <div class="mme__row">
            <label class="mme__label" :for="`${id}-do`">Quantity</label>
            <input
                :id="`${id}-do`"
                v-model.trim="localDO"
                type="text"
                maxlength="40"
                class="mme__input"
                placeholder="e.g. TotW, SupWh, PhV"
            />
        </div>

        <div class="mme__row mme__row--split">
            <div class="mme__col">
                <label class="mme__label" :for="`${id}-phase`">Phase</label>
                <select :id="`${id}-phase`" v-model="localPhase" class="mme__select">
                    <option value="">—</option>
                    <option v-for="p in PHASES" :key="p" :value="p">{{ p }}</option>
                </select>
            </div>
            <div class="mme__col">
                <label class="mme__label" :for="`${id}-unit`">Unit</label>
                <input
                    :id="`${id}-unit`"
                    v-model.trim="localUnit"
                    type="text"
                    maxlength="16"
                    class="mme__input"
                    placeholder="W, Wh, V, A, Hz"
                />
            </div>
        </div>

        <div class="mme__row mme__row--split">
            <div class="mme__col">
                <label class="mme__label" :for="`${id}-acc`">Accumulation</label>
                <select :id="`${id}-acc`" v-model="localAcc" class="mme__select">
                    <option value="">—</option>
                    <option v-for="a in ACCUMULATIONS" :key="a" :value="a">{{ a }}</option>
                </select>
            </div>
            <div class="mme__col">
                <label class="mme__label" :for="`${id}-dir`">Direction</label>
                <select :id="`${id}-dir`" v-model="localDir" class="mme__select">
                    <option value="">—</option>
                    <option v-for="d in DIRECTIONS" :key="d" :value="d">{{ d }}</option>
                </select>
            </div>
        </div>

        <p class="mme__hint">
            IEC 61850 vocabulary. MMXU = AC instantaneous, MMTR = AC cumulative,
            MMDC = DC. Leave blank to omit.
        </p>
    </div>
</template>

<script setup lang="ts">
import {computed, useId, watch} from 'vue';
import type {MeasurementMeta} from '@/composables/useVirtualMeta';

const LOGICAL_NODES = [
    'MMXU',
    'MMTR',
    'MMXN',
    'MMDC',
    'MSQI',
    'MHAI'
] as const;

const LOGICAL_NODE_HINTS: Record<(typeof LOGICAL_NODES)[number], string> = {
    MMXU: 'AC instantaneous (3-phase)',
    MMTR: 'AC cumulative metering',
    MMXN: 'Single-phase / non-phase',
    MMDC: 'DC measurement',
    MSQI: 'Sequence / imbalance',
    MHAI: 'Harmonics'
};

const PHASES = ['A', 'B', 'C', 'N', 'total'] as const;
const ACCUMULATIONS = ['instant', 'cumulative', 'delta'] as const;
const DIRECTIONS = ['import', 'export', 'net'] as const;

const props = defineProps<{
    modelValue: MeasurementMeta | null;
}>();

const emit = defineEmits<{
    'update:modelValue': [value: MeasurementMeta | null];
}>();

const id = useId();
const localLN = computed({
    get: () => props.modelValue?.logicalNode ?? '',
    set: (v) => updateField('logicalNode', v || undefined)
});
const localDO = computed({
    get: () => props.modelValue?.dataObject ?? '',
    set: (v) => updateField('dataObject', v || undefined)
});
const localPhase = computed({
    get: () => props.modelValue?.phase ?? '',
    set: (v) => updateField('phase', v || undefined)
});
const localUnit = computed({
    get: () => props.modelValue?.unit ?? '',
    set: (v) => updateField('unit', v || undefined)
});
const localAcc = computed({
    get: () => props.modelValue?.accumulation ?? '',
    set: (v) => updateField('accumulation', v || undefined)
});
const localDir = computed({
    get: () => props.modelValue?.direction ?? '',
    set: (v) => updateField('direction', v || undefined)
});

function updateField<K extends keyof MeasurementMeta>(
    key: K,
    value: MeasurementMeta[K] | undefined
) {
    const next: MeasurementMeta = {...(props.modelValue ?? {})};
    if (value === undefined || value === '') delete next[key];
    else next[key] = value;
    emit('update:modelValue', Object.keys(next).length === 0 ? null : next);
}

// Re-emit current value when nothing changes (no-op) to silence unused
// `watch` warning if needed in future refactors.
watch(
    () => props.modelValue,
    () => {}
);
</script>

<style scoped>
.mme {
    display: flex;
    flex-direction: column;
    gap: var(--space-3, 0.75rem);
}
.mme__row {
    display: flex;
    flex-direction: column;
    gap: var(--space-1, 0.25rem);
}
.mme__row--split {
    flex-direction: row;
    gap: var(--space-3, 0.75rem);
}
.mme__col {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-1, 0.25rem);
}
.mme__label {
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    font-weight: 600;
}
.mme__select,
.mme__input {
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm, 4px);
    padding: 0.4rem 0.6rem;
    font-size: 0.9rem;
}
.mme__hint {
    color: var(--color-text-tertiary);
    font-size: 0.75rem;
    margin: 0;
}
</style>
