<template>
    <!-- 1×1: primary value + product name -->
    <CardShell
        v-if="size === '1x1'"
        type="service"
        :name="entity.name"
        :icon="serviceIcon"
        size="1x1"
        :is-on="isActive"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div v-if="primaryValue != null" class="ec-hv-wrap">
                <span class="ec-hv">{{ primaryDisplay }}</span>
                <span class="ec-hu">{{ primaryUnit }}</span>
            </div>
            <div v-else class="svc-status-pill" :class="isActive ? 'svc-status--on' : 'svc-status--off'">
                {{ isActive ? 'Active' : 'Idle' }}
            </div>
            <div class="svc-product-label">{{ serviceProps.productName }}</div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
        <template v-if="primaryToggleRole" #toggle>
            <CardToggle :is-on="isActive" :disabled="!canExecute" @toggle="togglePrimary" />
        </template>
    </CardShell>

    <!-- 2×1: primary + secondary values + controls -->
    <CardShell
        v-else-if="size === '2x1'"
        type="service"
        :name="entity.name"
        :icon="serviceIcon"
        size="2x1"
        :is-on="isActive"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="ec-wide-row">
                <div class="ec-wl">
                    <div v-if="primaryValue != null" class="ec-hv-wrap">
                        <span class="ec-hv">{{ primaryDisplay }}</span>
                        <span class="ec-hu">{{ primaryUnit }}</span>
                    </div>
                    <div class="svc-product-label">{{ serviceProps.productName }}</div>
                    <div class="svc-status-pill" :class="isActive ? 'svc-status--on' : 'svc-status--off'">
                        {{ statusLabel }}
                    </div>
                </div>
                <div class="ec-wr">
                    <!-- Show writable controls -->
                    <div v-for="res in writableResources.slice(0, 3)" :key="res.role" class="svc-control">
                        <button v-if="res.type === 'button'" class="ec-mode" :disabled="!canExecute" @click.stop="triggerButton(res.role)">
                            {{ res.name }}
                        </button>
                        <div v-else-if="res.view === 'toggle'" class="svc-toggle-row">
                            <span class="svc-toggle-label">{{ res.name }}</span>
                            <CardToggle :is-on="vcVal(res.role) === true" :disabled="!canExecute" @toggle="setVal(res.role, !(vcVal(res.role) === true))" />
                        </div>
                    </div>
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>

    <!-- 2×2: hero — all resources rendered dynamically -->
    <CardShell
        v-else
        type="service"
        :name="entity.name"
        :icon="serviceIcon"
        size="2x2"
        :is-on="isActive"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <!-- Product header -->
            <div class="svc-hero-header">
                <div class="svc-hero-name">{{ serviceProps.productName }}</div>
                <div class="svc-status-pill" :class="isActive ? 'svc-status--on' : 'svc-status--off'">{{ statusLabel }}</div>
            </div>

            <!-- Read-only sensors -->
            <div v-if="readableResources.length || objectResources.length" class="svc-sensors">
                <div v-for="res in readableResources" :key="res.role" class="svc-sensor">
                    <div class="svc-sensor-v">{{ formatVal(vcVal(res.role), res.unit) }}</div>
                    <div class="svc-sensor-l">{{ res.name }}</div>
                </div>
                <!-- Flattened object values (e.g. EV charger phase data) -->
                <template v-for="res in objectResources" :key="res.role">
                    <div v-for="item in flattenObject(res.role)" :key="item.label" class="svc-sensor">
                        <div class="svc-sensor-v">{{ item.value }}</div>
                        <div class="svc-sensor-l">{{ item.label }}</div>
                    </div>
                </template>
            </div>

            <!-- Writable controls -->
            <div class="svc-controls">
                <template v-for="res in writableResources" :key="res.role">
                    <!-- Toggle -->
                    <div v-if="res.view === 'toggle'" class="svc-ctrl-row">
                        <span class="svc-ctrl-label">{{ res.name }}</span>
                        <CardToggle :is-on="vcVal(res.role) === true" :disabled="!canExecute" @toggle="setVal(res.role, !(vcVal(res.role) === true))" />
                    </div>

                    <!-- Slider -->
                    <div v-else-if="res.view === 'slider'" class="svc-ctrl-row">
                        <span class="svc-ctrl-label">{{ res.name }}: {{ formatVal(vcVal(res.role), res.unit) }}</span>
                        <div class="svc-slider-row">
                            <button class="ec-adj-btn" :disabled="!canExecute" :aria-label="`Decrease ${res.name}`" @click.stop="adjustVal(res.role, -(res.step || 1))"><i class="fas fa-minus" /></button>
                            <input
                                type="range"
                                class="sld-r"
                                :min="res.min"
                                :max="res.max"
                                :step="res.step || 1"
                                :value="vcVal(res.role) ?? res.min"
                                :disabled="!canExecute"
                                @change="onSlider(res.role, $event)"
                                @click.stop
                            />
                            <button class="ec-adj-btn" :disabled="!canExecute" :aria-label="`Increase ${res.name}`" @click.stop="adjustVal(res.role, res.step || 1)"><i class="fas fa-plus" /></button>
                        </div>
                    </div>

                    <!-- Select / Enum -->
                    <div v-else-if="res.type === 'enum'" class="svc-ctrl-row">
                        <span class="svc-ctrl-label">{{ res.name }}</span>
                        <div class="ec-trv-modes">
                            <button
                                v-for="opt in res.options"
                                :key="opt.value"
                                class="ec-mode"
                                :class="{act: vcVal(res.role) === opt.value}"
                                :disabled="!canExecute"
                                @click.stop="setVal(res.role, opt.value)"
                            >{{ opt.label }}</button>
                        </div>
                    </div>

                    <!-- Button -->
                    <div v-else-if="res.type === 'button'" class="svc-ctrl-row">
                        <button class="ec-mode" :disabled="!canExecute" @click.stop="triggerButton(res.role)">
                            <i class="fas fa-play" style="font-size:var(--icon-size-2xs)" /> {{ res.name }}
                        </button>
                    </div>
                </template>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {useCardRpc} from '@/composables/useCardRpc';
