<template>
    <!-- 1×1: target + current + state -->
    <CardShell
        v-if="size === '1x1'"
        type="thermostat"
        :name="entity.name"
        icon="fas fa-temperature-arrow-up"
        size="1x1"
        :is-on="isHeating"
        :is-offline="isOffline"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="wd-1x1">
                <div class="wd-temps">
                    <div class="wd-temp-item">
                        <div class="wd-temp-v">{{ targetDisplay }}°</div>
                        <div class="wd-temp-l">Target</div>
                    </div>
                    <div class="wd-sep" />
                    <div class="wd-temp-item">
                        <div class="wd-temp-v">{{ currentDisplay }}°</div>
                        <div class="wd-temp-l">Current</div>
                    </div>
                </div>
                <div class="wd-state">
                    <i :class="stateIcon" :style="{color: stateColor}" />
                    <span class="wd-state-label" :style="{color: stateColor}">{{ stateLabel }}</span>
                    <span v-if="humidity != null" class="wd-humidity"><i class="fas fa-droplet" /> {{ humidity }}%</span>
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

    <!-- 2×1: target + current + presets + mode toggle + adjust -->
    <CardShell
        v-else-if="size === '2x1'"
        type="thermostat"
        :name="entity.name"
        icon="fas fa-temperature-arrow-up"
        size="2x1"
        :is-on="isHeating"
        :is-offline="isOffline"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="wd-wide">
                <div class="wd-wide-left">
                    <div class="wd-target">{{ targetDisplay }}<span>°</span></div>
                    <div class="wd-cur-sm">{{ currentDisplay }}° current</div>
                    <div class="wd-state">
                        <i :class="stateIcon" :style="{color: stateColor}" />
                        <span class="wd-state-label" :style="{color: stateColor}">{{ stateLabel }}</span>
                        <span class="wd-type-label">{{ modeLabel }}</span>
                    </div>
                </div>
                <div class="wd-wide-right">
                    <div class="wd-presets">
                        <button v-for="p in presets" :key="p" class="wd-preset" :class="{act: target === p}" :disabled="!canExecute" @click.stop="setTarget(p)">{{ p }}°</button>
                    </div>
                    <div class="wd-modes">
                        <button class="wd-mode" :class="{act: !isEnabled}" :disabled="!canExecute" @click.stop="toggleEnable">Off</button>
                        <button class="wd-mode" :class="{act: isEnabled}" :disabled="!canExecute" @click.stop="enableThermostat">{{ modeLabel }}</button>
                    </div>
                    <div class="wd-adj">
                        <button class="wd-adj-btn" :disabled="!canExecute" aria-label="Decrease target" @click.stop="decreaseTarget"><i class="fas fa-minus" /></button>
                        <button class="wd-adj-btn" :disabled="!canExecute" aria-label="Increase target" @click.stop="increaseTarget"><i class="fas fa-plus" /></button>
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

    <!-- 2×2: hero temps + controls + env data -->
    <CardShell
        v-else
        type="thermostat"
        :name="entity.name"
        icon="fas fa-temperature-arrow-up"
        size="2x2"
        :is-on="isHeating"
        :is-offline="isOffline"
        :edit-mode="editMode"
        @open-detail="$emit('open-detail')"
        @delete="$emit('delete')" @cycle-size="$emit('cycle-size')"
    >
        <template #default>
            <div class="wd-hero-temps">
                <div class="wd-hero-set">
                    <div class="wd-hero-set-v">{{ targetDisplay }}<span>°</span></div>
                    <div class="wd-hero-set-l">TARGET</div>
                </div>
                <div class="wd-hero-now">
                    <div class="wd-hero-now-v">{{ currentDisplay }}<span>°</span></div>
                    <div class="wd-hero-now-l">CURRENT</div>
                </div>
            </div>

            <div class="wd-hero-controls">
                <div class="wd-presets">
                    <button v-for="p in presets" :key="p" class="wd-preset" :class="{act: target === p}" :disabled="!canExecute" @click.stop="setTarget(p)">{{ p }}°</button>
                </div>

                <div class="wd-adj" style="justify-content:center">
                    <button class="wd-adj-btn" :disabled="!canExecute" aria-label="Decrease target" @click.stop="decreaseTarget"><i class="fas fa-minus" /></button>
                    <button class="wd-adj-btn" :disabled="!canExecute" aria-label="Increase target" @click.stop="increaseTarget"><i class="fas fa-plus" /></button>
                </div>

                <div class="wd-modes">
                    <button class="wd-mode" :class="{act: !isEnabled}" :disabled="!canExecute" @click.stop="toggleEnable">
                        <i class="fas fa-power-off" /> Off
                    </button>
                    <button class="wd-mode" :class="{act: isEnabled}" :disabled="!canExecute" @click.stop="enableThermostat">
                        <i :class="isHeating ? 'fas fa-fire' : 'fas fa-snowflake'" /> {{ modeLabel }}
                    </button>
                </div>

                <div class="wd-env">
                    <div v-if="humidity != null" class="wd-env-item">
                        <i class="fas fa-droplet" /> {{ humidity }}%
                    </div>
                    <div v-if="lux != null" class="wd-env-item">
                        <i class="fas fa-sun" /> {{ lux }} lx
                    </div>
                    <div v-if="hasSchedule" class="wd-env-item wd-env-item--active">
                        <i class="fas fa-calendar-check" /> Schedule
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

