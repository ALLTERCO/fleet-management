<template>
    <div class="edp">
        <input v-model="q" class="edp-search" type="search" :placeholder="placeholder ?? 'Search devices…'" />
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
    width: 100%;
    background: #0e1116;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    padding: 9px 11px;
    color: #f5f6f8;
    font: 500 13px 'Inter', system-ui, sans-serif;
    margin-bottom: 8px;
}
.edp-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 260px;
    overflow: auto;
    border: 1px solid rgba(255, 255, 255, 0.055);
    border-radius: 12px;
    padding: 6px;
}
.edp-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 10px;
    border-radius: 9px;
    cursor: pointer;
    font-size: var(--type-caption);
}
.edp-row:hover {
    background: #181c23;
}
.edp-name {
    flex: 1;
    font-weight: 500;
}
.edp-id {
    color: #5d646f;
    font-size: var(--type-caption);
    font-variant-numeric: tabular-nums;
}
.edp-empty {
    font-size: var(--type-caption);
    color: #5d646f;
    padding: 6px 10px;
}
</style>
