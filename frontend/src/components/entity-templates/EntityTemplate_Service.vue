<template>
    <div class="et-svc">
        <!-- Product header -->
        <div class="et-svc__header">
            <span class="et-svc__product">{{ productName }}</span>
            <span class="et-svc__type">{{ serviceType }}</span>
        </div>

        <!-- Read-only sensors -->
        <div v-if="sensors.length" class="et-svc__sensors">
            <div v-for="s in sensors" :key="s.role" class="et-svc__sensor-card">
                <span class="et-svc__sensor-v">{{ s.type === 'boolean' ? (s.value === true ? s.labelTrue : s.labelFalse) : formatValue(s.value, s.unit) }}</span>
                <span class="et-svc__sensor-l">{{ s.name }}</span>
            </div>
        </div>

        <!-- Object values (consumption counters, phase data, etc.) -->
        <div v-for="obj in objects" :key="obj.role" class="et-svc__section">
            <div class="et-svc__section-header"><i class="fas fa-chart-bar" /> {{ obj.name }}</div>
            <!-- Counter with total: show as single value -->
            <div v-if="getCounterTotal(obj.value) != null" class="et-svc__sensors">
                <div class="et-svc__sensor-card">
                    <span class="et-svc__sensor-v">{{ formatCounterValue(obj) }}</span>
                    <span class="et-svc__sensor-l">Total</span>
                </div>
            </div>
            <!-- Other objects: flatten -->
            <div v-else class="et-svc__sensors">
                <div v-for="item in flattenObj(obj.value)" :key="item.label" class="et-svc__sensor-card">
                    <span class="et-svc__sensor-v">{{ item.value }}</span>
                    <span class="et-svc__sensor-l">{{ item.label }}</span>
                </div>
            </div>
        </div>

        <!-- Controls -->
        <div v-if="controls.length" class="et-svc__section">
            <div class="et-svc__section-header"><i class="fas fa-sliders" /> Controls</div>

            <template v-for="c in controls" :key="c.role">
                <!-- Toggle -->
                <div v-if="c.view === 'toggle' || (c.type === 'boolean' && c.view !== 'label')" class="et-svc__row">
                    <span class="et-svc__row-label">{{ c.name }}</span>
                    <span class="et-svc__state" :class="c.value === true ? 'et-svc__state--on' : 'et-svc__state--off'">
                        {{ c.value === true ? (c.labelTrue || 'ON') : (c.labelFalse || 'OFF') }}
                    </span>
                    <button v-if="canExecute" class="et-svc__toggle" :class="c.value === true && 'et-svc__toggle--on'" @click="setVal(c.role, c.type, !c.value)">
                        <i class="fas fa-power-off" />
                    </button>
                </div>

                <!-- Slider / Field / Progressbar -->
                <div v-else-if="c.view === 'slider' || c.view === 'field' || c.view === 'progressbar'" class="et-svc__control">
                    <div class="et-svc__row-label">{{ c.name }} ({{ formatValue(c.value, c.unit) }})</div>
                    <div class="et-svc__slider-row">
                        <button class="et-svc__adj" :disabled="!canExecute" :title="`Decrease ${c.name}`" :aria-label="`Decrease ${c.name}`" @click="setVal(c.role, c.type, Math.max(c.min, (c.value ?? c.min) - (c.step || 1)))"><i class="fas fa-minus" /></button>
                        <input
                            type="range"
                            class="et-svc__range"
                            :min="c.min" :max="c.max" :step="c.step || 1"
                            :value="typeof c.value === 'number' ? c.value : c.min"
                            :disabled="!canExecute"
                            @change="(e: Event) => setVal(c.role, c.type, Number((e.target as HTMLInputElement).value))"
                            @click.stop
                        />
                        <button class="et-svc__adj" :disabled="!canExecute" :title="`Increase ${c.name}`" :aria-label="`Increase ${c.name}`" @click="setVal(c.role, c.type, Math.min(c.max, (c.value ?? c.min) + (c.step || 1)))"><i class="fas fa-plus" /></button>
                    </div>
                </div>

                <!-- Select / Enum -->
                <div v-else-if="c.type === 'enum'" class="et-svc__control">
                    <div class="et-svc__row-label">{{ c.name }}</div>
                    <div class="et-svc__pills">
                        <button
                            v-for="opt in c.options"
                            :key="opt.value"
                            class="et-svc__pill"
                            :class="c.value === opt.value && 'et-svc__pill--act'"
                            :disabled="!canExecute"
                            @click="setVal(c.role, c.type, opt.value)"
                        >{{ opt.label }}</button>
                    </div>
                </div>

                <!-- Button -->
                <div v-else-if="c.type === 'button'" class="et-svc__row">
                    <button v-if="canExecute" class="et-svc__action-btn" @click="triggerBtn(c.role)">
                        <i class="fas fa-play" /> {{ c.name }}
                    </button>
                    <span v-else class="et-svc__row-label">{{ c.name }}</span>
                </div>
            </template>
        </div>

        <!-- Status enum (read-only states like charger state) -->
        <div v-if="statusEnums.length" class="et-svc__section">
            <div class="et-svc__section-header"><i class="fas fa-info-circle" /> Status</div>
            <div v-for="s in statusEnums" :key="s.role" class="et-svc__row">
                <span class="et-svc__row-label">{{ s.name }}</span>
                <span class="et-svc__pill et-svc__pill--act" style="cursor:default">{{ s.displayValue }}</span>
            </div>
        </div>

        <!-- Service config (editable settings from Service.GetConfig) -->
        <div v-for="group in serviceConfigGroups" :key="group.title" class="et-svc__section">
            <div class="et-svc__section-header"><i class="fas fa-gear" /> {{ group.title }}</div>
            <template v-for="entry in group.entries" :key="entry.key">
                <!-- Select dropdown -->
                <div v-if="entry.type === 'select'" class="et-svc__config-block">
                    <div class="et-svc__config-header">
                        <span class="et-svc__row-label">{{ entry.label }}</span>
                        <select
                            class="et-svc__select"
                            :value="entry.value"
                            :disabled="!canExecute"
                            @change="(e: Event) => setServiceConfig(entry.key, (e.target as HTMLSelectElement).value)"
                        >
                            <option v-for="opt in entry.options" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                        </select>
                    </div>
                    <div v-if="entry.description" class="et-svc__config-desc">{{ entry.description }}</div>
                </div>

                <!-- Slider -->
                <div v-else-if="entry.type === 'slider'" class="et-svc__config-block">
                    <div class="et-svc__config-header">
                        <span class="et-svc__row-label">{{ entry.label }}</span>
                        <span class="et-svc__row-value">{{ entry.value }}{{ entry.unit ?? '' }}</span>
                    </div>
                    <div class="et-svc__slider-row">
                        <input
                            type="range"
                            class="et-svc__range"
                            :min="entry.min" :max="entry.max" :step="entry.step"
                            :value="entry.value"
                            :disabled="!canExecute"
                            @change="(e: Event) => setServiceConfig(entry.key, Number((e.target as HTMLInputElement).value))"
                            @click.stop
                        />
                    </div>
                    <div v-if="entry.description" class="et-svc__config-desc">{{ entry.description }}</div>
                </div>

                <!-- Range (min/max pair, e.g. alarm_temp_range) -->
                <div v-else-if="entry.type === 'range'" class="et-svc__config-block">
                    <div class="et-svc__config-header">
                        <span class="et-svc__row-label">{{ entry.label }}</span>
                    </div>
                    <div class="et-svc__range-inputs">
                        <div class="et-svc__range-field">
                            <span class="et-svc__range-lbl">Min</span>
                            <input
                                type="number"
                                class="et-svc__num-input"
                                :value="Array.isArray(entry.value) ? entry.value[0] : 0"
                                :min="entry.min" :max="entry.max"
                                :disabled="!canExecute"
                                @change="(e: Event) => setServiceConfig(entry.key, [Number((e.target as HTMLInputElement).value), Array.isArray(entry.value) ? entry.value[1] : 0])"
                            />
                        </div>
                        <div class="et-svc__range-field">
                            <span class="et-svc__range-lbl">Max</span>
                            <input
                                type="number"
                                class="et-svc__num-input"
                                :value="Array.isArray(entry.value) ? entry.value[1] : 0"
                                :min="entry.min" :max="entry.max"
                                :disabled="!canExecute"
                                @change="(e: Event) => setServiceConfig(entry.key, [Array.isArray(entry.value) ? entry.value[0] : 0, Number((e.target as HTMLInputElement).value)])"
                            />
                        </div>
                    </div>
                </div>

                <!-- Number input -->
                <div v-else-if="entry.type === 'number'" class="et-svc__config-block">
                    <div class="et-svc__config-header">
                        <span class="et-svc__row-label">{{ entry.label }}</span>
                        <input
                            type="number"
                            class="et-svc__num-input"
                            :value="entry.value"
                            :disabled="!canExecute"
                            @change="(e: Event) => setServiceConfig(entry.key, Number((e.target as HTMLInputElement).value))"
                        />
                    </div>
                    <div v-if="entry.description" class="et-svc__config-desc">{{ entry.description }}</div>
                </div>

                <!-- Text -->
                <div v-else class="et-svc__config-block">
                    <div class="et-svc__config-header">
                        <span class="et-svc__row-label">{{ entry.label }}</span>
                        <span class="et-svc__row-value">{{ entry.value }}</span>
                    </div>
                </div>
            </template>
        </div>

        <!-- Service info -->
        <div class="et-svc__section">
            <div class="et-svc__section-header"><i class="fas fa-microchip" /> Service</div>
            <div class="et-svc__row">
                <span class="et-svc__row-label">Type</span>
                <span class="et-svc__row-value">{{ serviceType }}</span>
            </div>
            <div v-if="serviceVer" class="et-svc__row">
                <span class="et-svc__row-label">Version</span>
                <span class="et-svc__row-value">{{ serviceVer }}</span>
            </div>
            <div class="et-svc__row">
                <span class="et-svc__row-label">State</span>
                <span class="et-svc__state" :class="serviceState === 'running' ? 'et-svc__state--on' : ''">{{ serviceState }}</span>
            </div>
            <div v-if="canExecute && hasResetCounters" class="et-svc__row">
                <span class="et-svc__row-label">Counters</span>
                <button class="et-svc__action-btn" @click="resetCounters">
                    <i class="fas fa-rotate-left" /> Reset
                </button>
            </div>
        </div>

        <div v-if="error" class="et-svc__error">
            <i class="fas fa-triangle-exclamation" /> {{ error }}
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';
import {sendRPC} from '@/tools/websocket';