defineEmits<{'open-detail': []; delete: []; 'cycle-size': []}>();

const deviceStore = useDevicesStore();
const authStore = useAuthStore();
const rpc = useCardRpc();

// ── Device data ──────────────────────────────────────────────────────────

const device = computed(() => deviceStore.devices[props.entity.source]);
const isOffline = computed(() => !device.value?.online);
const canExecute = computed(() =>
    authStore.canExecuteDevice(props.entity.source)
);

const componentKey = computed(
    () => `thermostat:${props.entity.properties?.id ?? 0}`
);

const status = computed(
    () => device.value?.status?.[componentKey.value] ?? null
);
const config = computed(
    () => device.value?.settings?.[componentKey.value] ?? null
);

// ── Thermostat state ─────────────────────────────────────────────────────

const target = computed(() => status.value?.target_C ?? 20);
const current = computed(() => status.value?.current_C ?? null);
const isEnabled = computed(() => !!status.value?.enable);
const isHeating = computed(() => !!status.value?.output);
const thermoType = computed<'heating' | 'cooling'>(
    () => (config.value as any)?.type ?? 'heating'
);
const hasSchedule = computed(() => !!status.value?.schedules?.enable);

// ── Environment sensors ──────────────────────────────────────────────────

const humidity = computed(
    () => device.value?.status?.['humidity:0']?.rh ?? null
);
const lux = computed(
    () => device.value?.status?.['illuminance:0']?.lux ?? null
);

// ── Display helpers (answer, don't do) ───────────────────────────────────

const targetDisplay = computed(() =>
    target.value != null ? target.value.toFixed(1) : '—'
);
const currentDisplay = computed(() =>
    current.value != null ? current.value.toFixed(1) : '—'
);
const modeLabel = computed(() =>
    thermoType.value === 'cooling' ? 'Cool' : 'Heat'
);

const stateLabel = computed(() => {
    if (!isEnabled.value) return 'Off';
    if (!isHeating.value) return 'Idle';
    return thermoType.value === 'cooling' ? 'Cooling' : 'Heating';
});

const stateIcon = computed(() => {
    if (!isEnabled.value) return 'fas fa-power-off';
    if (isHeating.value)
        return thermoType.value === 'cooling'
            ? 'fas fa-snowflake'
            : 'fas fa-fire';
    return 'fas fa-minus';
});

const stateColor = computed(() => {
    if (!isEnabled.value) return 'var(--color-text-quaternary)';
    if (isHeating.value) return 'var(--color-status-warn)';
    return 'var(--color-text-quaternary)';
});

const TARGET_MIN = 5;
const TARGET_MAX = 35;
const TARGET_STEP = 0.5;
const presets = [5, 18, 20, 22, 24];

// ── Commands (do, don't answer) ──────────────────────────────────────────

function toggleEnable() {
    rpc.invokeAction(props.entity.id, 'setEnabled', {
        enabled: !isEnabled.value
    });
}

function enableThermostat() {
    if (!isEnabled.value) {
        rpc.invokeAction(props.entity.id, 'setEnabled', {enabled: true});
    }
}

function setTarget(value: number) {
    const clamped = Math.max(TARGET_MIN, Math.min(TARGET_MAX, value));
    rpc.invokeAction(props.entity.id, 'setTarget', {target_C: clamped});
}

function increaseTarget() {
    setTarget(target.value + TARGET_STEP);
}

function decreaseTarget() {
    setTarget(target.value - TARGET_STEP);
}
</script>

<style scoped>
/* ── 1×1 ── */
.wd-1x1 {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: var(--space-1-5);
}
.wd-temps { display: flex; align-items: center; gap: 0; }
.wd-temp-item { text-align: center; padding: 0 var(--space-3); }
.wd-temp-v { font-size: var(--type-subheading); font-weight: 800; letter-spacing: -1.5px; line-height: 1; color: var(--color-text-primary); }
.wd-temp-l { font-size: var(--type-body); font-weight: 600; color: var(--color-text-quaternary); margin-top: var(--space-0-5); }
.wd-sep { width: 1px; height: 28px; background: var(--color-border-default); }

