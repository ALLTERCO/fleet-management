<template>
    <!-- 1×1: target/current temp + mode indicator + toggle -->
    <CardShell
        v-if="size === '1x1'"
        type="service"
        :name="entity.name"
        icon="fas fa-temperature-arrow-up"
        size="1x1"
        :is-on="isEnabled"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="ec-dual">
                <div class="ec-dual-item">
                    <div class="ec-dv">{{ targetTempDisplay }}°</div>
                    <div class="ec-dl">Target</div>
                </div>
                <div class="ec-dsep" />
                <div class="ec-dual-item">
                    <div class="ec-dv">{{ currentTempDisplay }}°</div>
                    <div class="ec-dl">Current</div>
                </div>
            </div>
            <div class="hvac-mode-pill">
                <i :class="modeIcon" />
                <span>{{ modeLabel }}</span>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
        <template #toggle>
            <CardToggle :is-on="isEnabled" :disabled="!canExecute" @toggle="toggleEnable" />
        </template>
    </CardShell>

    <!-- 2×1: left temps + right mode/fan + adjust -->
    <CardShell
        v-else-if="size === '2x1'"
        type="service"
        :name="entity.name"
        icon="fas fa-temperature-arrow-up"
        size="2x1"
        :is-on="isEnabled"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="ec-wide-row">
                <div class="ec-wl">
                    <div class="ec-trv-target">{{ targetTempDisplay }}<span>°</span></div>
                    <div class="ec-trv-cur-sm">{{ currentTempDisplay }}° current</div>
                    <div class="hvac-mode-pill">
                        <i :class="modeIcon" />
                        <span>{{ modeLabel }}</span>
                        <span class="hvac-fan-tag"><i class="fas fa-fan" /> {{ fanLabel }}</span>
                    </div>
                </div>
                <div class="ec-wr">
                    <div class="ec-modes">
                        <button v-for="m in modeOptions" :key="m.value" class="ec-mode" :class="{act: workingMode === m.value}" :disabled="!canExecute" @click.stop="setMode(m.value)">{{ m.label }}</button>
                    </div>
                    <div class="ec-adj">
                        <button class="ec-adj-btn" :disabled="!canExecute" aria-label="Decrease" @click.stop="adjustTarget(-tempStep)"><i class="fas fa-minus" /></button>
                        <button class="ec-adj-btn" :disabled="!canExecute" aria-label="Increase" @click.stop="adjustTarget(tempStep)"><i class="fas fa-plus" /></button>
                    </div>
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
        <template #toggle>
            <CardToggle :is-on="isEnabled" :disabled="!canExecute" @toggle="toggleEnable" />
        </template>
    </CardShell>

    <!-- 2×2: hero — full controls -->
    <CardShell
        v-else
        type="service"
        :name="entity.name"
        icon="fas fa-temperature-arrow-up"
        size="2x2"
        :is-on="isEnabled"
        :is-offline="isOffline" :is-sleeping="isSleeping"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <!-- Hero temps -->
            <div class="ec-trv-hero-temps">
                <div class="ec-trv-hero-set">
                    <div class="ec-trv-hero-set-v">{{ targetTempDisplay }}<span>°</span></div>
                    <div class="ec-trv-hero-set-l">TARGET</div>
                </div>
                <div class="ec-trv-hero-now">
                    <div class="ec-trv-hero-now-v">{{ currentTempDisplay }}<span>°</span></div>
                    <div class="ec-trv-hero-now-l">CURRENT</div>
                </div>
            </div>

            <!-- Controls zone -->
            <div class="ec-trv-hero-controls">
                <!-- Temperature presets + adjust -->
                <div class="ec-trv-presets">
                    <button
                        v-for="p in tempPresets"
                        :key="p"
                        class="ec-tv"
                        :class="{act: Math.abs(targetTemp - p) < 0.5}"
                        :disabled="!canExecute"
                        @click.stop="setTarget(p)"
                    >{{ p }}°</button>
                </div>
                <div class="ec-trv-adj">
                    <button class="ec-adj-btn" :disabled="!canExecute" aria-label="Decrease" @click.stop="adjustTarget(-tempStep)"><i class="fas fa-minus" /></button>
                    <button class="ec-adj-btn" :disabled="!canExecute" aria-label="Increase" @click.stop="adjustTarget(tempStep)"><i class="fas fa-plus" /></button>
                </div>

                <!-- Working mode -->
                <div class="hvac-section-label">Mode</div>
                <div class="ec-trv-modes">
                    <button
                        v-for="m in modeOptions"
                        :key="m.value"
                        class="ec-mode"
                        :class="{act: workingMode === m.value}"
                        :disabled="!canExecute"
                        @click.stop="setMode(m.value)"
                    >
                        <i :class="getModeIcon(m.value)" class="hvac-mode-icon" />
                        {{ m.label }}
                    </button>
                </div>

                <!-- Fan speed -->
                <div class="hvac-section-label">Fan</div>
                <div class="ec-trv-modes">
                    <button
                        v-for="f in fanOptions"
                        :key="f.value"
                        class="ec-mode"
                        :class="{act: fanSpeed === f.value}"
                        :disabled="!canExecute"
                        @click.stop="setFan(f.value)"
                    >
                        <i class="fas fa-fan hvac-mode-icon" />
                        {{ f.label }}
                    </button>
                </div>

                <!-- Humidity row -->
                <div class="hvac-humidity-row">
                    <div class="hvac-hum-reading"><i class="fas fa-droplet" /> {{ humidityDisplay }}%</div>
                    <div v-if="hasTargetHumidity" class="hvac-hum-target">
                        <span class="hvac-hum-label">Target:</span>
                        <button class="ec-adj-btn" :disabled="!canExecute" aria-label="Decrease target humidity" @click.stop="adjustHumidity(-5)"><i class="fas fa-minus" /></button>
                        <span class="hvac-hum-val">{{ targetHumDisplay }}%</span>
                        <button class="ec-adj-btn" :disabled="!canExecute" aria-label="Increase target humidity" @click.stop="adjustHumidity(5)"><i class="fas fa-plus" /></button>
                    </div>
                </div>
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

