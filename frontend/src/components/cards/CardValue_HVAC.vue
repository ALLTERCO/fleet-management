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
            <div class="hvac-mode-pill hvac-mode-pill--c">
                <i :class="modeIcon" />
                <span>{{ modeLabelShort }}</span>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
        <template #toggle>
            <CardToggle :is-on="isEnabled" :disabled="!isOperable" @toggle="toggleEnable" />
        </template>
    </CardShell>

    <!-- 2×1: left temps + right slider + mode icons -->
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
            <div class="ec-wide-row hvac-2x1-row">
                <!-- Left, spread top→bottom: target/current up top, the state pill
                     on the slider's line, then the big on/off button at the base. -->
                <div class="ec-wl hvac-2x1-wl">
                    <div class="ec-dual hvac-2x1-dual">
                        <div class="ec-dual-item">
                            <div class="ec-dv">{{ isHumidityTab ? targetHumDisplay : targetTempDisplay }}{{ isHumidityTab ? '%' : '°' }}</div>
                            <div class="ec-dl">Target</div>
                        </div>
                        <div class="ec-dsep" />
                        <div class="ec-dual-item">
                            <div class="ec-dv">{{ isHumidityTab ? humidityDisplay : currentTempDisplay }}{{ isHumidityTab ? '%' : '°' }}</div>
                            <div class="ec-dl">Current</div>
                        </div>
                    </div>
                    <div class="hvac-mode-pill hvac-mode-pill--c">
                        <i :class="modeIcon" />
                        <span>{{ modeLabelShort }}</span>
                        <span class="hvac-fan-tag">· {{ fanLabel }}</span>
                    </div>
                    <div class="hvac-2x1-toggle">
                        <CardToggle :is-on="isEnabled" :disabled="!isOperable" @toggle="toggleEnable" />
                    </div>
                </div>
                <!-- Right: a Temp/Humidity tab drives both the slider and the
                     option buttons below it (mode for Temp, fan for Humidity). -->
                <div class="ec-wr hvac-2x1-wr">
                    <div v-if="hasTargetHumidity" class="hvac-tabs hvac-2x1-tabs">
                        <button class="hvac-tab" :class="{act: !isHumidityTab}" @click.stop="configTab = 'temp'">Temp</button>
                        <button class="hvac-tab" :class="{act: isHumidityTab}" @click.stop="configTab = 'humidity'">Humidity</button>
                    </div>
                    <div class="ec-clr-track hvac-2x1-track">
                        <input
                            v-if="isHumidityTab"
                            type="range"
                            class="sld-r sld-hum"
                            aria-label="Target humidity"
                            :min="humMin"
                            :max="humMax"
                            step="1"
                            :value="humSliderValue"
                            :disabled="!isOperable"
                            @input="onHumInput"
                            @change="onHumChange"
                            @click.stop
                        />
                        <input
                            v-else
                            type="range"
                            class="sld-r sld-temp"
                            aria-label="Target temperature"
                            :min="tempMin"
                            :max="tempMax"
                            :step="tempStep"
                            :value="tempSliderValue"
                            :disabled="!isOperable"
                            @input="onTempInput"
                            @change="onTempChange"
                            @click.stop
                        />
                    </div>
                    <div class="ec-modes hvac-2x1-modes">
                        <template v-if="isHumidityTab">
                            <button
                                v-for="f in fanOptions"
                                :key="f.value"
                                class="ec-mode"
                                :class="{act: fanSpeed === f.value}"
                                :disabled="!isOperable"
                                :aria-label="f.label"
                                :title="f.label"
                                @click.stop="setFan(f.value)"
                            >
                                <span v-if="fanLevel(f.value) > 0" class="hvac-fan-bars" :data-level="fanLevel(f.value)"><span class="hvac-bar" /><span class="hvac-bar" /><span class="hvac-bar" /></span>
                                <span v-else class="hvac-fan-ind"><i class="fas fa-fan" /></span>
                                <span class="hvac-btn-label">{{ f.label }}</span>
                            </button>
                        </template>
                        <template v-else>
                            <button
                                v-for="m in modeOptions"
                                :key="m.value"
                                class="ec-mode"
                                :class="{act: workingMode === m.value}"
                                :disabled="!isOperable"
                                :aria-label="m.label"
                                :title="m.label"
                                @click.stop="setMode(m.value)"
                            >
                                <i :class="getModeIcon(m.value)" class="hvac-mode-icon" />
                                <span class="hvac-btn-label">{{ shortMode(m.value, m.label) }}</span>
                            </button>
                        </template>
                    </div>
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
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
            <!-- Temperature / Humidity config tabs (like the bulb colour/white
                 tabs). One setpoint on screen at a time. -->
            <div class="hvac-tabs">
                <button
                    class="hvac-tab"
                    :class="{act: !isHumidityTab}"
                    @click.stop="configTab = 'temp'"
                >Temperature</button>
                <button
                    v-if="hasTargetHumidity"
                    class="hvac-tab"
                    :class="{act: isHumidityTab}"
                    @click.stop="configTab = 'humidity'"
                >Humidity</button>
            </div>

            <!-- Setpoint: target + current for the selected metric, spaced apart -->
            <div class="hvac-hero">
                <div class="hvac-hero-item">
                    <div class="hvac-hero-v">{{ isHumidityTab ? targetHumDisplay : targetTempDisplay }}<span>{{ isHumidityTab ? '%' : '°' }}</span></div>
                    <div class="hvac-hero-l">Target</div>
                </div>
                <div class="hvac-hero-item">
                    <div class="hvac-hero-v hvac-hero-v--now">{{ isHumidityTab ? humidityDisplay : currentTempDisplay }}<span>{{ isHumidityTab ? '%' : '°' }}</span></div>
                    <div class="hvac-hero-l">Current</div>
                </div>
            </div>

            <div class="ec-trv-hero-controls">
                <!-- Setpoint slider for the selected metric -->
                <div class="ec-clr-track hvac-set-track">
                    <input
                        v-if="isHumidityTab"
                        type="range"
                        class="sld-r sld-hum"
                        aria-label="Target humidity"
                        :min="humMin"
                        :max="humMax"
                        step="1"
                        :value="humSliderValue"
                        :disabled="!isOperable"
                        @input="onHumInput"
                        @change="onHumChange"
                        @click.stop
                    />
                    <input
                        v-else
                        type="range"
                        class="sld-r sld-temp"
                        aria-label="Target temperature"
                        :min="tempMin"
                        :max="tempMax"
                        :step="tempStep"
                        :value="tempSliderValue"
                        :disabled="!isOperable"
                        @input="onTempInput"
                        @change="onTempChange"
                        @click.stop
                    />
                </div>

                <!-- Preset marks on the slider — tap to snap; the slider also
                     sets on click/drag. Present on both tabs so the slider stays
                     in the same place when you switch. -->
                <div class="hvac-marks">
                    <template v-if="isHumidityTab">
                        <button
                            v-for="p in humPresets"
                            :key="`h${p}`"
                            class="hvac-mark"
                            :class="{act: targetHumidity != null && Math.abs(targetHumidity - p) < 1}"
                            :style="markPos(p, humMin, humMax)"
                            :aria-label="`${p}%`"
                            :disabled="!isOperable"
                            @click.stop="setTargetHumidity(p)"
                        >
                            <span class="hvac-mark-dot" />
                            <span class="hvac-mark-lbl">{{ p }}</span>
                        </button>
                    </template>
                    <template v-else>
                        <button
                            v-for="p in tempPresets"
                            :key="`t${p}`"
                            class="hvac-mark"
                            :class="{act: Math.abs(targetTemp - p) < 0.25}"
                            :style="markPos(p, tempMin, tempMax)"
                            :aria-label="`${p}°`"
                            :disabled="!isOperable"
                            @click.stop="setTarget(p)"
                        >
                            <span class="hvac-mark-dot" />
                            <span class="hvac-mark-lbl">{{ p }}</span>
                        </button>
                    </template>
                </div>

                <!-- On/off toggle — sits where the preset buttons were. -->
                <div class="hvac-toggle-row">
                    <CardToggle :is-on="isEnabled" :disabled="!isOperable" @toggle="toggleEnable" />
                </div>

                <!-- Working mode -->
                <div class="ec-trv-modes">
                    <button
                        v-for="m in modeOptions"
                        :key="m.value"
                        class="ec-mode"
                        :class="{act: workingMode === m.value}"
                        :disabled="!isOperable"
                        @click.stop="setMode(m.value)"
                    >
                        <i :class="getModeIcon(m.value)" class="hvac-mode-icon" />
                        <span class="hvac-btn-label">{{ m.label }}</span>
                    </button>
                </div>

                <!-- Fan speed -->
                <div class="ec-trv-modes">
                    <button
                        v-for="f in fanOptions"
                        :key="f.value"
                        class="ec-mode"
                        :class="{act: fanSpeed === f.value}"
                        :disabled="!isOperable"
                        @click.stop="setFan(f.value)"
                    >
                        <span
                            v-if="fanLevel(f.value) > 0"
                            class="hvac-fan-bars"
                            :data-level="fanLevel(f.value)"
                        >
                            <span class="hvac-bar" /><span class="hvac-bar" /><span class="hvac-bar" />
                        </span>
                        <span v-else class="hvac-fan-ind"><i class="fas fa-fan" /></span>
                        <span class="hvac-btn-label">{{ f.label }}</span>
                    </button>
                </div>
            </div>
        </template>
        <template #badges>
            <CardBadges :is-offline="isOffline" :shelly-id="entity.source" />
        </template>
    </CardShell>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import {useCardRpc} from '@/composables/useCardRpc';
