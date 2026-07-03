<template>
    <div class="lfa">
        <div class="lfa__row lfa__row--street">
            <label class="lfa__label">Street</label>
            <Input :model-value="value.streetName ?? ''" placeholder="e.g. Vitosha Blvd"
                @update:model-value="update('streetName', String($event))" />
        </div>
        <div class="lfa__row lfa__row--number">
            <label class="lfa__label">Number</label>
            <Input :model-value="value.streetNumber ?? ''" placeholder="51"
                @update:model-value="update('streetNumber', String($event))" />
        </div>
        <div class="lfa__row">
            <label class="lfa__label">City</label>
            <Input :model-value="value.city ?? ''" @update:model-value="update('city', String($event))" />
        </div>
        <div class="lfa__row">
            <label class="lfa__label">Region</label>
            <Input :model-value="value.region ?? ''" @update:model-value="update('region', String($event))" />
        </div>
        <div class="lfa__row">
            <label class="lfa__label">Postal code</label>
            <Input :model-value="value.postalCode ?? ''" @update:model-value="update('postalCode', String($event))" />
        </div>
        <div class="lfa__row">
            <label class="lfa__label">Country (ISO 3166-1 alpha-2)</label>
            <Input :model-value="value.countryCode ?? ''" placeholder="FR, DE, US…"
                @update:model-value="update('countryCode', String($event).toUpperCase())" />
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import Input from '@/components/core/Input.vue';

export interface LocationAddressValue {
    streetName?: string;
    streetNumber?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    countryCode?: string;
}

const props = defineProps<{modelValue: LocationAddressValue | null | undefined}>();
const emit = defineEmits<{'update:modelValue': [LocationAddressValue | null]}>();

const value = computed(() => props.modelValue ?? {});

function update(key: keyof LocationAddressValue, v: string) {
    const next: LocationAddressValue = {...value.value};
    if (v) (next as Record<string, string>)[key] = v;
    else delete (next as Record<string, unknown>)[key];
    emit('update:modelValue', Object.keys(next).length > 0 ? next : null);
}
</script>

<style scoped>
.lfa {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-3);
}
.lfa__row { display: flex; flex-direction: column; gap: var(--space-1); }
.lfa__row--street { grid-column: span 3; }
.lfa__row--number { grid-column: span 1; }
.lfa__label { font-size: var(--type-body); font-weight: 600; color: var(--color-text-primary); }
@media (max-width: 640px) { .lfa { grid-template-columns: 1fr; } }
</style>