// Component key map from entity properties (set by EntityComposer)
// Maps resource names → full component keys (e.g. "enable_thermostat" → "boolean:201")
const cmap = computed(
    () =>
        (props.entity.properties as any)?.components as
            | Record<string, string>
            | undefined
);

// Read virtual component status by resource name (effective: real + overlay)
function vcStatus(resource: string): any {
    const key = cmap.value?.[resource];
    if (!key || !device.value) return null;
    return deviceStore.statusOf(props.entity.source, key) ?? null;
}

// Read virtual component config by resource name
function vcConfig(resource: string): any {
    const key = cmap.value?.[resource];
    if (!key || !device.value) return null;
    return device.value.settings?.[key] ?? null;
}

// ── Status values ──────────────────────────────────────────────────────

// Resource names come from Service.GetResources (canonical, not hardcoded)
const isEnabled = computed(() => vcStatus('enable')?.value === true);
const targetTemp = computed(() => vcStatus('target_temperature')?.value ?? 20);
const currentTemp = computed(
    () => vcStatus('current_temperature')?.value ?? null
);
const currentHumidity = computed(
    () => vcStatus('current_humidity')?.value ?? null
);
const targetHumidity = computed(
    () => vcStatus('target_humidity')?.value ?? null
);
const hasTargetHumidity = computed(() => cmap.value?.target_humidity != null);
const workingMode = computed(() => vcStatus('working_mode')?.value ?? 'cool');
const fanSpeed = computed(() => vcStatus('fan_speed')?.value ?? 'auto');
const antiFreeze = computed(() => vcStatus('anti_freeze')?.value === true);

const targetTempDisplay = computed(() =>
    targetTemp.value != null ? Number(targetTemp.value).toFixed(1) : '—'
);
const currentTempDisplay = computed(() =>
    currentTemp.value != null ? Number(currentTemp.value).toFixed(1) : '—'
);
const humidityDisplay = computed(() =>
    currentHumidity.value != null ? String(currentHumidity.value) : '—'
);
const targetHumDisplay = computed(() =>
    targetHumidity.value != null ? String(targetHumidity.value) : '—'
);

// ── Mode/Fan display ───────────────────────────────────────────────────

const MODE_ICONS: Record<string, string> = {
    cool: 'fas fa-snowflake',
    heat: 'fas fa-fire',
    dry: 'fas fa-droplet',
    ventilation: 'fas fa-fan',
    auto: 'fas fa-rotate'
};