.wd-state { display: flex; align-items: center; gap: var(--space-1); width: 100%; justify-content: center; }
.wd-state i { font-size: var(--icon-size-xs); /* icon-only */ }
.wd-state-label { font-size: var(--type-body); font-weight: 700; }
.wd-humidity { font-size: var(--type-body); font-weight: 600; color: var(--color-text-quaternary); margin-left: auto; }
.wd-humidity i { font-size: var(--icon-size-2xs); opacity: .6; /* icon-only */ }
.wd-type-label { font-size: var(--type-body); font-weight: 600; color: var(--color-text-quaternary); margin-left: var(--space-1); text-transform: capitalize; }

/* ── 2×1 ── */
.wd-wide { display: flex; align-items: stretch; height: 100%; }
.wd-wide-left {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    flex: 0 0 42%; gap: var(--space-1);
}
.wd-target { font-size: var(--type-heading); font-weight: 800; letter-spacing: -2px; line-height: 1; color: var(--color-text-primary); }
.wd-target span { font-size: var(--type-body); font-weight: 600; color: var(--color-text-tertiary); }
.wd-cur-sm { font-size: var(--type-body); font-weight: 600; color: var(--color-text-tertiary); }
.wd-wide-right {
    flex: 1; display: flex; flex-direction: column; justify-content: center;
    gap: var(--space-1-5); padding: var(--space-2) var(--space-3);
    border-left: 1px solid var(--color-border-default);
}

/* ── Shared controls ── */
.wd-presets { display: flex; gap: var(--space-1); flex-wrap: wrap; }
.wd-preset {
    padding: var(--space-1) var(--space-2); border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-2); color: var(--color-text-tertiary);
    font-size: var(--type-body); font-weight: 700; cursor: pointer;
    transition: background var(--duration-fast), color var(--duration-fast), border-color var(--duration-fast);
}
.wd-preset:hover { border-color: var(--color-border-medium); color: var(--color-text-primary); }
.wd-preset.act { background: rgba(var(--ar), .12); border-color: rgba(var(--ar), .3); color: rgb(var(--ar)); }
.wd-preset:disabled { opacity: .4; cursor: default; }

.wd-modes { display: flex; gap: var(--space-1); }
.wd-mode {
    display: flex; align-items: center; gap: var(--space-1);
    padding: var(--space-1) 10px; border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-2); color: var(--color-text-tertiary);
    font-size: var(--type-body); font-weight: 700; cursor: pointer;
    transition: background var(--duration-fast), color var(--duration-fast);
}
.wd-mode:hover { color: var(--color-text-primary); }
.wd-mode.act { background: rgba(var(--ar), .1); border-color: rgba(var(--ar), .25); color: rgb(var(--ar)); }
.wd-mode:disabled { opacity: .4; cursor: default; }

.wd-adj { display: flex; gap: var(--space-1-5); }
.wd-adj-btn {
    width: 28px; height: 28px; border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-2); color: var(--color-text-tertiary);
    font-size: var(--type-body); cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background var(--duration-fast), color var(--duration-fast);
    position: relative;
}
.wd-adj-btn::after {
    content: "";
    position: absolute;
    inset: -8px;
}
.wd-adj-btn:hover { background: var(--color-surface-3); color: var(--color-text-primary); }
.wd-adj-btn:disabled { opacity: .4; cursor: default; }

/* ── 2×2 hero ── */
.wd-hero-temps {
    display: flex; align-items: baseline; justify-content: center;
    gap: var(--space-6); padding: var(--space-4) 0 var(--space-2); flex-shrink: 0;
}
.wd-hero-set { text-align: center; }
.wd-hero-set-v { font-size: var(--type-heading); font-weight: 800; letter-spacing: -3px; line-height: 1; color: var(--color-text-primary); }
.wd-hero-set-v span { font-size: var(--type-subheading); font-weight: 600; color: var(--color-text-tertiary); }
.wd-hero-set-l { font-size: var(--type-body); font-weight: 700; color: var(--color-text-quaternary); letter-spacing: .05em; margin-top: var(--space-1); }
.wd-hero-now { text-align: center; }
.wd-hero-now-v { font-size: var(--type-subheading); font-weight: 700; letter-spacing: -1.5px; line-height: 1; color: var(--color-text-secondary); }
.wd-hero-now-v span { font-size: var(--type-body); font-weight: 600; color: var(--color-text-tertiary); }
.wd-hero-now-l { font-size: var(--type-body); font-weight: 700; color: var(--color-text-quaternary); letter-spacing: .05em; margin-top: var(--space-1); }

.wd-hero-controls {
    display: flex; flex-direction: column; align-items: center;
    gap: var(--space-3); flex: 1; padding: 0 var(--space-4);
}

.wd-env { display: flex; gap: var(--space-3); justify-content: center; margin-top: auto; }
.wd-env-item {
    display: flex; align-items: center; gap: var(--space-1);
    font-size: var(--type-body); font-weight: 600; color: var(--color-text-quaternary);
}
.wd-env-item i { font-size: var(--icon-size-2xs); opacity: .6; /* icon-only */ }
.wd-env-item--active { color: var(--color-primary); }
.wd-env-item--active i { opacity: 1; }
</style>