import {useAuthStore} from '@/stores/auth';
import {useDevicesStore} from '@/stores/devices';
import type {entity_t} from '@/types';
import CardBadges from './CardBadges.vue';
import CardShell from './CardShell.vue';
import CardToggle from './CardToggle.vue';

interface ResourceDef {
    role: string;
    key: string;
    name: string;
    type: string; // boolean, number, enum, button, text, object
    view: string; // toggle, slider, label, button, select
    unit: string;
    min: number;
    max: number;
    step: number;
    access: string; // cr, crw, *
    options: Array<{value: string; label: string}> | null;
}

const props = withDefaults(
    defineProps<{
        entity: entity_t;
        size: '1x1' | '2x1' | '2x2';
        editMode?: boolean;
    }>(),
    {editMode: false}
);

defineEmits<{
    'open-detail': [];
    delete: [];
    'cycle-size': [];
}>();

const deviceStore = useDevicesStore();
const rpc = useCardRpc();
const authStore = useAuthStore();

const device = computed(() => deviceStore.devices[props.entity.source]);
const isOffline = computed(() => !device.value?.online);
const isSleeping = computed(() => !!device.value?.sleeping);
const canExecute = computed(() =>
    authStore.canExecuteDevice(props.entity.source)
);

const serviceProps = computed(() => {
    const p = props.entity.properties as any;
    return {
        serviceType: p?.serviceType ?? '',
        category: (p?.category ?? 'generic') as string,
        serviceKey: p?.serviceKey ?? 'service:0',
        productName: p?.productName ?? props.entity.name,
        components: (p?.components ?? {}) as Record<string, string>
    };
});

// Icon per backend-resolved category — no serviceType keyword scanning.
// Only icons confirmed working in this project's FA Pro build.
const SERVICE_CATEGORY_ICONS: Record<string, string> = {
    hvac: 'fas fa-temperature-arrow-up',
    valve: 'fas fa-pipe-valve',
    ev_charger: 'fas fa-charging-station',
    irrigation: 'fas fa-faucet-drip'
};

const serviceIcon = computed(() => {
    const icon = SERVICE_CATEGORY_ICONS[serviceProps.value.category];
    if (icon) return icon;
    // Generic services: entity components hint at the device type
    const components = serviceProps.value.components;
    if ('position' in components) return 'fas fa-pipe-valve';
    if (
        'current_temperature' in components ||
        'target_temperature' in components
    )
        return 'fas fa-temperature-arrow-up';
    if ('working_mode' in components) return 'fas fa-temperature-arrow-up';
    return 'fas fa-microchip';
});

