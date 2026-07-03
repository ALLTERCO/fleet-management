<template>
    <div class="lfc">
        <div class="lfc__row lfc__row--wide">
            <label class="lfc__label">Name</label>
            <Input :model-value="value.name ?? ''" placeholder="Jane Doe"
                @update:model-value="update('name', String($event))" />
        </div>
        <div class="lfc__row">
            <label class="lfc__label">Role</label>
            <Input :model-value="value.role ?? ''" placeholder="Facility Manager"
                @update:model-value="update('role', String($event))" />
        </div>
        <div class="lfc__row">
            <label class="lfc__label">Email</label>
            <Input :model-value="value.email ?? ''" type="email" placeholder="jane@example.com"
                @update:model-value="update('email', String($event))" />
        </div>
        <div class="lfc__row">
            <label class="lfc__label">Phone (E.164)</label>
            <Input :model-value="value.phone ?? ''" placeholder="+1 555 0100"
                @update:model-value="update('phone', String($event))" />
        </div>
        <div class="lfc__row lfc__row--wide">
            <label class="lfc__toggle">
                <input type="checkbox" :checked="!!value.afterHours"
                    @change="update('afterHours', ($event.target as HTMLInputElement).checked)" />
                Available after hours
            </label>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import Input from '@/components/core/Input.vue';

export interface LocationContactValue {
    name: string;
    role?: string;
    email?: string;
    phone?: string;
    afterHours?: boolean;
}

const props = defineProps<{modelValue: LocationContactValue | null | undefined}>();
const emit = defineEmits<{'update:modelValue': [LocationContactValue | null]}>();

const value = computed(() => props.modelValue ?? ({} as Partial<LocationContactValue>));

function update(key: keyof LocationContactValue, v: string | boolean) {
    const next: Partial<LocationContactValue> = {...value.value};
    if (typeof v === 'boolean') {
        if (v) next.afterHours = true;
        else delete next.afterHours;
    } else if (v) {
        (next as Record<string, string>)[key] = v;
    } else {
        delete (next as Record<string, unknown>)[key];
    }
    // `name` is required by the backend schema — emit null if name is empty.
    if (!next.name) emit('update:modelValue', null);
    else emit('update:modelValue', next as LocationContactValue);
}
</script>

<style scoped>
.lfc { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }
.lfc__row { display: flex; flex-direction: column; gap: var(--space-1); }
.lfc__row--wide { grid-column: 1 / -1; }
.lfc__label { font-size: var(--type-body); font-weight: 600; color: var(--color-text-primary); }
.lfc__toggle {
    display: inline-flex; align-items: center; gap: var(--space-2);
    font-size: var(--type-body); color: var(--color-text-primary); cursor: pointer;
}
@media (max-width: 640px) { .lfc { grid-template-columns: 1fr; } }
</style>
