<template>
    <div class="et">
        <!-- Hero: the one thing an operator asks first — is it running? -->
        <header class="et__hero">
            <div class="et__hero-value">{{ isRunning ? 'Running' : 'Stopped' }}</div>
            <div class="et__hero-label">
                <span>{{ scriptLabel }}</span>
                <span v-if="!runsOnBoot"> — will not restart after a reboot</span>
            </div>
        </header>

        <!-- Primary affordance: one button that starts or stops the script -->
        <button
            type="button"
            class="et__primary"
            :class="{
                'et__primary--on': isRunning,
                'et__primary--readonly': !canExecute
            }"
            :disabled="!canExecute"
            :aria-pressed="isRunning"
            @click="onPrimaryClick"
        >
            <span class="et__primary-text">
                <span class="et__primary-state">{{ isRunning ? 'Stop' : 'Run' }}</span>
                <span class="et__primary-source">{{ isRunning ? 'Script.Stop' : 'Script.Start' }}</span>
            </span>
            <span class="et__primary-icon" aria-hidden="true">
                <i :class="isRunning ? 'fas fa-stop' : 'fas fa-play'" />
            </span>
        </button>

        <!-- A crashed script stops silently; the error list is the only signal -->
        <div v-if="scriptErrors.length" class="et__banner et__banner--danger" role="alert">
            <i class="fas fa-triangle-exclamation" />
            <span class="et__banner-list">
                <span v-for="err in scriptErrors" :key="err">{{ humanError(err) }}</span>
            </span>
        </div>

        <!-- Memory is the resource scripts actually run out of (shared JS pool) -->
        <ul v-if="memoryKpis.length" class="et__kpis">
            <li v-for="kpi in memoryKpis" :key="kpi.label" class="et__kpi">
                <span class="et__kpi-value">{{ kpi.value }}</span>
                <span class="et__kpi-label">{{ kpi.label }}</span>
            </li>
        </ul>

        <section class="et__panel">
            <div class="et__panel-row">
                <span>Component</span>
                <span class="et__panel-value">script:{{ scriptId }}</span>
            </div>
            <div class="et__panel-row">
                <span>Run on boot</span>
                <span class="et__panel-value">{{ runsOnBoot ? 'Yes' : 'No' }}</span>
            </div>
        </section>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {formatBytes} from '@/helpers/format';

const props = defineProps<{
    status: Record<string, any> | undefined;
    settings: Record<string, any> | undefined;
    canExecute: boolean;
    shellyID?: string;
    entityId?: string;
}>();

// The backend action adapter maps these to Script.Start / Script.Stop.
const emit = defineEmits<{
    start: [];
    stop: [];
}>();

const isRunning = computed(() => props.status?.running === true);
const scriptId = computed(() => props.status?.id ?? props.settings?.id ?? 0);

// Script.GetConfig: `enable` = the script starts by itself on boot.
const runsOnBoot = computed(() => props.settings?.enable === true);

const scriptLabel = computed(() => {
    const name = props.settings?.name;
    return typeof name === 'string' && name ? name : `Script ${scriptId.value}`;
});

const scriptErrors = computed<string[]>(() => {
    const errors = props.status?.errors;
    return Array.isArray(errors) ? errors.map(String) : [];
});

function num(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// Only what this firmware reports — `cpu` is 1.7.0+, older builds omit it.
const memoryKpis = computed(() => {
    const kpis: {label: string; value: string}[] = [];
    const used = num(props.status?.mem_used);
    const peak = num(props.status?.mem_peak);
    const free = num(props.status?.mem_free);
    const cpu = num(props.status?.cpu);
    if (used !== null) kpis.push({label: 'Memory used', value: formatBytes(used)});
    if (peak !== null) kpis.push({label: 'Peak memory', value: formatBytes(peak)});
    if (free !== null) kpis.push({label: 'Pool free', value: formatBytes(free)});
    if (cpu !== null) kpis.push({label: 'CPU', value: `${cpu.toFixed(1)}%`});
    return kpis;
});

function humanError(code: string): string {
    const words = code.replace(/_/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
}

/** One button, two commands — whichever the current state calls for. */
function onPrimaryClick(): void {
    if (!props.canExecute) return;
    if (isRunning.value) emit('stop');
    else emit('start');
}
</script>

<style src="./entityTemplate.css"></style>