import {useOptimisticSlider} from '@/composables/useOptimisticSlider';
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
// A command only lands if we're allowed AND the device is reachable. Gating the
// controls on this (not just permission) keeps the card honest: an offline
// device shows disabled controls instead of taking taps that go nowhere.
const isOperable = computed(() => canExecute.value && !isOffline.value);

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

// Fan speed → bar count (graded speeds show ascending bars; auto/unknown falls
// back to the fan icon, where "let the device decide" actually reads as a fan).
const FAN_LEVELS: Record<string, number> = {low: 1, medium: 2, high: 3};
function fanLevel(speed: string): number {
    return FAN_LEVELS[speed] ?? 0;
}

const modeIcon = computed(() => getModeIcon(workingMode.value));

const modeLabel = computed(() => {
    if (!isEnabled.value) return 'Off';
    const cfg = vcConfig('working_mode');
    const titles = cfg?.meta?.ui?.titles;
    return titles?.[workingMode.value] ?? workingMode.value;
});

// Compact surfaces (the 1×1/2×1 state pill and the 2×1 square buttons) can't
// hold a long mode name without wrapping or clipping, so abbreviate the few that
// overflow. Keyed on the stable resource value, not the title. The full device
// label stays on the roomy 2×2 buttons and in every button tooltip.
const SHORT_MODE_LABELS: Record<string, string> = {ventilation: 'Vent'};
function shortMode(value: string, label: string): string {
    return SHORT_MODE_LABELS[value] ?? label;
}
const modeLabelShort = computed(() =>
    isEnabled.value ? shortMode(workingMode.value, modeLabel.value) : modeLabel.value
);

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