// ── Resource introspection ─────────────────────────────────────────────

function vcVal(role: string): any {
    const key = serviceProps.value.components[role];
    if (!key || !device.value) return null;
    const s = deviceStore.statusOf(props.entity.source, key);
    return s?.value ?? null;
}

function vcConfig(role: string): any {
    const key = serviceProps.value.components[role];
    if (!key || !device.value) return null;
    return device.value.settings?.[key] ?? null;
}

const resources = computed((): ResourceDef[] => {
    const cmap = serviceProps.value.components;
    const result: ResourceDef[] = [];
    for (const [role, key] of Object.entries(cmap)) {
        const type = key.split(':')[0];
        const cfg = vcConfig(role);
        const view =
            cfg?.meta?.ui?.view ?? (type === 'button' ? 'button' : 'label');
        const unit = cfg?.meta?.ui?.unit ?? '';
        const min = cfg?.min ?? 0;
        const max = cfg?.max ?? 100;
        const step = cfg?.meta?.ui?.step ?? (type === 'number' ? 1 : 0);
        const access = cfg?.access ?? cfg?._attrs?.access ?? '*';
        const name = cfg?.name ?? role;

        let options: Array<{value: string; label: string}> | null = null;
        if (type === 'enum' && Array.isArray(cfg?.options)) {
            const titles = cfg?.meta?.ui?.titles ?? {};
            options = cfg.options.map((v: string) => ({
                value: v,
                label: titles[v] ?? v
            }));
        }

        result.push({
            role,
            key,
            name,
            type,
            view,
            unit,
            min,
            max,
            step,
            access,
            options
        });
    }
    return result;
});

// Writable = interactive controls (toggle, slider, select, button)
const writableResources = computed(() =>
    resources.value.filter(
        (r) =>
            r.type === 'button' ||
            r.view === 'toggle' ||
            r.view === 'slider' ||
            r.view === 'select' ||
            r.view === 'radio'
    )
);

// Readable = display-only values (view is 'label', not button/object)
const readableResources = computed(() =>
    resources.value.filter(
        (r) => r.view === 'label' && r.type !== 'button' && r.type !== 'object'
    )
);

// Object resources = nested data (e.g. EV charger phase_info)
const objectResources = computed(() =>
    resources.value.filter((r) => r.type === 'object')
);

// Primary toggle: first writable boolean
const primaryToggleRole = computed(
    () =>
        writableResources.value.find((r) => r.type === 'boolean')?.role ?? null
);

// Primary value: first readable number (sensor)
const primaryResource = computed(
    () => readableResources.value.find((r) => r.type === 'number') ?? null
);

const primaryValue = computed(() =>
    primaryResource.value ? vcVal(primaryResource.value.role) : null
);

const primaryDisplay = computed(() => {
    const v = primaryValue.value;
    if (v == null) return '—';
    return typeof v === 'number'
        ? Number.isInteger(v)
            ? String(v)
            : v.toFixed(1)
        : String(v);
});

const primaryUnit = computed(() => primaryResource.value?.unit ?? '');

const isActive = computed(() => {
    if (primaryToggleRole.value) return vcVal(primaryToggleRole.value) === true;
    // Check any enum for active states
    const enumRes = resources.value.find((r) => r.type === 'enum');
    if (enumRes) {
        const v = vcVal(enumRes.role);
        return (
            v != null &&
            !['off', 'idle', 'free', 'charger_free', 'stopped'].includes(v)
        );
    }
    return false;
});

const statusLabel = computed(() => {
    const enumRes = resources.value.find(
        (r) => r.type === 'enum' && !r.access.includes('w')
    );
    if (enumRes) {
        const v = vcVal(enumRes.role);
        const titles = enumRes.options;
        const match = titles?.find((o) => o.value === v);
        return match?.label ?? v ?? 'Unknown';
    }
    return isActive.value ? 'Active' : 'Idle';
});

// ── Formatting ─────────────────────────────────────────────────────────

function formatVal(value: any, unit: string): string {
    if (value == null) return '—';
    if (typeof value === 'boolean') return value ? 'On' : 'Off';
    if (typeof value === 'number') {
        const str = Number.isInteger(value) ? String(value) : value.toFixed(1);
        return unit ? `${str} ${unit}` : str;
    }
    if (typeof value === 'string') return unit ? `${value} ${unit}` : value;
    // Objects: extract the most useful top-level numeric values
    if (typeof value === 'object') return formatObject(value, unit);
    return String(value);
}

