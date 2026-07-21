<template>
    <div class="et">
        <!-- Hero: dominant power reading (only on PM-capable dimmers) -->
        <header v-if="status?.apower !== undefined" class="et__hero">
            <div class="et__hero-value">{{ status.apower.toFixed(1) }} W</div>
            <div class="et__hero-label">Power</div>
        </header>

        <!-- Primary affordance: full-width toggle -->
        <button
            type="button"
            class="et__primary"
            :class="{
                'et__primary--on': isOn,
                'et__primary--readonly': !canExecute
            }"
            :disabled="!canExecute"
            :aria-pressed="isOn"
            @click="canExecute && emit('toggle')"
        >
            <span class="et__primary-text">
                <span class="et__primary-state">{{ isOn ? 'On' : 'Off' }}</span>
                <span v-if="status?.source" class="et__primary-source">via {{ formatSource(status.source) }}</span>
            </span>
            <span class="et__primary-icon" aria-hidden="true">
                <i class="fas fa-power-off" />
            </span>
        </button>

        <!-- Banners: device errors + calibration warning + active timer/transition -->
        <div v-if="statusErrors.length > 0" class="et__banner et__banner--danger" role="alert">
            <i class="fas fa-triangle-exclamation" />
            <span class="et__banner-list">
                <span v-for="err in statusErrors" :key="err">{{ err }}</span>
            </span>
        </div>
        <div v-if="calibrationWarning" class="et__banner et__banner--warning">
            <i class="fas fa-triangle-exclamation" />
            <span>{{ calibrationWarning }}</span>
        </div>
        <div v-if="status?.timer_started_at != null && status?.timer_duration != null" class="et__banner et__banner--warning">
            <i class="fas fa-hourglass-half" />
            <span>Auto-toggle in {{ formatDuration(status.timer_duration) }}</span>
        </div>
        <div v-if="status?.transition" class="et__banner et__banner--info">
            <i class="fas fa-arrow-right-long" />
            <span>Transition → {{ status.transition.target?.brightness }}% ({{ status.transition.duration }}s)</span>
        </div>

        <!-- Brightness slider (when supported) -->
        <div v-if="status?.brightness !== undefined" class="et__slider-row" :class="!isOn && 'et-light__dimmed'">
            <div class="et__slider-head">
                <span class="et__slider-label">Brightness</span>
                <span class="et__slider-value">{{ status?.brightness ?? 0 }}%</span>
            </div>
            <HorizontalSlider
                :value="status?.brightness ?? 0"
                :saved="{ '0%': 0, '25%': 25, '50%': 50, '75%': 75, '100%': 100 }"
                :disabled="!canExecute"
                @change="(v: number) => emit('setBrightness', v)"
            >
                <template #title>Brightness ({{ status?.brightness ?? 0 }}%)</template>
            </HorizontalSlider>
        </div>

        <!-- Color temperature slider (when supported) -->
        <div v-if="status?.temp !== undefined" class="et__slider-row" :class="!isOn && 'et-light__dimmed'">
            <div class="et__slider-head">
                <span class="et__slider-label">Color temperature</span>
                <span class="et__slider-value">{{ status?.temp ?? 4000 }}K</span>
            </div>
            <HorizontalSlider
                :value="status?.temp ?? 4000"
                :min="tempRange.min"
                :max="tempRange.max"
                :saved="tempPresets"
                :disabled="!canExecute"
                @change="(v: number) => emit('setTemp', v)"
            >
                <template #title>Color Temp ({{ status?.temp ?? 4000 }}K)</template>
            </HorizontalSlider>
        </div>

        <!-- Calibrate chip + progress bar — RPC fails gracefully on unsupported devices -->
        <div v-if="canExecute && props.shellyID" class="et-light__calibrate-wrap">
            <button
                type="button"
                class="et__chip et__chip--primary"
                :class="isCalibrating && 'et-light__calibrate--active'"
                :disabled="isCalibrating"
                @click="calibrate"
            >
                <i :class="isCalibrating ? 'fas fa-spinner fa-spin' : 'fas fa-sliders'" />
                <span v-if="isCalibrating && calibrationProgress != null">Calibrating… {{ calibrationProgress }}%</span>
                <span v-else-if="isCalibrating">Calibrating…</span>
                <span v-else>Calibrate</span>
            </button>
            <div v-if="isCalibrating && calibrationProgress != null" class="et-light__calibrate-bar">
                <div class="et-light__calibrate-fill" :style="{width: `${calibrationProgress}%`}" />
            </div>
        </div>

        <!-- KPI strip (secondary power telemetry) -->
        <ul v-if="status?.voltage !== undefined || status?.current !== undefined || status?.aenergy?.total != null" class="et__kpis">
            <li v-if="status?.voltage !== undefined" class="et__kpi">
                <span class="et__kpi-value">{{ status.voltage.toFixed(0) }} V</span>
                <span class="et__kpi-label">Voltage</span>
            </li>
            <li v-if="status?.current !== undefined" class="et__kpi">
                <span class="et__kpi-value">{{ metricText(formatCurrent(status.current)) }}</span>
                <span class="et__kpi-label">Current</span>
            </li>
            <li v-if="status?.aenergy?.total != null" class="et__kpi">
                <span class="et__kpi-value">{{ (status.aenergy.total / 1000).toFixed(2) }} kWh</span>
                <span class="et__kpi-label">Energy</span>
            </li>
        </ul>

        <!-- Last-3-min energy detail -->
        <section v-if="status?.aenergy?.by_minute?.length" class="et__panel">
            <div class="et__panel-row">
                <span>Last 3 minutes</span>
                <span class="et__panel-value">{{ status.aenergy.by_minute.join(' / ') }} <small>mWh</small></span>
            </div>
        </section>

        <!-- Quick chip actions: toggle-after + reset counters -->
        <div v-if="canExecute" class="et__chip-row">
            <input
                v-model.number="toggleAfterSec"
                type="number"
                class="et__num"
                min="1"
                placeholder="sec"
                aria-label="Toggle-after seconds"
            />
            <button
                type="button"
                class="et__chip et__chip--primary"
                :disabled="!toggleAfterSec"
                @click="doToggleAfter"
            >
                <i class="fas fa-clock" />
                <span>{{ isOn ? 'Off' : 'On' }} in {{ toggleAfterSec || '…' }}s</span>
            </button>
            <button
                v-if="props.shellyID && status?.aenergy?.total != null"
                type="button"
                class="et__chip"
                @click="resetCounters"
            >
                <i class="fas fa-rotate-left" />
                <span>Reset counters</span>
            </button>
        </div>

        <!-- Device PCB temperature pill -->
        <div v-if="deviceTemp != null" class="et__banner" :class="deviceTemp > 80 ? 'et__banner--warning' : 'et__banner--info'">
            <i class="fas fa-microchip" />
            <span>Internal {{ deviceTemp }}°C</span>
            <span v-if="deviceTemp > 80" class="et-light__temp-warn">
                <i class="fas fa-triangle-exclamation" /> Hot
            </span>
        </div>

        <!-- Night mode (prominent — not in Configure) -->
        <section v-if="nightMode" class="et__panel">
            <div class="et__panel-row">
                <span><i class="fas fa-moon" /> Night mode</span>
                <button
                    v-if="canExecute && props.shellyID"
                    type="button"
                    class="et__switch"
                    :class="nightMode.enable && 'et__switch--on'"
                    :aria-pressed="!!nightMode.enable"
                    @click="setConfig({night_mode: {enable: !nightMode.enable}})"
                ><span class="et__switch-thumb" /></button>
                <span v-else class="et__panel-value">{{ nightMode.enable ? 'On' : 'Off' }}</span>
            </div>
            <template v-if="nightMode.enable">
                <HorizontalSlider
                    v-if="canExecute && props.shellyID"
                    :value="nightMode.brightness ?? 10"
                    :min="1"
                    :max="100"
                    @change="(v: number) => setConfig({night_mode: {brightness: v}})"
                >
                    <template #title>Brightness {{ nightMode.brightness ?? 10 }}%</template>
                </HorizontalSlider>
                <div v-if="canExecute && props.shellyID" class="et-light__time-row">
                    <span class="et__form-label">Active between</span>
                    <div class="et-light__time-inputs">
                        <input
                            type="time"
                            class="et__text et-light__time-input"
                            :value="nightMode.active_between?.[0] ?? '22:00'"
                            @change="(e: Event) => setNightTime(0, (e.target as HTMLInputElement).value)"
                        />
                        <span class="et__form-label">–</span>
                        <input
                            type="time"
                            class="et__text et-light__time-input"
                            :value="nightMode.active_between?.[1] ?? '06:00'"
                            @change="(e: Event) => setNightTime(1, (e.target as HTMLInputElement).value)"
                        />
                    </div>
                </div>
                <div v-else class="et__panel-row">
                    <span>Brightness {{ nightMode.brightness }}%</span>
                    <span v-if="nightMode.active_between?.length" class="et__panel-value">{{ nightMode.active_between.join(' – ') }}</span>
                </div>
            </template>
        </section>

        <!-- Configure: all settings, collapsed by default. Sub-sections preserve
             the existing useAccordion contract (collapsed / toggle / onKey). -->
        <details v-if="hasConfigurableSettings" class="et__configure">
            <summary class="et__configure-summary">
                <span><i class="fas fa-gear" /> Configure</span>
                <i class="fas fa-chevron-down et__configure-chevron" />
            </summary>

            <div class="et__configure-body">
                <!-- Dimmer settings -->
                <section
                    v-if="settings?.name != null || settings?.initial_state || settings?.in_mode || settings?.op_mode != null"
                    class="et__group"
                >
                    <header
                        class="et__section-head"
                        role="button"
                        tabindex="0"
                        :aria-expanded="!collapsed.has('settings')"
                        @click="toggleSection('settings')"
                        @keydown="onSectionKey($event, 'settings')"
                    >
                        <span class="et__section-title">Dimmer</span>
                        <i class="fas et__chevron" :class="collapsed.has('settings') ? 'fa-chevron-right' : 'fa-chevron-down'" />
                    </header>
                    <div v-if="!collapsed.has('settings')" class="et__form">
                        <label v-if="settings?.name != null" class="et__form-row">
                            <span class="et__form-label">Name</span>
                            <input
                                v-if="canExecute && props.shellyID"
                                type="text"
                                class="et__text"
                                :value="settings.name"
                                placeholder="Light name"
                                @change="(e: Event) => setConfig({name: (e.target as HTMLInputElement).value})"
                            />
                            <span v-else class="et__panel-value">{{ settings.name }}</span>
                        </label>
                        <label v-if="settings?.op_mode != null" class="et__form-row">
                            <span class="et__form-label">Output mode</span>
                            <select
                                v-if="canExecute && props.shellyID"
                                class="et__select"
                                :value="settings.op_mode"
                                @change="(e: Event) => setConfig({op_mode: Number((e.target as HTMLSelectElement).value)})"
                            >
                                <option :value="0">0–10V DC</option>
                                <option :value="1">1–10V DC</option>
                            </select>
                            <span v-else class="et__panel-value">{{ settings.op_mode === 0 ? '0–10V DC' : '1–10V DC' }}</span>
                        </label>
                        <label v-if="settings?.in_mode" class="et__form-row">
                            <span class="et__form-label">Input mode</span>
                            <select
                                v-if="canExecute && props.shellyID"
                                class="et__select"
                                :value="settings.in_mode"
                                @change="(e: Event) => setConfig({in_mode: (e.target as HTMLSelectElement).value})"
                            >
                                <option v-for="m in inputModes" :key="m.value" :value="m.value">{{ m.label }}</option>
                            </select>
                            <span v-else class="et__panel-value">{{ formatInMode(settings.in_mode) }}</span>
                        </label>
                        <label v-if="settings?.initial_state" class="et__form-row">
                            <span class="et__form-label">Initial state</span>
                            <select
                                v-if="canExecute && props.shellyID"
                                class="et__select"
                                :value="settings.initial_state"
                                @change="(e: Event) => setConfig({initial_state: (e.target as HTMLSelectElement).value})"
                            >
                                <option value="on">On</option>
                                <option value="off">Off</option>
                                <option value="restore_last">Restore last</option>
                            </select>
                            <span v-else class="et__panel-value">{{ settings.initial_state.replace(/_/g, ' ') }}</span>
                        </label>
                    </div>
                </section>

                <!-- Brightness behavior -->
                <section
                    v-if="settings?.min_brightness_on_toggle != null || settings?.range_map?.length === 2 || settings?.transition_duration != null || settings?.button_fade_rate != null || settings?.button_presets?.button_doublepush?.brightness != null"
                    class="et__group"
                >
                    <header
                        class="et__section-head"
                        role="button"
                        tabindex="0"
                        :aria-expanded="!collapsed.has('brightness')"
                        @click="toggleSection('brightness')"
                        @keydown="onSectionKey($event, 'brightness')"
                    >
                        <span class="et__section-title">Brightness behavior</span>
                        <i class="fas et__chevron" :class="collapsed.has('brightness') ? 'fa-chevron-right' : 'fa-chevron-down'" />
                    </header>
                    <div v-if="!collapsed.has('brightness')" class="et__form">
                        <div v-if="settings?.min_brightness_on_toggle != null" class="et__form-row">
                            <span class="et__form-label">Min brightness on toggle</span>
                            <HorizontalSlider
                                v-if="canExecute && props.shellyID"
                                :value="settings.min_brightness_on_toggle"
                                :min="0"
                                :max="100"
                                @change="(v: number) => setConfig({min_brightness_on_toggle: v})"
                            >
                                <template #title>{{ settings.min_brightness_on_toggle }}%</template>
                            </HorizontalSlider>
                            <span v-else class="et__panel-value">{{ settings.min_brightness_on_toggle }}%</span>
                        </div>
                        <div v-if="settings?.range_map?.length === 2" class="et__form-row">
                            <span class="et__form-label">Brightness range</span>
                            <div v-if="canExecute && props.shellyID" class="et-light__range-row">
                                <span class="et__form-label">Min</span>
                                <input
                                    type="number"
                                    class="et__num"
                                    :value="settings.range_map[0]"
                                    min="0"
                                    max="100"
                                    @change="(e: Event) => setConfig({range_map: [Number((e.target as HTMLInputElement).value), settings!.range_map[1]]})"
                                />
                                <span class="et__unit">%</span>
                                <span class="et__form-label">Max</span>
                                <input
                                    type="number"
                                    class="et__num"
                                    :value="settings.range_map[1]"
                                    min="0"
                                    max="100"
                                    @change="(e: Event) => setConfig({range_map: [settings!.range_map[0], Number((e.target as HTMLInputElement).value)]})"
                                />
                                <span class="et__unit">%</span>
                            </div>
                            <span v-else class="et__panel-value">{{ settings.range_map[0] }}% – {{ settings.range_map[1] }}%</span>
                        </div>
                        <div v-if="settings?.transition_duration != null" class="et__form-row">
                            <span class="et__form-label">Fade duration</span>
                            <HorizontalSlider
                                v-if="canExecute && props.shellyID"
                                :value="settings.transition_duration * 10"
                                :min="5"
                                :max="50"
                                @change="(v: number) => setConfig({transition_duration: v / 10})"
                            >
                                <template #title>{{ settings.transition_duration }}s</template>
                            </HorizontalSlider>
                            <span v-else class="et__panel-value">{{ settings.transition_duration }}s</span>
                        </div>
                        <div v-if="settings?.button_fade_rate != null" class="et__form-row">
                            <span class="et__form-label">Button fade rate</span>
                            <HorizontalSlider
                                v-if="canExecute && props.shellyID"
                                :value="settings.button_fade_rate"
                                :min="1"
                                :max="5"
                                @change="(v: number) => setConfig({button_fade_rate: v})"
                            >
                                <template #title>{{ settings.button_fade_rate }}</template>
                            </HorizontalSlider>
                            <span v-else class="et__panel-value">{{ settings.button_fade_rate }}</span>
                        </div>
                        <div v-if="settings?.button_presets?.button_doublepush?.brightness != null" class="et__form-row">
                            <span class="et__form-label">Double-push brightness</span>
                            <HorizontalSlider
                                v-if="canExecute && props.shellyID"
                                :value="settings.button_presets.button_doublepush.brightness"
                                :min="0"
                                :max="100"
                                @change="(v: number) => setConfig({button_presets: {button_doublepush: {brightness: v}}})"
                            >
                                <template #title>{{ settings.button_presets.button_doublepush.brightness }}%</template>
                            </HorizontalSlider>
                            <span v-else class="et__panel-value">{{ settings.button_presets.button_doublepush.brightness }}%</span>
                        </div>
                    </div>
                </section>

                <!-- Timers -->
                <section v-if="settings?.auto_on !== undefined || settings?.auto_off !== undefined" class="et__group">
                    <header
                        class="et__section-head"
                        role="button"
                        tabindex="0"
                        :aria-expanded="!collapsed.has('timers')"
                        @click="toggleSection('timers')"
                        @keydown="onSectionKey($event, 'timers')"
                    >
                        <span class="et__section-title">Timers</span>
                        <i class="fas et__chevron" :class="collapsed.has('timers') ? 'fa-chevron-right' : 'fa-chevron-down'" />
                    </header>
                    <div v-if="!collapsed.has('timers')" class="et__form">
                        <div v-if="settings?.auto_on !== undefined" class="et__timer-row">
                            <button
                                v-if="canExecute && props.shellyID"
                                type="button"
                                class="et__pill"
                                :class="settings.auto_on && 'et__pill--on'"
                                @click="setConfig({auto_on: !settings.auto_on})"
                            >Auto on</button>
                            <span v-else class="et__form-label">Auto on: {{ settings.auto_on ? 'Yes' : 'No' }}</span>
                            <input
                                v-if="canExecute && props.shellyID && settings.auto_on"
                                type="number"
                                class="et__num"
                                :value="settings.auto_on_delay ?? 0"
                                min="0"
                                step="1"
                                @change="(e: Event) => setConfig({auto_on_delay: Number((e.target as HTMLInputElement).value)})"
                            />
                            <span v-if="settings.auto_on" class="et__unit">sec</span>
                        </div>
                        <div v-if="settings?.auto_off !== undefined" class="et__timer-row">
                            <button
                                v-if="canExecute && props.shellyID"
                                type="button"
                                class="et__pill"
                                :class="settings.auto_off && 'et__pill--on'"
                                @click="setConfig({auto_off: !settings.auto_off})"
                            >Auto off</button>
                            <span v-else class="et__form-label">Auto off: {{ settings.auto_off ? 'Yes' : 'No' }}</span>
                            <input
                                v-if="canExecute && props.shellyID && settings.auto_off"
                                type="number"
                                class="et__num"
                                :value="settings.auto_off_delay ?? 0"
                                min="0"
                                step="1"
                                @change="(e: Event) => setConfig({auto_off_delay: Number((e.target as HTMLInputElement).value)})"
                            />
                            <span v-if="settings.auto_off" class="et__unit">sec</span>
                        </div>
                    </div>
                </section>

                <!-- Protections -->
                <section
                    v-if="settings?.power_limit != null || settings?.current_limit != null || settings?.voltage_limit != null || settings?.undervoltage_limit != null"
                    class="et__group"
                >
                    <header
                        class="et__section-head"
                        role="button"
                        tabindex="0"
                        :aria-expanded="!collapsed.has('protections')"
                        @click="toggleSection('protections')"
                        @keydown="onSectionKey($event, 'protections')"
                    >
                        <span class="et__section-title">Protections</span>
                        <i class="fas et__chevron" :class="collapsed.has('protections') ? 'fa-chevron-right' : 'fa-chevron-down'" />
                    </header>
                    <div v-if="!collapsed.has('protections')" class="et__form">
                        <div v-if="settings?.power_limit != null" class="et__limit-row">
                            <span class="et__form-label">Power max</span>
                            <input
                                v-if="canExecute && props.shellyID"
                                type="number"
                                class="et__num"
                                :value="settings.power_limit"
                                min="0"
                                @change="(e: Event) => setConfig({power_limit: Number((e.target as HTMLInputElement).value)})"
                            />
                            <span v-else class="et__panel-value">{{ settings.power_limit }}</span>
                            <span class="et__unit">W</span>
                        </div>
                        <div v-if="settings?.current_limit != null" class="et__limit-row">
                            <span class="et__form-label">Current max</span>
                            <input
                                v-if="canExecute && props.shellyID"
                                type="number"
                                class="et__num"
                                :value="settings.current_limit"
                                min="0"
                                step="0.1"
                                @change="(e: Event) => setConfig({current_limit: Number((e.target as HTMLInputElement).value)})"
                            />
                            <span v-else class="et__panel-value">{{ settings.current_limit }}</span>
                            <span class="et__unit">A</span>
                        </div>
                        <div v-if="settings?.voltage_limit != null" class="et__limit-row">
                            <span class="et__form-label">Voltage max</span>
                            <input
                                v-if="canExecute && props.shellyID"
                                type="number"
                                class="et__num"
                                :value="settings.voltage_limit"
                                min="0"
                                @change="(e: Event) => setConfig({voltage_limit: Number((e.target as HTMLInputElement).value)})"
                            />
                            <span v-else class="et__panel-value">{{ settings.voltage_limit }}</span>
                            <span class="et__unit">V</span>
                        </div>
                        <div v-if="settings?.undervoltage_limit != null" class="et__limit-row">
                            <span class="et__form-label">Voltage min</span>
                            <input
                                v-if="canExecute && props.shellyID"
                                type="number"
                                class="et__num"
                                :value="settings.undervoltage_limit"
                                min="0"
                                @change="(e: Event) => setConfig({undervoltage_limit: Number((e.target as HTMLInputElement).value)})"
                            />
                            <span v-else class="et__panel-value">{{ settings.undervoltage_limit }}</span>
                            <span class="et__unit">V</span>
                        </div>
                    </div>
                </section>
            </div>
        </details>

        <!-- Inline config-error feedback -->
        <div v-if="configError" class="et__error" role="alert">
            <i class="fas fa-triangle-exclamation" /> {{ configError }}
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import HorizontalSlider from '@/components/core/HorizontalSlider.vue';
import {useAccordion} from '@/composables/useAccordion';
import {useDeviceCalibration} from '@/composables/useDeviceCalibration';
import {useNightMode} from '@/composables/useNightMode';
import {useResetCounters} from '@/composables/useResetCounters';
import {useToggleAfter} from '@/composables/useToggleAfter';
import {formatDuration} from '@/helpers/format';
import {formatCurrent, metricText} from '@/helpers/powerMetrics';
import {formatSource} from '@/helpers/sourceLabels';
import {useLightControl} from './useLightControl';