// status/settings props are required by the EntityBoard contract but intentionally unused.
// Service entities span multiple virtual components — we read those directly from device.value.
const props = defineProps<{
    status: Record<string, any> | undefined;
    settings: Record<string, any> | undefined;
    canExecute: boolean;
    entityId?: string;
    shellyID?: string;
    entityProperties?: Record<string, any>;
}>();

const deviceStore = useDevicesStore();
const entityStore = useEntityStore();
const error = ref<string | null>(null);

const device = computed(() =>
    props.shellyID ? deviceStore.devices[props.shellyID] : null
);
const cmap = computed(
    () => (props.entityProperties?.components ?? {}) as Record<string, string>
);
const productName = computed(
    () => props.entityProperties?.productName ?? 'Service Device'
);
const serviceType = computed(() => props.entityProperties?.serviceType ?? '');
const serviceKey = computed(
    () => props.entityProperties?.serviceKey ?? 'service:0'
);
const serviceState = computed(
    () => device.value?.status?.[serviceKey.value]?.state ?? 'unknown'
);
const svcIndex = computed(() => serviceKey.value.split(':')[1] ?? '0');
const serviceVer = computed(
    () => device.value?.info?.[`svc${svcIndex.value}`]?.ver ?? ''
);

interface ResourceView {
    role: string;
    key: string;
    name: string;
    type: string;
    view: string;
    value: any;
    unit: string;
    min: number;
    max: number;
    step: number;
    labelTrue: string;
    labelFalse: string;
    options: Array<{value: string; label: string}>;
    displayValue: string;
}

