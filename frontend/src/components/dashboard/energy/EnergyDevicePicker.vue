<template>
    <div class="edp">
        <input
            v-model="q"
            class="edp-search core-input border text-base rounded-lg block w-full p-2"
            type="search"
            :placeholder="placeholder ?? 'Search devices…'"
        />
        <div class="edp-list">
            <label v-for="dev in filtered" :key="dev.shellyId" class="edp-row">
                <input type="checkbox" :checked="selected.has(dev.shellyId)" @change="toggle(dev.shellyId)" />
                <span class="edp-name">{{ dev.name }}</span>
                <span class="edp-id">{{ dev.shellyId }}</span>
            </label>
            <p v-if="!filtered.length" class="edp-empty">No devices match.</p>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';

const props = defineProps<{
    modelValue: string[];
    devices: {shellyId: string; name: string}[];
    placeholder?: string;
}>();
const emit = defineEmits<{'update:modelValue': [string[]]}>();

const q = ref('');
const selected = computed(() => new Set(props.modelValue));
const filtered = computed(() => {
    const s = q.value.trim().toLowerCase();
    if (!s) return props.devices;
    return props.devices.filter((d) => d.name.toLowerCase().includes(s) || d.shellyId.toLowerCase().includes(s));
});

function toggle(shellyId: string) {
    const next = new Set(props.modelValue);
    if (next.has(shellyId)) next.delete(shellyId);
    else next.add(shellyId);
    emit('update:modelValue', [...next]);
}
</script>

<style scoped>
.edp-search {
    margin-bottom: var(--space-2);
}
.edp-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    max-height: 16rem;
    overflow: auto;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    padding: var(--space-1-5);
}
.edp-row {
    display: flex;
    align-items: center;
    gap: var(--space-2-5);
    padding: var(--space-2) var(--space-2-5);
    border-radius: var(--radius-md);
    cursor: pointer;
    font-size: var(--type-caption);
    color: var(--color-text-primary);
}
.edp-row:hover {
    background: var(--color-surface-3);
}
.edp-row input {
    accent-color: var(--color-primary);
}
.edp-name {
    flex: 1;
    font-weight: var(--font-medium);
}
.edp-id {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    font-variant-numeric: tabular-nums;
}
.edp-empty {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    padding: var(--space-1-5) var(--space-2-5);
}
</style>