const props = defineProps<{
    status: Record<string, any> | undefined;
    settings: Record<string, any> | undefined;
    canExecute: boolean;
    shellyID?: string;
    entityId?: string;
}>();

const emit = defineEmits<{
    toggle: [];
    setBrightness: [number];
    setTemp: [number];
    toggleAfter: [seconds: number];
}>();

const {isOn, configError, setConfig} = useLightControl(props, 'Light');

const {resetCounters} = useResetCounters({
    entityId: () => props.entityId,
    configError
});

// Dimmer calibration — default 120s safety timeout (lights are faster than covers).
const {isCalibrating, calibrationProgress, calibrate, finishCalibration} =
    useDeviceCalibration({
        entityId: () => props.entityId,
        configError
    });

const {toggleAfterSec, doToggleAfter} = useToggleAfter((sec) =>
    emit('toggleAfter', sec)
);

const {collapsed, toggle: toggleSection, onKey: onSectionKey} = useAccordion();

// ProDimmer 2PM calibration signals (observed on real hardware):
//   During: status.calibration = {progress: N}, status.flags = ["uncalibrated"]
//   Done:   calibration + flags disappear from GetStatus
//   Error:  status.errors = ["cal_abort:no_load"], flags stays "uncalibrated"
// The backend mergeStatusObjects never deletes keys, so we detect completion by
// the watchers below (calibration cleared / flags cleared / cal_abort error).
watch(
    () => props.status?.calibration,
    (cal, oldCal) => {
        if (cal == null && oldCal != null && isCalibrating.value) {
            finishCalibration();
            return;
        }
        if (cal && typeof cal === 'object') {
            isCalibrating.value = true;
            configError.value = null;
            if (cal.progress != null) {
                calibrationProgress.value = cal.progress;
            }
        }
    },
    {deep: true}
);