const resources = computed((): ResourceView[] => {
    const result: ResourceView[] = [];
    for (const [role, key] of Object.entries(cmap.value)) {
        const type = key.split(':')[0];
        const cfg = device.value?.settings?.[key];
        const st = props.shellyID
            ? deviceStore.statusOf(props.shellyID, key)
            : null;
        const view =
            cfg?.meta?.ui?.view ?? (type === 'button' ? 'button' : 'label');
        const unit = cfg?.meta?.ui?.unit ?? '';
        const value = st?.value ?? null;
        const titles = cfg?.meta?.ui?.titles;

        let labelTrue = 'ON';
        let labelFalse = 'OFF';
        if (type === 'boolean' && Array.isArray(titles)) {
            labelFalse = titles[0] ?? 'OFF';
            labelTrue = titles[1] ?? 'ON';
        }

        let options: Array<{value: string; label: string}> = [];
        if (type === 'enum' && Array.isArray(cfg?.options)) {
            const t =
                typeof titles === 'object' && !Array.isArray(titles)
                    ? titles
                    : {};
            options = cfg.options.map((v: string) => ({
                value: v,
                label: t[v] ?? v
            }));
        }

        const displayValue =
            type === 'enum' &&
            typeof titles === 'object' &&
            !Array.isArray(titles)
                ? (titles[value] ?? value ?? '—')
                : String(value ?? '—');

        result.push({
            role,
            key,
            name: cfg?.name ?? role,
            type,
            view,
            value,
            unit,
            min: cfg?.min ?? 0,
            max: cfg?.max ?? 100,
            step: cfg?.meta?.ui?.step ?? (type === 'number' ? 1 : 0),
            labelTrue,
            labelFalse,
            options,
            displayValue
        });
    }
    return result;
});