// Slider bounds/step come from the device config (Number component min/max/step),
// falling back only if a device omits them.
const tempMin = computed(() => vcConfig('target_temperature')?.min ?? 5);
const tempMax = computed(() => vcConfig('target_temperature')?.max ?? 35);
const tempStep = computed(
    () => vcConfig('target_temperature')?.meta?.ui?.step ?? 0.5
);
const humMin = computed(() => vcConfig('target_humidity')?.min ?? 40);
const humMax = computed(() => vcConfig('target_humidity')?.max ?? 75);

// Setpoint marks: device min + max (so the range is always visible) plus the
// values people actually target — clamped to each metric's range.
const tempPresets = computed(() => {
    const min = tempMin.value;
    const max = tempMax.value;
    const marks = [min, 18, 21, 24, max].filter((p) => p >= min && p <= max);
    return [...new Set(marks)].sort((a, b) => a - b);
});
const humPresets = computed(() => {
    const min = humMin.value;
    const max = humMax.value;
    // 45–50% is the comfort/health target most people set; max shown for range.
    const marks = [min, 45, 50, max].filter((p) => p >= min && p <= max);
    return [...new Set(marks)].sort((a, b) => a - b);
});

// Position a mark under the slider thumb for its value. A native range thumb's
// centre is inset by half its width at each end, so the travel is 8px..(track −
// 8px) for the 16px thumb — mark at frac sits at 8px + frac·(100% − 16px).
function markPos(p: number, min: number, max: number): Record<string, string> {
    const frac = Math.max(0, Math.min(1, (p - min) / (max - min || 1)));
    return {
        left: `calc(8px + ${frac} * (100% - 16px))`,
        transform: 'translateX(-50%)'
    };
}

// Which setpoint the 2x2 edits — temperature or humidity (tab switch, like the
// bulb's colour/white tabs). Humidity only when the device exposes a target.
const configTab = ref<'temp' | 'humidity'>('temp');
const isHumidityTab = computed(() => configTab.value === 'humidity');

// Both sliders follow the finger and commit on release; the setters clamp.
const {
    display: tempSliderValue,
    onInput: onTempInput,
    onChange: onTempChange
} = useOptimisticSlider(targetTemp, setTarget);

const targetHumNum = computed(() => targetHumidity.value ?? humMin.value);
function setTargetHumidity(value: number) {
    setVirtualValue(
        'target_humidity',
        Math.max(humMin.value, Math.min(humMax.value, value))
    );
}
const {
    display: humSliderValue,
    onInput: onHumInput,
    onChange: onHumChange
} = useOptimisticSlider(targetHumNum, setTargetHumidity);

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