function getModeIcon(mode: string): string {
    return MODE_ICONS[mode] ?? 'fas fa-question';
}

const modeIcon = computed(() => getModeIcon(workingMode.value));

const modeLabel = computed(() => {
    if (!isEnabled.value) return 'Off';
    const cfg = vcConfig('working_mode');
    const titles = cfg?.meta?.ui?.titles;
    return titles?.[workingMode.value] ?? workingMode.value;
});

const fanLabel = computed(() => {
    const cfg = vcConfig('fan_speed');
    const titles = cfg?.meta?.ui?.titles;
    return titles?.[fanSpeed.value] ?? fanSpeed.value;
});

// Options from device config (dynamic, not hardcoded)
const modeOptions = computed(() => {
    const cfg = vcConfig('working_mode');
    const options: string[] = cfg?.options ?? [
        'cool',
        'heat',
        'dry',
        'ventilation'
    ];
    const titles = cfg?.meta?.ui?.titles ?? {};
    return options.map((v) => ({value: v, label: titles[v] ?? v}));
});

const fanOptions = computed(() => {
    const cfg = vcConfig('fan_speed');
    const options: string[] = cfg?.options ?? ['auto', 'low', 'medium', 'high'];
    const titles = cfg?.meta?.ui?.titles ?? {};
    return options.map((v) => ({value: v, label: titles[v] ?? v}));
});

const tempPresets = [18, 20, 22, 24];

// Read step from device config, fallback 0.5
const tempStep = computed(
    () => vcConfig('target_temperature')?.meta?.ui?.step ?? 0.5
);

// ── RPC commands — all use standard virtual component RPCs ─────────────

function setVirtualValue(resource: string, value: any) {
    const key = cmap.value?.[resource];
    if (!key) return;
    rpc.invokeAction(props.entity.id, 'setVariable', {key, value});
}

function toggleEnable() {
    setVirtualValue('enable', !isEnabled.value);
}

function setTarget(value: number) {
    const cfg = vcConfig('target_temperature');
    const min = cfg?.min ?? 5;
    const max = cfg?.max ?? 35;
    setVirtualValue('target_temperature', Math.max(min, Math.min(max, value)));
}

function adjustTarget(delta: number) {
    setTarget(targetTemp.value + delta);
}

function setMode(mode: string) {
    setVirtualValue('working_mode', mode);
}

function setFan(speed: string) {
    setVirtualValue('fan_speed', speed);
}

function adjustHumidity(delta: number) {
    const cfg = vcConfig('target_humidity');
    const min = cfg?.min ?? 40;
    const max = cfg?.max ?? 75;
    const current = targetHumidity.value ?? 50;
    setVirtualValue(
        'target_humidity',
        Math.max(min, Math.min(max, current + delta))
    );
}
</script>

<style scoped>
/* Mode indicator pill (1x1, 2x1) */
.hvac-mode-pill {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin-top: var(--space-1-5);
    font-size: var(--type-body);
    font-weight: 700;
    color: var(--color-text-tertiary);
}
.hvac-mode-pill i { font-size: var(--icon-size-2xs); /* icon-only */ }

/* Fan tag inline with mode pill */
.hvac-fan-tag {
    font-weight: 600;
    color: var(--color-text-quaternary);
    margin-left: var(--space-1);
}
.hvac-fan-tag i { font-size: var(--icon-size-2xs); margin-right: var(--space-0-5); /* icon-only */ }

/* Section labels for 2x2 mode/fan groups */
.hvac-section-label {
    font-size: var(--type-body);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-disabled);
    padding: var(--space-1) 0 var(--space-0-5);
}

/* Mode button icon sizing */
.hvac-mode-icon { font-size: var(--icon-size-2xs); /* icon-only */ }

/* Humidity controls row (2x2) */
.hvac-humidity-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-1-5) 0 0;
    gap: var(--space-2);
}
.hvac-hum-reading {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-tertiary);
}
.hvac-hum-reading i {
    font-size: var(--icon-size-2xs); /* icon-only */
    color: var(--color-primary);
    margin-right: var(--space-1);
}
.hvac-hum-target {
    display: flex;
    align-items: center;
    gap: var(--space-1);
}
.hvac-hum-label {
    font-size: var(--type-body);
    color: var(--color-text-quaternary);
}
.hvac-hum-val {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-secondary);
    min-width: 28px;
    text-align: center;
}
</style>