// Sensors = read-only number/boolean with view=label
const sensors = computed(() =>
    resources.value.filter(
        (r) =>
            r.view === 'label' && (r.type === 'number' || r.type === 'boolean')
    )
);

// Objects = object type (nested data like phase_info)
const objects = computed(() =>
    resources.value.filter((r) => r.type === 'object')
);

// Controls = interactive (toggle, slider, field, dropdown, button)
const controls = computed(() =>
    resources.value.filter(
        (r) =>
            r.view === 'toggle' ||
            r.view === 'slider' ||
            r.view === 'field' ||
            r.view === 'progressbar' ||
            r.type === 'button' ||
            (r.type === 'enum' && r.view !== 'label')
    )
);

// Status enums = read-only enums (view=label)
const statusEnums = computed(() =>
    resources.value.filter((r) => r.type === 'enum' && r.view === 'label')
);

function formatValue(value: any, unit: string): string {
    if (value == null) return '—';
    if (typeof value === 'boolean') return value ? 'On' : 'Off';
    if (typeof value === 'number') {
        const str = Number.isInteger(value) ? String(value) : value.toFixed(1);
        return unit ? `${str} ${unit}` : str;
    }
    return unit ? `${value} ${unit}` : String(value);
}

function formatTimestamp(ts: number): string {
    if (!ts) return '—';
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

function getCounterTotal(value: any): number | null {
    const total = value?.counter?.total;
    return typeof total === 'number' ? total : null;
}

// Standard unit conversions (physics constants, not device-specific)
const UNIT_FACTORS: Record<
    string,
    Record<string, {factor: number; label: string}>
> = {
    m3: {
        m3: {factor: 1, label: 'm³'},
        lit: {factor: 1000, label: 'L'},
        gal: {factor: 264.172, label: 'gal'},
        ft3: {factor: 35.3147, label: 'ft³'}
    },
    kPa: {
        kPa: {factor: 1, label: 'kPa'},
        PSI: {factor: 0.145038, label: 'PSI'},
        bar: {factor: 0.01, label: 'bar'}
    }
};

function formatCounterValue(obj: ResourceView): string {
    const total = getCounterTotal(obj.value);
    if (total == null) return '—';
    // Base unit from object config
    const compKey = cmap.value[obj.role];
    const baseUnit = compKey
        ? (device.value?.settings?.[compKey]?.meta?.ui?.unit ?? '')
        : '';
    // Check if user selected a different display unit in service config
    const svcCfg = device.value?.settings?.[serviceKey.value] ?? {};
    const conversions = UNIT_FACTORS[baseUnit];
    if (conversions) {
        for (const val of Object.values(svcCfg)) {
            if (typeof val === 'string' && val in conversions) {
                const conv = conversions[val];
                const converted = total * conv.factor;
                return `${converted >= 100 ? converted.toFixed(1) : converted.toFixed(3)} ${conv.label}`;
            }
        }
    }
    return formatValue(total, baseUnit);
}

function flattenObj(value: any): Array<{label: string; value: string}> {
    if (value == null || typeof value !== 'object') return [];
    const result: Array<{label: string; value: string}> = [];
    for (const [k, v] of Object.entries(value)) {
        if (k.endsWith('_ts') && typeof v === 'number') {
            result.push({
                label: k.replace(/_ts$/, '').replace(/_/g, ' '),
                value: formatTimestamp(v)
            });
        } else if (typeof v === 'number') {
            result.push({
                label: k.replace(/_/g, ' '),
                value: formatValue(v, '')
            });
        } else if (Array.isArray(v)) {
            // by_minute arrays etc — skip (not useful in display)
        } else if (typeof v === 'object' && v !== null) {
            for (const [k2, v2] of Object.entries(v as Record<string, any>)) {
                if (k2.endsWith('_ts') && typeof v2 === 'number') {
                    result.push({
                        label: `${k.replace(/_/g, ' ')} ${k2.replace(/_ts$/, '')}`,
                        value: formatTimestamp(v2)
                    });
                } else if (typeof v2 === 'number') {
                    result.push({
                        label: `${k.replace(/_/g, ' ')} ${k2.replace(/_/g, ' ')}`,
                        value: formatValue(v2, '')
                    });
                }
            }
        }
    }
    return result;
}

// ── Service config (Service.SetConfig settings) ───────────────────────

interface ConfigEntry {
    key: string;
    label: string;
    description: string;
    value: any;
    type: 'select' | 'slider' | 'number' | 'text' | 'range';
    options?: Array<{value: string; label: string}>;
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
}

const SKIP_CONFIG_KEYS = new Set(['id', 'name']);

// Dynamic config options from Service.ListConfigOptions (stored by backend in service:0._configOptions)
const deviceConfigOptions = computed(
    (): Array<{
        key: string;
        options?: string[];
        range?: {min: number; max: number};
    }> => device.value?.settings?.[serviceKey.value]?._configOptions ?? []
);

// Group related config entries into sections dynamically
// e.g. temp_unit + alarm_temp_range + alarm_temp_action → one group
interface ConfigGroup {
    title: string;
    entries: ConfigEntry[];
}

const serviceConfigGroups = computed((): ConfigGroup[] => {
    const cfg = device.value?.settings?.[serviceKey.value];
    if (!cfg || typeof cfg !== 'object') return [];

    const optionsMap = new Map<
        string,
        {options?: string[]; range?: {min: number; max: number}}
    >();
    for (const prop of deviceConfigOptions.value) {
        optionsMap.set(prop.key, prop);
    }

    // Collect all config entries
    const allEntries = new Map<string, ConfigEntry>();
    for (const [key, value] of Object.entries(cfg)) {
        if (SKIP_CONFIG_KEYS.has(key)) continue;
        if (key.startsWith('_')) continue;
        const label = key
            .replace(/_/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase());
        const dynOpts = optionsMap.get(key);

        if (dynOpts?.options) {
            allEntries.set(key, {
                key,
                label,
                description: '',
                value,
                type: 'select',
                options: dynOpts.options.map((v) => ({value: v, label: v}))
            });
        } else if (
            Array.isArray(value) &&
            value.length === 2 &&
            typeof value[0] === 'number'
        ) {
            const rangeDef = optionsMap.get(key);
            allEntries.set(key, {
                key,
                label,
                description: '',
                value,
                type: 'range',
                min: rangeDef?.range?.min ?? Math.min(0, value[0]),
                max: rangeDef?.range?.max ?? Math.max(100, value[1])
            });
        } else if (typeof value === 'number') {
            allEntries.set(key, {
                key,
                label,
                description: '',
                value,
                type: 'number'
            });
        } else if (typeof value === 'string') {
            allEntries.set(key, {
                key,
                label,
                description: '',
                value,
                type: 'text'
            });
        }
    }

    // Group by prefix: alarm_temp_range + alarm_temp_action → "alarm_temp" group
    // Standalone keys go to "General" group
    const groups = new Map<string, ConfigEntry[]>();
    const used = new Set<string>();

    // Find alarm groups first (alarm_*_range + alarm_*_action)
    for (const key of allEntries.keys()) {
        const alarmMatch = key.match(/^alarm_(.+)_(range|action)$/);
        if (alarmMatch) {
            const groupKey = `alarm_${alarmMatch[1]}`;
            if (!groups.has(groupKey)) groups.set(groupKey, []);
            groups.get(groupKey)!.push(allEntries.get(key)!);
            used.add(key);
        }
    }

    // Remaining entries go to General
    const general: ConfigEntry[] = [];
    for (const [key, entry] of allEntries) {
        if (!used.has(key)) general.push(entry);
    }

    // Build final groups
    const result: ConfigGroup[] = [];
    if (general.length) {
        result.push({title: 'General', entries: general});
    }
    for (const [groupKey, entries] of groups) {
        // Derive title from group key: alarm_temp → Temperature Alarm
        const subject = groupKey
            .replace(/^alarm_/, '')
            .replace(/_/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase());
        result.push({title: `${subject} Alarm`, entries});
    }
    return result;
});

async function setServiceConfig(key: string, value: any) {
    if (!props.shellyID) return;
    error.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Service.SetConfig', {
            shellyID: props.shellyID,
            id: Number.parseInt(serviceKey.value.split(':')[1] ?? '0', 10),
            config: {[key]: value}
        });
    } catch (e: any) {
        error.value = e.message || 'Service.SetConfig failed';
    }
}

