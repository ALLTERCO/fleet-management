<template>
    <div class="et-sensor">
        <!-- Errors banner -->
        <div v-if="errors.length" class="et-sensor__errors">
            <div v-for="err in errors" :key="err" class="et-sensor__error">
                <i class="fas fa-triangle-exclamation et-sensor__error-icon" />
                <span>{{ formatError(err) }}</span>
            </div>
        </div>

        <!-- Primary state badge -->
        <div v-if="primaryState" class="et-sensor__state" :class="primaryState.severity">
            <i v-if="primaryState.icon" :class="primaryState.icon" class="et-sensor__state-icon" />
            <span class="et-sensor__state-text">{{ primaryState.label }}</span>
        </div>

        <!-- Metrics grid -->
        <div v-if="metrics.length" class="et-sensor__grid">
            <div v-for="m in metrics" :key="m.label" class="et-sensor__card">
                <span class="et-sensor__value">{{ m.value }}</span>
                <span class="et-sensor__label">{{ m.label }}</span>
            </div>
        </div>

        <!-- Smoke mute control -->
        <div v-if="canExecute && shellyID && isSmoke && status?.mute !== undefined" class="et-sensor__mute">
            <button class="et-sensor__mute-btn" :class="status.mute && 'et-sensor__mute-btn--active'" @click="emit('mute', !status.mute)">
                <i :class="status.mute ? 'fas fa-volume-mute' : 'fas fa-bell'" />
                {{ status.mute ? 'Muted — Tap to unmute' : 'Mute alarm' }}
            </button>
        </div>

        <!-- Editable config -->
        <div v-if="canExecute && shellyID && hasEditableConfig" class="et-sensor__section">
            <div class="et-sensor__section-header" @click="showConfig = !showConfig">
                <i class="fas fa-gear" /> Settings
                <i class="fas" :class="showConfig ? 'fa-chevron-down' : 'fa-chevron-right'" style="margin-left: auto; font-size: var(--type-body); color: var(--color-text-disabled);" />
            </div>
            <template v-if="showConfig">
                <!-- Name (all types) -->
                <div v-if="settings?.name != null" class="et-sensor__row">
                    <span class="et-sensor__row-label">Name</span>
                    <input type="text" class="et-sensor__text-input" :value="settings.name" placeholder="Sensor name"
                        @change="(e: Event) => setConfig({name: (e.target as HTMLInputElement).value})" />
                </div>
                <!-- Temperature: report_thr_C, offset_C -->
                <div v-if="settings?.report_thr_C != null" class="et-sensor__row">
                    <span class="et-sensor__row-label">Report threshold</span>
                    <input type="number" class="et-sensor__num" :value="settings.report_thr_C" min="0.5" max="5" step="0.1"
                        @change="(e: Event) => setConfig({report_thr_C: Number((e.target as HTMLInputElement).value)})" />
                    <span class="et-sensor__unit">°C</span>
                </div>
                <div v-if="settings?.offset_C != null" class="et-sensor__row">
                    <span class="et-sensor__row-label">Offset</span>
                    <input type="number" class="et-sensor__num" :value="settings.offset_C" min="-50" max="50" step="0.1"
                        @change="(e: Event) => setConfig({offset_C: Number((e.target as HTMLInputElement).value)})" />
                    <span class="et-sensor__unit">°C</span>
                </div>
                <!-- Humidity: report_thr, offset -->
                <div v-if="sensorType === 'humidity' && settings?.report_thr != null" class="et-sensor__row">
                    <span class="et-sensor__row-label">Report threshold</span>
                    <input type="number" class="et-sensor__num" :value="settings.report_thr" min="1" max="20" step="0.5"
                        @change="(e: Event) => setConfig({report_thr: Number((e.target as HTMLInputElement).value)})" />
                    <span class="et-sensor__unit">%</span>
                </div>
                <div v-if="sensorType === 'humidity' && settings?.offset != null" class="et-sensor__row">
                    <span class="et-sensor__row-label">Offset</span>
                    <input type="number" class="et-sensor__num" :value="settings.offset" min="-50" max="50" step="0.1"
                        @change="(e: Event) => setConfig({offset: Number((e.target as HTMLInputElement).value)})" />
                    <span class="et-sensor__unit">%</span>
                </div>
                <!-- Voltmeter: report_thr, range, xvoltage -->
                <div v-if="sensorType === 'voltmeter' && settings?.report_thr != null" class="et-sensor__row">
                    <span class="et-sensor__row-label">Report threshold</span>
                    <input type="number" class="et-sensor__num" :value="settings.report_thr" min="0" step="0.5"
                        @change="(e: Event) => setConfig({report_thr: Number((e.target as HTMLInputElement).value)})" />
                    <span class="et-sensor__unit">V</span>
                </div>
                <div v-if="settings?.range != null" class="et-sensor__row">
                    <span class="et-sensor__row-label">Input range</span>
                    <select class="et-sensor__select" :value="settings.range"
                        @change="(e: Event) => setConfig({range: Number((e.target as HTMLSelectElement).value)})">
                        <option :value="0">0–15V DC</option>
                        <option :value="1">0–30V DC</option>
                    </select>
                </div>
                <div v-if="settings?.xvoltage" class="et-sensor__row">
                    <span class="et-sensor__row-label">Transform expr</span>
                    <input type="text" class="et-sensor__text-input" :value="settings.xvoltage.expr ?? ''" placeholder="e.g. x*100"
                        @change="(e: Event) => setConfig({xvoltage: {expr: (e.target as HTMLInputElement).value || null}})" />
                </div>
                <div v-if="settings?.xvoltage" class="et-sensor__row">
                    <span class="et-sensor__row-label">Unit</span>
                    <input type="text" class="et-sensor__text-input" :value="settings.xvoltage.unit ?? ''" placeholder="V"
                        @change="(e: Event) => setConfig({xvoltage: {unit: (e.target as HTMLInputElement).value || null}})" />
                </div>
                <!-- Flood: alarm_mode -->
                <div v-if="settings?.alarm_mode !== undefined" class="et-sensor__row">
                    <span class="et-sensor__row-label">Alarm sound</span>
                    <select class="et-sensor__select" :value="settings.alarm_mode ?? 'disabled'"
                        @change="(e: Event) => setConfig({alarm_mode: (e.target as HTMLSelectElement).value === 'disabled' ? null : (e.target as HTMLSelectElement).value})">
                        <option value="disabled">Disabled</option>
                        <option value="normal">Normal</option>
                        <option value="intense">Intense</option>
                        <option value="rain">Rain</option>
                    </select>
                </div>
            </template>
        </div>

        <!-- Read-only config -->
        <div v-else-if="configRows.length" class="et-sensor__config">
            <div v-for="row in configRows" :key="row.label" class="et-sensor__config-row">
                <span class="et-sensor__config-label">{{ row.label }}</span>
                <span class="et-sensor__config-value">{{ row.value }}</span>
            </div>
        </div>

        <div v-if="configError" class="et-sensor__error">
            <i class="fas fa-triangle-exclamation" /> {{ configError }}
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import {sendRPC} from '@/tools/websocket';