function setMode(mode: string) {
    setVirtualValue('working_mode', mode);
}

function setFan(speed: string) {
    setVirtualValue('fan_speed', speed);
}

</script>

<style scoped>
/* Mode indicator pill (1x1, 2x1) */
.hvac-mode-pill {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin-top: var(--space-1-5);
    font-size: var(--type-caption);
    font-weight: 700;
    color: var(--color-text-tertiary);
}
.hvac-mode-pill i { font-size: var(--icon-size-2xs); /* icon-only */ }
/* 1×1 — centre the pill under the centred target/current pair. */
.hvac-mode-pill--c { justify-content: center; }

/* 2×1 right column — slider stays its natural height so the mode icons sit
   right below it instead of being pushed out by the track's flex-grow. */
.hvac-2x1-track { flex: 0 0 auto; }
/* Give the controls the right-hand space: shrink the readout column to its
   content, let the control column grow, trim the right padding, and spread the
   tabs/slider/buttons apart. */
.ec-wide-row.hvac-2x1-row { gap: var(--space-3); padding-left: var(--space-2); padding-right: var(--space-2); }
.ec-wl.hvac-2x1-wl { flex: 0 0 128px; }
.ec-wr.hvac-2x1-wr { flex: 1 1 auto; justify-content: space-between; }

/* Bigger, near-square buttons with a label under the icon. The wider column
   lets the medium-length labels sit on one line. */
.hvac-2x1-modes { gap: var(--space-1); }
.hvac-2x1-modes .ec-mode {
    flex-direction: column;
    gap: 3px;
    min-height: 52px;
    padding: var(--space-1) 2px;
}
.hvac-2x1-modes .hvac-mode-icon { font-size: var(--type-body); }
.hvac-2x1-modes .hvac-fan-bars,
.hvac-2x1-modes .hvac-fan-ind { height: 16px; }
.hvac-2x1-modes .hvac-fan-ind i { font-size: 16px; }
.hvac-2x1-modes .hvac-btn-label {
    font-size: var(--type-caption);
    line-height: 1.05;
    text-align: center;
    white-space: normal;
    word-break: break-word;
}

/* 2×1 Temp/Humidity tab — the same segmented control, sized down for the
   right column and with no extra bottom margin (the column gap spaces it). */
.hvac-2x1-tabs { align-self: center; margin-bottom: 0; }
.hvac-2x1-tabs .hvac-tab { padding: 2px 10px; font-size: var(--type-caption); }

/* 2×1 readout — the shared .ec-dual atom, tightened so the column stays narrow
   and hands its width to the controls; Current is dimmed so Target reads as the
   setpoint you change. */
.hvac-2x1-dual { gap: var(--space-1); padding: 0; }
.hvac-2x1-dual .ec-dv { font-size: 1.5rem; }
.hvac-2x1-dual .ec-dl { font-size: var(--type-caption); }
.hvac-2x1-dual .ec-dual-item:last-child .ec-dv {
    background: none;
    -webkit-text-fill-color: var(--color-text-secondary);
}

/* 2×1 left column spread top→bottom so the readout sits up top, the state pill
   lands on the slider's line, and the button anchors the base. Compound class
   beats the global `.ec-wide .ec-wl { justify-content: center }`. */
.ec-wl.hvac-2x1-wl { justify-content: space-between; }

/* 2×1 on/off — the big button, stretched to the column so its width:100%
   fills instead of collapsing in this centered flex column. Nudged down so its
   centre lines up with the option buttons in the right column. */
.hvac-2x1-toggle { align-self: stretch; display: flex; justify-content: center; transform: translateY(6px); }

/* Fan tag inline with mode pill */
.hvac-fan-tag {
    font-weight: 600;
    color: var(--color-text-quaternary);
    margin-left: var(--space-1);
}

/* Mode button icon sizing (1x1/2x1 inline pill) */
.hvac-mode-icon { font-size: var(--icon-size-2xs); /* icon-only */ }

/* 2x2 mode/fan buttons: icon/indicator over a small label — no section headers,
   the labels name themselves. */