// ── Command dispatch ───────────────────────────────────────────────────

// Service.ResetCounters — capability detected from ListMethods in backend
const hasResetCounters = computed(
    () => !!device.value?.capabilities?.serviceResetCounters
);

async function resetCounters() {
    if (!props.shellyID || !confirm('Reset all counters to zero?')) return;
    error.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Service.ResetCounters', {
            shellyID: props.shellyID,
            id: Number.parseInt(svcIndex.value, 10)
        });
    } catch (e: any) {
        error.value = e.message || 'Service.ResetCounters failed';
    }
}

const WRITABLE_VIRTUAL_TYPES = new Set(['boolean', 'number', 'enum', 'text']);

async function setVal(role: string, type: string, value: any) {
    const key = cmap.value[role];
    if (!key || !props.entityId || !WRITABLE_VIRTUAL_TYPES.has(type)) return;
    error.value = null;
    try {
        await entityStore.invokeAction(props.entityId, 'setVariable', {
            key,
            value
        });
    } catch (e: any) {
        error.value = e.message || `${type}.Set failed`;
    }
}

async function triggerBtn(role: string) {
    const key = cmap.value[role];
    if (!key || !props.entityId) return;
    error.value = null;
    try {
        await entityStore.invokeAction(props.entityId, 'trigger', {
            key,
            event: 'single_push'
        });
    } catch (e: any) {
        error.value = e.message || 'Button.Trigger failed';
    }
}
</script>

