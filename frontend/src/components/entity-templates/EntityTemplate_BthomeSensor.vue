<template>
    <div class="et-bthome">
        <!-- Value display -->
        <div v-if="sensorType === 'sensor'" class="et-bthome__value-card">
            <span class="et-bthome__value">{{ displayValue }}</span>
            <span class="et-bthome__unit">{{ unit }}</span>
            <span class="et-bthome__label">{{ objLabel }}</span>
        </div>

        <!-- Binary sensor -->
        <div v-else-if="sensorType === 'binary_sensor'" class="et-bthome__state" :class="status?.value ? 'et-bthome__state--active' : 'et-bthome__state--inactive'">
            <i :class="status?.value ? 'fas fa-circle-check' : 'fas fa-circle-xmark'" class="et-bthome__state-icon" />
            <span>{{ binaryLabel }}</span>
        </div>

        <!-- Button sensor (event-based) -->
        <div
            v-else-if="sensorType === 'button' || sensorType === 'dimmer'"
            class="et-bthome__event"
        >
            <i
                :class="
                    sensorType === 'dimmer'
                        ? 'fas fa-sliders et-bthome__event-icon'
                        : 'fas fa-circle-dot et-bthome__event-icon'
                "
            />
            <span>{{ eventDisplay }}</span>
        </div>

        <!-- Sensor name (editable) -->
        <div v-if="canExecute && shellyID" class="et-bthome__name-row">
            <input
                class="et-bthome__name-input"
                :value="settings?.name ?? ''"
                placeholder="Sensor name"
                @change="(e: Event) => renameSensor((e.target as HTMLInputElement).value)"
            />
        </div>

        <!-- Metrics grid for extra fields -->
        <div v-if="metrics.length" class="et-bthome__grid">
            <div v-for="m in metrics" :key="m.label" class="et-bthome__card">
                <span class="et-bthome__card-value">{{ m.value }}</span>
                <span class="et-bthome__card-label">{{ m.label }}</span>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {getBThomeBinaryStateWords} from '@/config/bthome-presentation';

const props = defineProps<{
    status: Record<string, any> | undefined;
    settings: Record<string, any> | undefined;
    canExecute: boolean;
    objName?: string;
    unit?: string;
    sensorType?: string;
    shellyID?: string;
}>();

import * as ws from '@/tools/websocket';

async function renameSensor(name: string) {
    if (!props.shellyID) return;
    const id = props.status?.id ?? props.settings?.id;
    if (id == null) return;
    try {
        await ws.sendRPC('FLEET_MANAGER', 'BTHome.Sensor.Rename', {
            shellyID: props.shellyID,
            id,
            name: name || null
        });
    } catch {
        // non-critical
    }
}

const objLabel = computed(() => {
    const name = props.objName ?? '';
    return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
});

const displayValue = computed(() => {
    const v = props.status?.value;
    if (v == null) return 'N/A';
    if (typeof v === 'number')
        return Number.isInteger(v) ? String(v) : v.toFixed(2);
    return String(v);
});

const eventDisplay = computed(() => {
    const raw = props.status?.last_event ?? props.status?.value;
    if (typeof raw === 'string' && raw.trim()) return formatKey(raw);
    if (typeof raw === 'number') return `Event ${raw}`;
    if (raw != null) return String(raw);
    return 'No events';
});

// Binary state words are presentation, keyed on the backend-sent objName.
const binaryLabel = computed(() => {
    const v = !!props.status?.value;
    const words = getBThomeBinaryStateWords(props.objName);
    return v ? words.on : words.off;
});

const SKIP_KEYS = new Set(['id', 'value', 'last_event']);

function formatTimestamp(ts: number): string {
    if (!ts) return 'Never';
    const date = new Date(ts * 1000);
    const diffS = Math.floor((Date.now() - date.getTime()) / 1000);
    if (diffS < 60) return 'Just now';
    if (diffS < 3600) return `${Math.floor(diffS / 60)} min ago`;
    if (diffS < 86400) return `${Math.floor(diffS / 3600)}h ago`;
    return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

const metrics = computed(() => {
    const s = props.status;
    if (!s) return [];
    const out: {label: string; value: string}[] = [];
    for (const [k, v] of Object.entries(s)) {
        if (SKIP_KEYS.has(k)) continue;
        // Format timestamps as human-readable
        if (k.endsWith('_ts') && typeof v === 'number') {
            out.push({
                label: formatKey(k.replace(/_ts$/, '')),
                value: formatTimestamp(v)
            });
        } else if (typeof v === 'number')
            out.push({label: formatKey(k), value: String(v)});
        else if (typeof v === 'string' && v)
            out.push({label: formatKey(k), value: v});
        else if (typeof v === 'boolean')
            out.push({label: formatKey(k), value: v ? 'Yes' : 'No'});
    }
    return out;
});

function formatKey(key: string): string {
    return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
</script>

<style scoped>
.et-bthome {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

/* Sensor value card */
.et-bthome__value-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: var(--space-4);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-2);
}
.et-bthome__value {
    font-size: var(--type-subheading);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
}
.et-bthome__unit {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    margin-top: -0.125rem;
}
.et-bthome__label {
    font-size: var(--type-body);
    color: var(--color-text-disabled);
    margin-top: var(--space-1);
}

/* Binary sensor state */
.et-bthome__state {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    font-weight: var(--font-semibold);
    font-size: var(--type-body);
}
.et-bthome__state--active {
    background-color: var(--color-warning-subtle);
    color: var(--color-warning-text);
}
.et-bthome__state--inactive {
    background-color: var(--color-success-subtle);
    color: var(--color-success-text);
}
.et-bthome__state-icon {
    font-size: var(--type-subheading);
}

/* Button event */
.et-bthome__event {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-2);
    font-size: var(--type-body);
    color: var(--color-text-primary);
}
.et-bthome__event-icon {
    color: var(--color-text-tertiary);
}

/* Extra metrics grid */
.et-bthome__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
    gap: var(--space-1-5);
}
.et-bthome__card {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: var(--space-2);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-2);
}
.et-bthome__card-value {
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
}
.et-bthome__card-label {
    font-size: var(--type-body);
    color: var(--color-text-disabled);
    text-align: center;
}
.et-bthome__name-row {
    display: flex;
}
.et-bthome__name-input {
    flex: 1;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    font-size: var(--type-body);
}
</style>
