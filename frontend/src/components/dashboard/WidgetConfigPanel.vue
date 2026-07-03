<template>
    <div class="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(var(--color-surface-bg-rgb),0.5)] sm:items-center" @click.self="$emit('close')">
        <div class="w-full max-w-md rounded-t-2xl sm:rounded-2xl border border-border bg-surface shadow-xl" role="dialog" aria-modal="true" aria-labelledby="wcp-title">
            <div class="flex items-center justify-between border-b border-border px-5 py-4">
                <h2 id="wcp-title" class="text-sm font-semibold">Configure Widget</h2>
                <button class="text-muted hover:text-primary" aria-label="Close" title="Close" @click="$emit('close')">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16">
                        <path d="M4 4l8 8M12 4l-8 8" />
                    </svg>
                </button>
            </div>

            <div class="p-5 flex flex-col gap-4">
                <!-- Chart widget: structured form -->
                <template v-if="draft.id === 'chart_widget'">
                    <div class="flex flex-col gap-1">
                        <label class="text-xs font-medium text-muted">Device (Shelly ID)</label>
                        <input
                            v-model="draft.shellyId"
                            type="text"
                            class="rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                            placeholder="e.g. shellyem3-abc123"
                        />
                    </div>
                    <div class="flex flex-col gap-1">
                        <label class="text-xs font-medium text-muted">Metric</label>
                        <select
                            v-model="draft.metric"
                            class="rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                            <option v-for="m in CHART_METRICS" :key="m.value" :value="m.value">{{ m.label }}</option>
                        </select>
                    </div>
                    <div class="flex flex-col gap-1">
                        <label class="text-xs font-medium text-muted">Chart Type</label>
                        <select
                            v-model="draft.chartType"
                            class="rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                            <option value="line">Line</option>
                            <option value="bar">Bar</option>
                        </select>
                    </div>
                </template>

                <!-- Gauge widget: structured form -->
                <template v-else-if="draft.id === 'gauge_widget'">
                    <div class="flex flex-col gap-1">
                        <label class="text-xs font-medium text-muted">Device (Shelly ID)</label>
                        <input
                            v-model="draft.shellyId"
                            type="text"
                            class="rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                    </div>
                    <div class="flex flex-col gap-1">
                        <label class="text-xs font-medium text-muted">Metric</label>
                        <select
                            v-model="draft.metric"
                            class="rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                            <option v-for="m in CHART_METRICS" :key="m.value" :value="m.value">{{ m.label }}</option>
                        </select>
                    </div>
                </template>

                <!-- Fallback: JSON editor -->
                <template v-else>
                    <div class="flex flex-col gap-1">
                        <label class="text-xs font-medium text-muted">Widget Config (JSON)</label>
                        <textarea
                            v-model="jsonDraft"
                            rows="10"
                            class="rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                            :class="{ 'border-red-500': jsonError }"
                            @input="onJsonInput"
                        />
                        <p v-if="jsonError" class="text-xs text-red-500">{{ jsonError }}</p>
                    </div>
                </template>
            </div>

            <div class="flex justify-end gap-2 border-t border-border px-5 py-4">
                <button class="btn-ghost text-sm" @click="$emit('close')">Cancel</button>
                <button class="btn-primary text-sm" :disabled="!!jsonError" @click="save">Save</button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {onBeforeUnmount, onMounted, ref, watch} from 'vue';

const CHART_METRICS = [
    {value: 'power', label: 'Power (W)'},
    {value: 'consumption', label: 'Energy (Wh)'},
    {value: 'returned_energy', label: 'Returned Energy (Wh)'},
    {value: 'voltage', label: 'Voltage (V)'},
    {value: 'current', label: 'Current (A)'},
    {value: 'temperature', label: 'Temperature (°C)'},
    {value: 'humidity', label: 'Humidity (%)'},
    {value: 'luminance', label: 'Luminance (lux)'}
];

const props = defineProps<{
    config: Record<string, any>;
}>();

const emit = defineEmits<{
    close: [];
    save: [config: Record<string, any>];
}>();

const draft = ref<Record<string, any>>({});
const jsonDraft = ref('');
const jsonError = ref('');

watch(
    () => props.config,
    (c) => {
        draft.value = {...c};
        jsonDraft.value = JSON.stringify(c, null, 2);
        jsonError.value = '';
    },
    {immediate: true}
);

function onJsonInput() {
    try {
        draft.value = JSON.parse(jsonDraft.value);
        jsonError.value = '';
    } catch {
        jsonError.value = 'Invalid JSON';
    }
}

function save() {
    if (jsonError.value) return;
    emit('save', {...draft.value});
}

function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') emit('close');
}
onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>