<style scoped>
.et-svc { display: flex; flex-direction: column; gap: var(--space-2); }

/* Header */
.et-svc__header { display: flex; justify-content: space-between; align-items: center; }
.et-svc__product { font-size: var(--type-body); font-weight: var(--font-bold); color: var(--color-text-primary); }
.et-svc__type { font-size: var(--type-body); color: var(--color-text-disabled); }

/* Sensors grid */
.et-svc__sensors { display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: var(--space-1-5); }
.et-svc__sensor-card { display: flex; flex-direction: column; align-items: center; padding: var(--space-2); border-radius: var(--radius-md); background-color: var(--color-surface-2); }
.et-svc__sensor-v { font-size: var(--type-body); font-weight: var(--font-bold); color: var(--color-text-primary); font-variant-numeric: tabular-nums; }
.et-svc__sensor-l { font-size: var(--type-body); color: var(--color-text-disabled); text-align: center; }

/* Sections */
.et-svc__section { border-top: 1px solid var(--color-border-default); padding-top: var(--space-2); display: flex; flex-direction: column; gap: var(--space-1-5); }
.et-svc__section-header { display: flex; align-items: center; gap: var(--space-2); font-size: var(--type-body); font-weight: var(--font-semibold); color: var(--color-text-secondary); }

/* Rows */
.et-svc__row { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-1) 0; }
.et-svc__row-label { font-size: var(--type-body); color: var(--color-text-tertiary); flex: 1; }
.et-svc__row-value { font-size: var(--type-body); font-weight: var(--font-medium); color: var(--color-text-primary); }
.et-svc__state { font-size: var(--type-body); font-weight: var(--font-bold); }
.et-svc__state--on { color: var(--color-success-text); }
.et-svc__state--off { color: var(--color-text-disabled); }