watch(
    () => props.status?.flags,
    (flags, oldFlags) => {
        if (!isCalibrating.value) return;
        const wasUncalibrated = oldFlags?.includes('uncalibrated');
        const isNowUncalibrated = flags?.includes('uncalibrated');
        if (wasUncalibrated && !isNowUncalibrated) finishCalibration();
    },
    {deep: true}
);

watch(
    () => props.status?.errors,
    (errors) => {
        if (!isCalibrating.value || !errors?.length) return;
        const calErrors = (errors as string[]).filter((e: string) =>
            e.startsWith('cal_abort:')
        );
        if (calErrors.length) {
            configError.value = `Calibration failed: ${calErrors.join(', ')}`;
            finishCalibration();
        }
    },
    {deep: true}
);

const tempRange = computed(() => ({
    min: props.settings?.min_temp_k ?? 2700,
    max: props.settings?.max_temp_k ?? 6500
}));
const tempPresets = computed(() => {
    const {min, max} = tempRange.value;
    return {Warm: min, '3500K': 3500, '4500K': 4500, Cool: max};
});

const {nightMode, setNightTime} = useNightMode(() => props.settings, setConfig);

// Calibration warnings — flags can live at root level or inside calibration object.
const calibrationFlags = computed(() => {
    const rootFlags = props.status?.flags as string[] | undefined;
    const calFlags = props.status?.calibration?.flags as string[] | undefined;
    return rootFlags ?? calFlags ?? [];
});
const calibrationWarning = computed(() => {
    if (calibrationFlags.value.includes('uncalibrated'))
        return 'Uncalibrated — calibration recommended';
    if (calibrationFlags.value.includes('no_load')) return 'No load detected';
    return null;
});
const statusErrors = computed(() => (props.status?.errors as string[]) ?? []);