const props = defineProps<{
    status: Record<string, any> | undefined;
    settings: Record<string, any> | undefined;
    canExecute: boolean;
    shellyID?: string;
    sensorType?: string;
}>();

const emit = defineEmits<{
    mute: [value: boolean];
}>();

const configError = ref<string | null>(null);
const showConfig = ref(false);

const isSmoke = computed(() => props.sensorType === 'smoke');
const isFlood = computed(() => props.sensorType === 'flood');

// RPC type for SetConfig
const RPC_TYPE_MAP: Record<string, string> = {
    temperature: 'Temperature',
    humidity: 'Humidity',
    voltmeter: 'Voltmeter',
    flood: 'Flood',
    smoke: 'Smoke',
    devicepower: 'DevicePower'
};
const rpcType = computed(
    () => RPC_TYPE_MAP[props.sensorType ?? ''] ?? 'Temperature'
);

const hasEditableConfig = computed(() => {
    const c = props.settings;
    if (!c) return false;
    if (props.sensorType === 'devicepower') return false;
    return (
        c.name != null ||
        c.report_thr_C != null ||
        c.report_thr != null ||
        c.offset_C != null ||
        c.offset != null ||
        c.alarm_mode !== undefined ||
        c.range != null ||
        c.xvoltage != null
    );
});

async function setConfig(config: Record<string, any>) {
    if (!props.shellyID) return;
    configError.value = null;
    const id = props.status?.id ?? 0;
    try {
        await sendRPC('FLEET_MANAGER', 'Addon.Peripheral.SetConfig', {
            shellyID: props.shellyID,
            component: rpcType.value,
            id,
            config
        });
    } catch (e: any) {
        configError.value = e.message || 'Failed to set config';
    }
}

// ── Errors ──
const errors = computed<string[]>(() => {
    const e = props.status?.errors;
    return Array.isArray(e) ? e : [];
});

const ERROR_LABELS: Record<string, string> = {
    cable_unplugged: 'Cable Unplugged',
    sensor_failure: 'Sensor Failure',
    over_temperature: 'Over Temperature',
    low_battery: 'Low Battery',
    out_of_range: 'Out of Range',
    read: 'Read Error'
};