/* Toggle button */
.et-svc__toggle {
    width: 36px; height: 36px; border-radius: var(--radius-full);
    display: flex; align-items: center; justify-content: center;
    font-size: var(--type-body); cursor: pointer;
    border: 1px solid var(--color-border-default);
    background-color: var(--color-surface-3); color: var(--color-text-tertiary);
}
.et-svc__toggle:hover { color: var(--color-text-primary); }
.et-svc__toggle--on { background-color: var(--color-success); border-color: var(--color-success); color: var(--color-text-primary); }

/* Control block */
.et-svc__control { display: flex; flex-direction: column; gap: var(--space-1); }

/* Slider row */
.et-svc__slider-row { display: flex; align-items: center; gap: var(--space-1-5); }
.et-svc__range { flex: 1; cursor: pointer; }
.et-svc__range:disabled { cursor: not-allowed; opacity: 0.5; }
.et-svc__adj {
    width: 28px; height: 28px; border-radius: var(--radius-full);
    display: flex; align-items: center; justify-content: center;
    font-size: var(--type-body); cursor: pointer;
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-2); color: var(--color-text-tertiary);
}
.et-svc__adj:hover { color: var(--color-text-primary); }
.et-svc__adj:disabled { opacity: 0.4; cursor: not-allowed; }

/* Pill buttons (enum selector) */
.et-svc__pills { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.et-svc__pill {
    padding: var(--space-1) 0.625rem; border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-default); background: var(--color-surface-2);
    color: var(--color-text-tertiary); font-size: var(--type-body); font-weight: var(--font-semibold);
    cursor: pointer;
}
.et-svc__pill:hover { color: var(--color-text-primary); border-color: var(--color-text-tertiary); }
.et-svc__pill--act { background: var(--color-primary-subtle); border-color: var(--color-primary); color: var(--color-primary); }

/* Action button */
.et-svc__action-btn {
    display: flex; align-items: center; gap: var(--space-2);
    padding: var(--space-1-5) var(--space-3); border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default); background: var(--color-surface-2);
    color: var(--color-text-secondary); font-size: var(--type-body); font-weight: var(--font-semibold);
    cursor: pointer;
}
.et-svc__action-btn:hover { background: var(--color-surface-3); color: var(--color-text-primary); }

/* Config blocks */
.et-svc__config-block { display: flex; flex-direction: column; gap: var(--space-0-5); padding: var(--space-1) 0; }
.et-svc__config-header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
.et-svc__config-desc { font-size: var(--type-body); color: var(--color-text-disabled); }

/* Config select / input */
.et-svc__select {
    padding: 0.2rem 0.4rem; border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-default); background: var(--color-surface-2);
    color: var(--color-text-primary); font-size: var(--type-body); font-weight: var(--font-medium); cursor: pointer;
}
.et-svc__num-input {
    width: 72px; padding: 0.2rem 0.4rem; border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-default); background: var(--color-surface-2);
    color: var(--color-text-primary); font-size: var(--type-body); text-align: right;
}

/* Range min/max inputs */
.et-svc__range-inputs { display: flex; gap: var(--space-3); }
.et-svc__range-field { display: flex; align-items: center; gap: var(--space-1); flex: 1; }
.et-svc__range-lbl { font-size: var(--type-body); color: var(--color-text-disabled); min-width: 28px; }

/* Error */
.et-svc__error { font-size: var(--type-body); color: var(--color-danger-text); display: flex; align-items: center; gap: var(--space-1); }
</style>