const deviceTemp = computed(() => props.status?.temperature?.tC ?? null);

const inputModes = [
    {value: 'dim', label: 'Dimmer'},
    {value: 'dual_dim', label: 'Dual Dimmer'},
    {value: 'follow', label: 'Follow'},
    {value: 'flip', label: 'Flip'},
    {value: 'activate', label: 'Activate'},
    {value: 'detached', label: 'Detached'}
];

function formatInMode(mode: string): string {
    const map: Record<string, string> = {
        dim: 'Dimmer',
        dual_dim: 'Dual Dimmer',
        follow: 'Follow',
        flip: 'Flip',
        activate: 'Activate',
        detached: 'Detached'
    };
    return map[mode] ?? mode.replace(/_/g, ' ');
}

const hasConfigurableSettings = computed(() => {
    const s = props.settings;
    if (!s) return false;
    return (
        s.name != null ||
        s.initial_state ||
        s.in_mode ||
        s.op_mode != null ||
        s.min_brightness_on_toggle != null ||
        s.range_map?.length === 2 ||
        s.transition_duration != null ||
        s.button_fade_rate != null ||
        s.button_presets?.button_doublepush?.brightness != null ||
        s.auto_on !== undefined ||
        s.auto_off !== undefined ||
        s.power_limit != null ||
        s.current_limit != null ||
        s.voltage_limit != null ||
        s.undervoltage_limit != null
    );
});
</script>

<style src="./entityTemplate.css"></style>

<style scoped>
/* Light-specific: dimmed-when-off slider, calibrate progress, time inputs */
.et-light__dimmed {
    opacity: 0.45;
    transition: opacity var(--motion-state);
}
.et-light__dimmed:hover,
.et-light__dimmed:focus-within {
    opacity: 0.8;
}
.et-light__calibrate-wrap {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
.et-light__calibrate--active {
    border-color: var(--color-warning);
    color: var(--color-warning-text);
}
.et-light__calibrate-bar {
    height: 3px;
    border-radius: var(--radius-xs);
    background-color: var(--color-surface-3);
    overflow: hidden;
}
.et-light__calibrate-fill {
    height: 100%;
    background-color: var(--color-warning);
    border-radius: var(--radius-xs);
    transition: width 0.3s ease;
}
.et-light__temp-warn {
    margin-left: var(--space-2);
    color: var(--color-warning-text);
    font-weight: var(--font-semibold);
}
.et-light__time-row {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
.et-light__time-inputs {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
.et-light__time-input {
    width: auto;
    min-width: 0;
}
.et-light__range-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
}
</style>