/** Format a nested object into a readable summary (e.g. EV charger phase_info) */
function formatObject(obj: Record<string, any>, unit: string): string {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'number' && v !== 0) {
            const label = k.replace(/_/g, ' ');
            parts.push(
                `${label}: ${Number.isInteger(v) ? v : (v as number).toFixed(1)}${unit ? ` ${unit}` : ''}`
            );
        }
    }
    return parts.length > 0 ? parts.join(', ') : '—';
}

/** Flatten object value into individual sensor readings for the 2x2 hero */
function flattenObject(role: string): Array<{label: string; value: string}> {
    const val = vcVal(role);
    if (val == null || typeof val !== 'object') return [];
    const cfg = vcConfig(role);
    const unit = cfg?.meta?.ui?.unit ?? '';
    const result: Array<{label: string; value: string}> = [];
    for (const [k, v] of Object.entries(val)) {
        if (typeof v === 'number') {
            result.push({
                label: k.replace(/_/g, ' '),
                value: formatVal(v, unit)
            });
        } else if (typeof v === 'object' && v !== null) {
            // One level deep (e.g. phase_a.voltage)
            for (const [k2, v2] of Object.entries(v as Record<string, any>)) {
                if (typeof v2 === 'number') {
                    result.push({
                        label: `${k.replace(/_/g, ' ')} ${k2}`,
                        value: formatVal(v2, '')
                    });
                }
            }
        }
    }
    return result;
}

// ── RPC commands ───────────────────────────────────────────────────────

function setVal(role: string, value: any) {
    const key = serviceProps.value.components[role];
    if (!key) return;
    rpc.invokeAction(props.entity.id, 'setVariable', {key, value});
}

function adjustVal(role: string, delta: number) {
    const res = resources.value.find((r) => r.role === role);
    if (!res) return;
    const current = vcVal(role) ?? res.min;
    const clamped = Math.max(res.min, Math.min(res.max, current + delta));
    setVal(role, clamped);
}

function triggerButton(role: string) {
    const key = serviceProps.value.components[role];
    if (!key) return;
    rpc.invokeAction(props.entity.id, 'trigger', {
        key,
        event: 'single_push'
    });
}

function togglePrimary() {
    if (primaryToggleRole.value) {
        setVal(primaryToggleRole.value, !isActive.value);
    }
}

function onSlider(role: string, e: Event) {
    const target = e.target as HTMLInputElement;
    setVal(role, Number(target.value));
}
</script>

<style scoped>
.svc-product-label {
    font-size: var(--type-body);
    color: var(--color-text-quaternary);
    margin-top: var(--space-0-5);
}
.svc-status-pill {
    display: inline-flex;
    align-items: center;
    font-size: var(--type-body);
    font-weight: 600;
    border-radius: var(--radius-xs);
    padding: 1px var(--space-1-5);
    margin-top: var(--space-1);
}
.svc-status--on { color: var(--color-success-text); background: rgba(var(--color-success-rgb),0.08); }
.svc-status--off { color: var(--color-text-quaternary); background: rgba(148,163,184,0.08); }

/* Hero header */
.svc-hero-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 var(--space-5);
    margin-bottom: var(--space-2);
}
.svc-hero-name {
    font-size: var(--type-subheading);
    font-weight: 600;
    color: var(--color-text-primary);
}

/* Sensors row */
.svc-sensors {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    padding: 0 var(--space-5);
    margin-bottom: var(--space-3);
}
.svc-sensor {
    min-width: 60px;
}
.svc-sensor-v {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
}
.svc-sensor-l {
    font-size: var(--type-body);
    color: var(--color-text-quaternary);
}

/* Controls section */
.svc-controls {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: 0 var(--space-5);
}
.svc-ctrl-row {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
.svc-ctrl-label {
    font-size: var(--type-body);
    font-weight: 500;
    color: var(--color-text-tertiary);
}

/* Slider row */
.svc-slider-row {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
}
.svc-slider-row .sld-r {
    flex: 1;
}

/* 2x1 controls */
.svc-control { margin-bottom: var(--space-1); }
.svc-toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-1-5);
}
.svc-toggle-label {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
</style>