function formatError(err: string): string {
    return (
        ERROR_LABELS[err] ??
        err.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    );
}

// ── Status → primary state ──
interface StateInfo {
    label: string;
    icon: string;
    severity:
        | 'et-sensor__state--ok'
        | 'et-sensor__state--warn'
        | 'et-sensor__state--danger';
}

const primaryState = computed<StateInfo | null>(() => {
    const s = props.status;
    if (!s) return null;

    if (isFlood.value && 'alarm' in s) {
        if (s.alarm === true)
            return {
                label: 'Flood Detected',
                icon: 'fas fa-water',
                severity: 'et-sensor__state--danger'
            };
        if (s.alarm === false)
            return {
                label: 'Dry',
                icon: 'fas fa-check-circle',
                severity: 'et-sensor__state--ok'
            };
        return {
            label: 'Sensor Error',
            icon: 'fas fa-triangle-exclamation',
            severity: 'et-sensor__state--danger'
        };
    }

    if (isSmoke.value && 'alarm' in s) {
        if (s.alarm === true)
            return {
                label: 'Smoke Detected',
                icon: 'fas fa-smog',
                severity: 'et-sensor__state--danger'
            };
        if (s.alarm === false)
            return {
                label: 'Clear',
                icon: 'fas fa-check-circle',
                severity: 'et-sensor__state--ok'
            };
        return {
            label: 'Sensor Error',
            icon: 'fas fa-triangle-exclamation',
            severity: 'et-sensor__state--danger'
        };
    }

    return null;
});

// ── Metrics ──
interface Metric {
    label: string;
    value: string;
}

const SKIP_STATUS_KEYS = new Set([
    'id',
    'alarm',
    'smoke',
    'state',
    'mute',
    'errors'
]);

const metrics = computed<Metric[]>(() => {
    const s = props.status;
    if (!s) return [];
    const out: Metric[] = [];
    if (s.battery) {
        if (s.battery.percent != null)
            out.push({label: 'Battery', value: `${s.battery.percent}%`});
        if (s.battery.V != null)
            out.push({label: 'Voltage', value: `${s.battery.V} V`});
    }
    if (s.tC != null) out.push({label: 'Temperature', value: `${s.tC} °C`});
    if (s.tF != null && s.tC == null)
        out.push({label: 'Temperature', value: `${s.tF} °F`});
    if (s.rh != null) out.push({label: 'Humidity', value: `${s.rh}%`});
    // With an xvoltage transform+unit set, the transformed value is the real
    // reading in its own unit; list it before raw volts.
    const xUnit = props.settings?.xvoltage?.unit;
    if (s.xvoltage != null && xUnit)
        out.push({label: 'Reading', value: `${s.xvoltage} ${xUnit}`});
    if (s.voltage != null)
        out.push({label: 'Voltage', value: `${s.voltage} V`});
    if (s.xvoltage != null && !xUnit)
        out.push({label: 'Transformed', value: `${s.xvoltage}`});
    if (s.mute != null)
        out.push({label: 'Muted', value: s.mute ? 'Yes' : 'No'});
    for (const [k, v] of Object.entries(s)) {
        if (SKIP_STATUS_KEYS.has(k)) continue;
        if (
            [
                'battery',
                'tC',
                'tF',
                'rh',
                'mute',
                'voltage',
                'xvoltage',
                'external'
            ].includes(k)
        )
            continue;
        if (typeof v === 'number')
            out.push({label: formatKey(k), value: String(v)});
        else if (typeof v === 'string' && v)
            out.push({label: formatKey(k), value: v});
        else if (typeof v === 'boolean')
            out.push({label: formatKey(k), value: v ? 'Yes' : 'No'});
    }
    // External power
    if (s.external?.present != null)
        out.push({
            label: 'External power',
            value: s.external.present ? 'Connected' : 'Disconnected'
        });
    return out;
});

// ── Read-only config ──
const SKIP_CONFIG_KEYS = new Set(['id', 'name']);
const configRows = computed(() => {
    const c = props.settings;
    if (!c) return [];
    const out: {label: string; value: string}[] = [];
    for (const [k, v] of Object.entries(c)) {
        if (SKIP_CONFIG_KEYS.has(k)) continue;
        if (v == null || typeof v === 'object') continue;
        out.push({label: formatKey(k), value: formatConfigValue(v)});
    }
    return out;
});

