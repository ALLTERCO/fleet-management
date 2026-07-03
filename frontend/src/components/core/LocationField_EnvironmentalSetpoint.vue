<template>
    <div class="lfe">
        <div class="lfe__row">
            <label class="lfe__label">Min temperature (°C)</label>
            <Input :model-value="strOf('tempMinC')" type="number" placeholder="-40 to 60"
                @update:model-value="update('tempMinC', $event)" />
        </div>
        <div class="lfe__row">
            <label class="lfe__label">Max temperature (°C)</label>
            <Input :model-value="strOf('tempMaxC')" type="number" placeholder="-40 to 60"
                @update:model-value="update('tempMaxC', $event)" />
        </div>
        <div class="lfe__row">
            <label class="lfe__label">Min humidity (%)</label>
            <Input :model-value="strOf('humidityMinPct')" type="number" placeholder="0 to 100"
                @update:model-value="update('humidityMinPct', $event)" />
        </div>
        <div class="lfe__row">
            <label class="lfe__label">Max humidity (%)</label>
            <Input :model-value="strOf('humidityMaxPct')" type="number" placeholder="0 to 100"
                @update:model-value="update('humidityMaxPct', $event)" />
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import Input from '@/components/core/Input.vue';

export interface LocationEnvSetpointValue {
    tempMinC?: number;
    tempMaxC?: number;
    humidityMinPct?: number;
    humidityMaxPct?: number;
}

const props = defineProps<{modelValue: LocationEnvSetpointValue | null | undefined}>();
const emit = defineEmits<{'update:modelValue': [LocationEnvSetpointValue | null]}>();

const value = computed<LocationEnvSetpointValue>(() => props.modelValue ?? {});

function strOf(k: keyof LocationEnvSetpointValue): string {
    const v = value.value[k];
    return v != null ? String(v) : '';
}

function update(key: keyof LocationEnvSetpointValue, raw: string | number | boolean) {
    const next: LocationEnvSetpointValue = {...value.value};
    const s = String(raw ?? '').trim();
    if (!s) {
        delete next[key];
    } else {
        const n = Number(s);
        if (Number.isFinite(n)) next[key] = n;
    }
    emit('update:modelValue', Object.keys(next).length > 0 ? next : null);
}
</script>

<style scoped>
.lfe { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }
.lfe__row { display: flex; flex-direction: column; gap: var(--space-1); }
.lfe__label { font-size: var(--type-body); font-weight: 600; color: var(--color-text-primary); }
@media (max-width: 640px) { .lfe { grid-template-columns: 1fr; } }
</style>