.ec-trv-modes .ec-mode {
    flex-direction: column;
    gap: var(--space-0-5);
    padding: var(--space-1-5) var(--gap-xs);
}
.ec-trv-modes .hvac-mode-icon {
    font-size: var(--type-body);
}
.hvac-btn-label {
    font-size: 0.6875rem; /* 11px — a notch below caption so it stays compact */
    line-height: 1.05;
}
/* Uniform mode + fan button size + gutter. */
.ec-trv-hero-controls .ec-trv-modes {
    gap: var(--space-2);
    padding: 0 var(--space-4);
}
.ec-trv-hero-controls .ec-trv-modes .ec-mode {
    min-height: 46px;
    border-radius: var(--radius-md);
}
/* Fan speed shown as ascending bars, filled up to the speed level. */
.hvac-fan-bars {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 16px;
}
.hvac-bar {
    width: 3px;
    border-radius: 1px;
    background: var(--color-text-disabled);
}
.hvac-bar:nth-child(1) { height: 7px; }
.hvac-bar:nth-child(2) { height: 11px; }
.hvac-bar:nth-child(3) { height: 16px; }
.hvac-fan-bars[data-level="1"] .hvac-bar:nth-child(-n + 1),
.hvac-fan-bars[data-level="2"] .hvac-bar:nth-child(-n + 2),
.hvac-fan-bars[data-level="3"] .hvac-bar:nth-child(-n + 3) {
    background: var(--color-text-secondary);
}
/* Auto keeps a fan glyph — it's the one speed where a fan icon means something. */
.hvac-fan-ind {
    display: flex;
    align-items: center;
    height: 16px;
}
.hvac-fan-ind i {
    font-size: 16px;
}
/* Active button lifts its indicator to the accent. */
.ec-mode.act .hvac-mode-icon,
.ec-mode.act .hvac-fan-ind i {
    color: var(--color-primary);
}
.ec-mode.act .hvac-fan-bars[data-level="1"] .hvac-bar:nth-child(-n + 1),
.ec-mode.act .hvac-fan-bars[data-level="2"] .hvac-bar:nth-child(-n + 2),
.ec-mode.act .hvac-fan-bars[data-level="3"] .hvac-bar:nth-child(-n + 3) {
    background: var(--color-primary);
}

/* Temperature / Humidity config tab — a centered glass segmented control, the
   same idea as the bulb's colour/white tabs. */
.hvac-tabs {
    display: flex;
    align-self: center;
    gap: 1px;
    margin-bottom: var(--space-2);
    padding: 2px;
    border-radius: var(--radius-sm);
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--glass-border);
}
.hvac-tab {
    padding: 3px 14px;
    border: none;
    border-radius: var(--radius-xs);
    background: transparent;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    font-weight: 600;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
}
.hvac-tab.act {
    background: rgba(255, 255, 255, 0.12);
    color: var(--color-text-primary);
}

/* Setpoint — target + current, centered as a pair with clear space below so
   they read as the card's focal point, separate from the controls. */
.hvac-hero {
    display: flex;
    justify-content: center;
    align-items: baseline;
    gap: var(--space-12);
    padding: var(--space-1) var(--space-4) 0;
    margin-bottom: var(--space-5);
}
.hvac-hero-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
}
.hvac-hero-v {
    font-size: var(--type-display);
    font-weight: var(--font-black);
    line-height: 1;
    letter-spacing: var(--tracking-tight);
    background: var(--gradient-value-text);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
}
.hvac-hero-v span {
    font-size: var(--type-subheading);
    -webkit-text-fill-color: var(--color-text-tertiary);
}
.hvac-hero-v--now {
    font-size: var(--type-heading);
    background: none;
    -webkit-text-fill-color: var(--color-text-secondary);
}
.hvac-hero-v--now span {
    font-size: var(--type-body);
}
.hvac-hero-l {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    color: var(--color-text-tertiary);
}

.hvac-set-track {
    margin: 0 var(--space-4) 0;
}

/* Preset marks sit on the slider — a dot at each preset's position with a small
   label; tap to snap. Same left/right inset as the track so they line up. */
.hvac-marks {
    position: relative;
    height: 20px;
    margin: var(--space-1) var(--space-4) var(--space-2);
}
.hvac-mark {
    position: absolute;
    top: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 0;
    border: none;
    background: none;
    color: var(--color-text-tertiary);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
}
.hvac-mark-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--color-text-disabled);
    transition: background var(--duration-fast), transform var(--duration-fast);
}
.hvac-mark-lbl {
    font-size: var(--type-caption);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    line-height: 1;
}
.hvac-mark.act {
    color: var(--color-primary);
}
.hvac-mark.act .hvac-mark-dot {
    background: var(--color-primary);
    transform: scale(1.4);
}

/* On/off toggle row — where the preset buttons used to sit. */
.hvac-toggle-row {
    display: flex;
    justify-content: center;
    padding: 0 var(--space-4);
    margin-bottom: var(--space-2);
}
</style>