function formatKey(key: string): string {
    return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatConfigValue(v: unknown): string {
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (typeof v === 'number') return String(v);
    return String(v);
}
</script>

<style scoped>
.et-sensor {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

/* Errors */
.et-sensor__errors { display: flex; flex-direction: column; gap: var(--space-1); }
.et-sensor__error {
    display: flex; align-items: center; gap: var(--space-2);
    padding: var(--space-2) var(--space-3); border-radius: var(--radius-md);
    background-color: var(--color-danger-subtle); color: var(--color-danger-text);
    font-size: var(--type-body); font-weight: var(--font-semibold);
}
.et-sensor__error-icon { flex-shrink: 0; }

/* Primary state */
.et-sensor__state {
    display: flex; align-items: center; justify-content: center; gap: var(--space-2);
    padding: var(--space-3); border-radius: var(--radius-md);
    font-weight: var(--font-semibold); font-size: var(--type-body);
}
.et-sensor__state--ok { background-color: var(--color-success-subtle); color: var(--color-success-text); }
.et-sensor__state--warn { background-color: var(--color-warning-subtle); color: var(--color-warning-text); }
.et-sensor__state--danger { background-color: var(--color-danger-subtle); color: var(--color-danger-text); }
.et-sensor__state-icon { font-size: var(--type-subheading); }

/* Metrics */
.et-sensor__grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: var(--space-1-5);
}
.et-sensor__card {
    display: flex; flex-direction: column; align-items: center; padding: var(--space-2);
    border-radius: var(--radius-md); background-color: var(--color-surface-2);
}
.et-sensor__value { font-size: var(--type-body); font-weight: var(--font-bold); color: var(--color-text-primary); }
.et-sensor__label { font-size: var(--type-caption); color: var(--color-text-disabled); text-align: center; }

/* Smoke mute */
.et-sensor__mute { display: flex; }
.et-sensor__mute-btn {
    flex: 1; display: flex; align-items: center; justify-content: center; gap: var(--space-1-5);
    padding: var(--space-1-5) var(--space-3); border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default); background-color: var(--color-surface-2);
    color: var(--color-text-tertiary); font-size: var(--type-body); font-weight: var(--font-medium); cursor: pointer;
}
.et-sensor__mute-btn:hover { background-color: var(--color-surface-3); color: var(--color-text-primary); }
.et-sensor__mute-btn--active {
    background-color: color-mix(in srgb, var(--color-warning) 15%, transparent);
    border-color: var(--color-warning); color: var(--color-warning-text);
}

/* Editable config section */
.et-sensor__section {
    display: flex; flex-direction: column; gap: var(--space-1-5);
    border: 1px solid var(--color-border-default); border-radius: var(--radius-md); padding: var(--space-2);
}
.et-sensor__section-header {
    display: flex; align-items: center; gap: var(--space-1-5);
    font-size: var(--type-body); font-weight: var(--font-semibold);
    color: var(--color-text-tertiary); cursor: pointer; user-select: none;
}
.et-sensor__section-header:hover { color: var(--color-text-secondary); }
.et-sensor__row {
    display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: var(--space-1) 0;
}
.et-sensor__row-label { font-size: var(--type-body); color: var(--color-text-disabled); flex-shrink: 0; }
.et-sensor__num {
    width: 70px; padding: var(--space-1) var(--space-1-5); border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-default); background-color: var(--color-surface-3);
    color: var(--color-text-primary); font-size: var(--type-body); text-align: center;
}
.et-sensor__num:focus { outline: none; border-color: var(--color-primary); }
.et-sensor__unit { font-size: var(--type-body); color: var(--color-text-disabled); }
.et-sensor__text-input {
    flex: 1; min-width: 0; font-size: var(--type-body); color: var(--color-text-primary);
    background-color: var(--color-surface-2); border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm); padding: var(--space-1) var(--space-2);
}
.et-sensor__text-input:focus { outline: none; border-color: var(--color-primary); }
.et-sensor__select {
    font-size: var(--type-body); color: var(--color-text-primary);
    background-color: var(--color-surface-2); border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm); padding: var(--space-1) var(--space-2); cursor: pointer;
}

/* Read-only config */
.et-sensor__config { border-top: 1px solid var(--color-border-default); padding-top: var(--space-2); }
.et-sensor__config-row { display: flex; justify-content: space-between; padding: var(--space-1) 0; font-size: var(--type-body); }
.et-sensor__config-label { color: var(--color-text-tertiary); }
.et-sensor__config-value { color: var(--color-text-primary); font-weight: var(--font-medium); }

/* Error */
.et-sensor__error { display: flex; align-items: center; gap: var(--space-1-5); font-size: var(--type-body); color: var(--color-danger-text); }
</style>
