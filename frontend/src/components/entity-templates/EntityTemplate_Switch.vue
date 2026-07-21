<template>
    <div class="et">
        <!-- Hero: dominant headline value (only on power-metering devices) -->
        <header v-if="metrics.length > 0" class="et__hero">
            <div class="et__hero-value">{{ metrics[0].value }}</div>
            <div class="et__hero-label">{{ metrics[0].label }}</div>
        </header>

        <!-- Primary affordance: the toggle row IS the main control surface -->
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

        <!-- Banners (only when actively triggering attention) -->
        <div v-if="status?.errors?.length" class="et__banner et__banner--danger" role="alert">
            <i class="fas fa-triangle-exclamation" />
            <span class="et__banner-list">
                <span v-for="err in status.errors" :key="err">{{ formatError(err) }}</span>
            </span>
        </div>
        <div
            v-if="status?.timer_started_at != null && status?.timer_duration != null"
            class="et__banner et__banner--warning"
        >
            <i class="fas fa-hourglass-half" />
            <span>Auto-toggle in {{ formatDuration(status.timer_duration) }}</span>
        </div>

        <!-- KPI strip: secondary telemetry, equal-width tiles -->
        <ul v-if="metrics.length > 1" class="et__kpis">
            <li v-for="m in metrics.slice(1)" :key="m.label" class="et__kpi">
                <span class="et__kpi-value">{{ m.value }}</span>
                <span class="et__kpi-label">{{ m.label }}</span>
            </li>
        </ul>

        <!-- Energy summary -->
        <section v-if="totalEnergy !== null || returnedEnergy !== null" class="et__energy">
            <div v-if="totalEnergy !== null" class="et__energy-row">
                <span>Total energy</span>
                <span class="et__energy-value">{{ totalEnergy }} <small>kWh</small></span>
            </div>
            <div v-if="returnedEnergy !== null" class="et__energy-row">
                <span>Returned energy</span>
                <span class="et__energy-value">{{ returnedEnergy }} <small>kWh</small></span>
            </div>
            <div v-if="status?.aenergy?.by_minute?.length" class="et__energy-row">
                <span>Last 3 minutes</span>
                <span class="et__energy-value">{{ status.aenergy.by_minute.join(' / ') }} <small>mWh</small></span>
            </div>
        </section>

        <!-- Quick action: schedule a delayed toggle -->
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
        </div>

        <!-- Counters: lifetime telemetry, action sits on the section header -->
        <section v-if="counters" class="et__counters">
            <header
                class="et__section-head"
                role="button"
                tabindex="0"
                :aria-expanded="!collapsed.has('counters-status')"
                @click="toggleSection('counters-status')"
                @keydown="onSectionKey($event, 'counters-status')"
            >
                <span class="et__section-title"><i class="fas fa-clock-rotate-left" /> Counters</span>
                <button
                    v-if="canExecute && props.shellyID"
                    type="button"
                    class="et__chip"
                    @click.stop="resetCounters"
                >
                    <i class="fas fa-rotate-left" /> Reset
                </button>
                <i
                    class="fas et__chevron"
                    :class="collapsed.has('counters-status') ? 'fa-chevron-right' : 'fa-chevron-down'"
                />
            </header>
            <dl v-if="!collapsed.has('counters-status')" class="et__kv">
                <div v-if="counters.on_time != null" class="et__kv-row">
                    <dt>On time</dt><dd>{{ formatDuration(counters.on_time) }}</dd>
                </div>
                <div v-if="counters.switch_on != null" class="et__kv-row">
                    <dt>Switch-on count</dt><dd>{{ counters.switch_on }}</dd>
                </div>
                <div v-if="counters.on_above_thr != null" class="et__kv-row">
                    <dt>On above threshold</dt><dd>{{ formatDuration(counters.on_above_thr) }}</dd>
                </div>
            </dl>
        </section>

        <!-- Configure: full settings, collapsed by default. Sub-sections remain
             accordion-driven so the existing useAccordion contract is preserved. -->
        <details v-if="canExecute && settings && props.shellyID" class="et__configure">
            <summary class="et__configure-summary">
                <span><i class="fas fa-gear" /> Configure</span>
                <i class="fas fa-chevron-down et__configure-chevron" />
            </summary>

            <div class="et__configure-body">
                <!-- Output -->
                <section class="et__group">
                    <header
                        class="et__section-head"
                        role="button"
                        tabindex="0"
                        :aria-expanded="!collapsed.has('settings')"
                        @click="toggleSection('settings')"
                        @keydown="onSectionKey($event, 'settings')"
                    >
                        <span class="et__section-title">Output</span>
                        <i
                            class="fas et__chevron"
                            :class="collapsed.has('settings') ? 'fa-chevron-right' : 'fa-chevron-down'"
                        />
                    </header>
                    <div v-if="!collapsed.has('settings')" class="et__form">
                        <label v-if="settings.name != null" class="et__form-row">
                            <span class="et__form-label">Name</span>
                            <input
                                type="text"
                                class="et__text"
                                :value="settings.name"
                                placeholder="Output name"
                                @change="(e: Event) => setConfig({name: (e.target as HTMLInputElement).value})"
                            />
                        </label>
                        <label v-if="settings.initial_state != null" class="et__form-row">
                            <span class="et__form-label">Initial state on power-on</span>
                            <select
                                class="et__select"
                                :value="settings.initial_state"
                                @change="(e: Event) => setConfig({initial_state: (e.target as HTMLSelectElement).value})"
                            >
                                <option value="on">Turn on</option>
                                <option value="off">Turn off</option>
                                <option value="restore_last">Restore last state</option>
                                <option value="match_input">Match input</option>
                            </select>
                        </label>
                        <div v-if="settings.reverse != null" class="et__form-row et__form-row--inline">
                            <span class="et__form-label">Reverse power measurement</span>
                            <button
                                type="button"
                                class="et__switch"
                                :class="settings.reverse && 'et__switch--on'"
                                :aria-pressed="!!settings.reverse"
                                @click="setConfig({reverse: !settings.reverse})"
                            ><span class="et__switch-thumb" /></button>
                        </div>
                    </div>
                </section>

                <!-- Timers -->
                <section v-if="settings.auto_on !== undefined || settings.auto_off !== undefined" class="et__group">
                    <header
                        class="et__section-head"
                        role="button"
                        tabindex="0"
                        :aria-expanded="!collapsed.has('timers')"
                        @click="toggleSection('timers')"
                        @keydown="onSectionKey($event, 'timers')"
                    >
                        <span class="et__section-title">Timers</span>
                        <i
                            class="fas et__chevron"
                            :class="collapsed.has('timers') ? 'fa-chevron-right' : 'fa-chevron-down'"
                        />
                    </header>
                    <div v-if="!collapsed.has('timers')" class="et__form">
                        <div v-if="settings.auto_on !== undefined" class="et__timer-row">
                            <button
                                type="button"
                                class="et__pill"
                                :class="settings.auto_on && 'et__pill--on'"
                                @click="setConfig({auto_on: !settings.auto_on})"
                            >Auto on</button>
                            <input
                                v-if="settings.auto_on"
                                type="number"
                                class="et__num"
                                :value="settings.auto_on_delay ?? 0"
                                min="0"
                                @change="(e: Event) => setConfig({auto_on_delay: Number((e.target as HTMLInputElement).value)})"
                            />
                            <span v-if="settings.auto_on" class="et__unit">sec</span>
                        </div>
                        <div v-if="settings.auto_off !== undefined" class="et__timer-row">
                            <button
                                type="button"
                                class="et__pill"
                                :class="settings.auto_off && 'et__pill--on'"
                                @click="setConfig({auto_off: !settings.auto_off})"
                            >Auto off</button>
                            <input
                                v-if="settings.auto_off"
                                type="number"
                                class="et__num"
                                :value="settings.auto_off_delay ?? 0"
                                min="0"
                                @change="(e: Event) => setConfig({auto_off_delay: Number((e.target as HTMLInputElement).value)})"
                            />
                            <span v-if="settings.auto_off" class="et__unit">sec</span>
                        </div>
                    </div>
                </section>

                <!-- Input -->
                <section v-if="settings.in_mode != null || settings.in_locked != null" class="et__group">
                    <header
                        class="et__section-head"
                        role="button"
                        tabindex="0"
                        :aria-expanded="!collapsed.has('input')"
                        @click="toggleSection('input')"
                        @keydown="onSectionKey($event, 'input')"
                    >
                        <span class="et__section-title">Input</span>
                        <i
                            class="fas et__chevron"
                            :class="collapsed.has('input') ? 'fa-chevron-right' : 'fa-chevron-down'"
                        />
                    </header>
                    <div v-if="!collapsed.has('input')" class="et__form">
                        <div v-if="settings.in_mode != null" class="et__modes">
                            <label
                                v-for="mode in inModeOptions"
                                :key="mode.value"
                                class="et__mode"
                                :class="settings.in_mode === mode.value && 'et__mode--on'"
                            >
                                <input
                                    type="radio"
                                    :value="mode.value"
                                    :checked="settings.in_mode === mode.value"
                                    @change="setConfig({in_mode: mode.value})"
                                />
                                <span class="et__mode-text">
                                    <span class="et__mode-name">{{ mode.label }}</span>
                                    <span class="et__mode-hint">{{ mode.description }}</span>
                                </span>
                            </label>
                        </div>
                        <div v-if="settings.in_locked != null" class="et__form-row et__form-row--inline">
                            <span class="et__form-label">Lock input</span>
                            <button
                                type="button"
                                class="et__switch"
                                :class="settings.in_locked && 'et__switch--on'"
                                :aria-pressed="!!settings.in_locked"
                                @click="setConfig({in_locked: !settings.in_locked})"
                            ><span class="et__switch-thumb" /></button>
                        </div>
                    </div>
                </section>

                <!-- Protections -->
                <section
                    v-if="settings.power_limit != null || settings.current_limit != null || settings.voltage_limit != null"
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
                        <i
                            class="fas et__chevron"
                            :class="collapsed.has('protections') ? 'fa-chevron-right' : 'fa-chevron-down'"
                        />
                    </header>
                    <div v-if="!collapsed.has('protections')" class="et__form">
                        <div v-if="settings.power_limit != null" class="et__limit-row">
                            <span class="et__form-label">Power max</span>
                            <input
                                type="number"
                                class="et__num"
                                :value="settings.power_limit"
                                min="0"
                                @change="(e: Event) => setConfig({power_limit: Number((e.target as HTMLInputElement).value)})"
                            />
                            <span class="et__unit">W</span>
                        </div>
                        <div v-if="settings.current_limit != null" class="et__limit-row">
                            <span class="et__form-label">Current max</span>
                            <input
                                type="number"
                                class="et__num"
                                :value="settings.current_limit"
                                min="0"
                                step="0.1"
                                @change="(e: Event) => setConfig({current_limit: Number((e.target as HTMLInputElement).value)})"
                            />
                            <span class="et__unit">A</span>
                        </div>
                        <div v-if="settings.voltage_limit != null" class="et__limit-row">
                            <span class="et__form-label">Voltage max</span>
                            <input
                                type="number"
                                class="et__num"
                                :value="settings.voltage_limit"
                                min="0"
                                @change="(e: Event) => setConfig({voltage_limit: Number((e.target as HTMLInputElement).value)})"
                            />
                            <span class="et__unit">V</span>
                        </div>
                        <div v-if="settings.undervoltage_limit != null" class="et__limit-row">
                            <span class="et__form-label">Voltage min</span>
                            <input
                                type="number"
                                class="et__num"
                                :value="settings.undervoltage_limit"
                                min="0"
                                @change="(e: Event) => setConfig({undervoltage_limit: Number((e.target as HTMLInputElement).value)})"
                            />
                            <span class="et__unit">V</span>
                        </div>
                        <div v-if="settings.autorecover_voltage_errors != null" class="et__form-row et__form-row--inline">
                            <span class="et__form-label">Auto-recover voltage errors</span>
                            <button
                                type="button"
                                class="et__switch"
                                :class="settings.autorecover_voltage_errors && 'et__switch--on'"
                                :aria-pressed="!!settings.autorecover_voltage_errors"
                                @click="setConfig({autorecover_voltage_errors: !settings.autorecover_voltage_errors})"
                            ><span class="et__switch-thumb" /></button>
                        </div>
                    </div>
                </section>

                <!-- Counters config -->
                <section v-if="settings.counts" class="et__group">
                    <header
                        class="et__section-head"
                        role="button"
                        tabindex="0"
                        :aria-expanded="!collapsed.has('counters-config')"
                        @click="toggleSection('counters-config')"
                        @keydown="onSectionKey($event, 'counters-config')"
                    >
                        <span class="et__section-title">Counters</span>
                        <i
                            class="fas et__chevron"
                            :class="collapsed.has('counters-config') ? 'fa-chevron-right' : 'fa-chevron-down'"
                        />
                    </header>
                    <div v-if="!collapsed.has('counters-config')" class="et__form">
                        <div class="et__form-row et__form-row--inline">
                            <span class="et__form-label">Enabled</span>
                            <button
                                type="button"
                                class="et__switch"
                                :class="settings.counts.enable && 'et__switch--on'"
                                :aria-pressed="!!settings.counts.enable"
                                @click="setConfig({counts: {enable: !settings.counts.enable}})"
                            ><span class="et__switch-thumb" /></button>
                        </div>
                        <div v-if="settings.counts.enable && settings.counts.power_thr != null" class="et__limit-row">
                            <span class="et__form-label">Power threshold</span>
                            <input
                                type="number"
                                class="et__num"
                                :value="settings.counts.power_thr"
                                min="0"
                                @change="(e: Event) => setConfig({counts: {power_thr: Number((e.target as HTMLInputElement).value)}})"
                            />
                            <span class="et__unit">W</span>
                        </div>
                    </div>
                </section>
            </div>
        </details>

        <!-- Read-only summary when execute permission is missing -->
        <section v-if="!canExecute && settings" class="et__readonly">
            <h4 class="et__section-title"><i class="fas fa-gear" /> Settings</h4>
            <dl class="et__kv">
                <div v-if="settings.name" class="et__kv-row">
                    <dt>Name</dt><dd>{{ settings.name }}</dd>
                </div>
                <div v-if="settings.initial_state != null" class="et__kv-row">
                    <dt>Initial state</dt><dd>{{ initialStateLabel }}</dd>
                </div>
                <div v-if="settings.reverse != null" class="et__kv-row">
                    <dt>Reverse measurement</dt><dd>{{ settings.reverse ? 'Yes' : 'No' }}</dd>
                </div>
                <div v-if="settings.in_mode != null" class="et__kv-row">
                    <dt>Input mode</dt><dd>{{ inModeLabel }}</dd>
                </div>
                <div v-if="settings.in_locked != null" class="et__kv-row">
                    <dt>Input locked</dt><dd>{{ settings.in_locked ? 'Yes' : 'No' }}</dd>
                </div>
                <div v-if="settings.auto_on" class="et__kv-row">
                    <dt>Auto on</dt><dd>{{ settings.auto_on_delay ?? 0 }}s</dd>
                </div>
                <div v-if="settings.auto_off" class="et__kv-row">
                    <dt>Auto off</dt><dd>{{ settings.auto_off_delay ?? 0 }}s</dd>
                </div>
                <div v-if="settings.power_limit != null" class="et__kv-row">
                    <dt>Power max</dt><dd>{{ settings.power_limit }} W</dd>
                </div>
                <div v-if="settings.current_limit != null" class="et__kv-row">
                    <dt>Current max</dt><dd>{{ settings.current_limit }} A</dd>
                </div>
                <div v-if="settings.voltage_limit != null" class="et__kv-row">
                    <dt>Voltage max</dt><dd>{{ settings.voltage_limit }} V</dd>
                </div>
                <div v-if="settings.undervoltage_limit != null" class="et__kv-row">
                    <dt>Voltage min</dt><dd>{{ settings.undervoltage_limit }} V</dd>
                </div>
                <div v-if="settings.counts?.enable != null" class="et__kv-row">
                    <dt>Counters</dt><dd>{{ settings.counts.enable ? 'On' : 'Off' }}</dd>
                </div>
            </dl>
        </section>

        <!-- Config-call failure feedback -->
        <div v-if="configError" class="et__error" role="alert">
            <i class="fas fa-triangle-exclamation" /> {{ configError }}
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import {useAccordion} from '@/composables/useAccordion';
import {useResetCounters} from '@/composables/useResetCounters';
import {useToggleAfter} from '@/composables/useToggleAfter';
import {formatDuration} from '@/helpers/format';
import {buildPowerMetrics, formatKwh} from '@/helpers/powerMetrics';
import {formatSource} from '@/helpers/sourceLabels';
import {sendRPC} from '@/tools/websocket';

const props = defineProps<{
    status: Record<string, any> | undefined;
    settings: Record<string, any> | undefined;
    canExecute: boolean;
    shellyID?: string;
    entityId?: string;
}>();

const emit = defineEmits<{
    toggle: [];
    toggleAfter: [seconds: number];
}>();

const configError = ref<string | null>(null);

const {toggleAfterSec, doToggleAfter} = useToggleAfter((sec) =>
    emit('toggleAfter', sec)
);

const {resetCounters} = useResetCounters({
    entityId: () => props.entityId,
    configError
});

// Collapsible sections
const {collapsed, toggle: toggleSection, onKey: onSectionKey} = useAccordion();

const isOn = computed(() => !!props.status?.output);
const metrics = computed(() => buildPowerMetrics(props.status));
const totalEnergy = computed(() => formatKwh(props.status?.aenergy?.total));
const returnedEnergy = computed(() =>
    formatKwh(props.status?.ret_aenergy?.total)
);
const counters = computed(() => props.status?.counts ?? null);

const ERROR_LABELS: Record<string, string> = {
    overtemp: 'Overtemperature',
    overpower: 'Overpower',
    overvoltage: 'Overvoltage',
    undervoltage: 'Undervoltage'
};

function formatError(err: string): string {
    return ERROR_LABELS[err] ?? err;
}

// -- in_mode options --

const inModeOptions = [
    {
        value: 'follow',
        label: 'Toggle',
        description:
            'Act as a flip input with one state for ON and one state for OFF'
    },
    {
        value: 'momentary',
        label: 'Momentary',
        description:
            'Every push toggles the state ON \u2192 OFF or OFF \u2192 ON'
    },
    {
        value: 'flip',
        label: 'Edge',
        description: 'Changes state on every change of the switch state'
    },
    {
        value: 'detached',
        label: 'Detached',
        description: 'Input is separated/not changing state of the output'
    },
    {
        value: 'activate',
        label: 'Activation',
        description:
            'Used with motion sensor. Any input turns ON and resets Auto Off timer'
    },
    {
        value: 'cycle',
        label: 'Cycle',
        description: 'Toggles between outputs in sequence on each press'
    }
];

const inModeLabel = computed(() => {
    const opt = inModeOptions.find((o) => o.value === props.settings?.in_mode);
    return opt?.label ?? props.settings?.in_mode ?? '—';
});

const initialStateLabel = computed(() => {
    const map: Record<string, string> = {
        on: 'Turn ON',
        off: 'Turn OFF',
        restore_last: 'Restore last',
        match_input: 'Match input'
    };
    return (
        map[props.settings?.initial_state] ??
        props.settings?.initial_state ??
        '—'
    );
});

async function setConfig(config: Record<string, any>) {
    configError.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Switch.SetConfig', {
            shellyID: props.shellyID,
            id: props.status?.id ?? 0,
            config
        });
    } catch (e: any) {
        configError.value = e.message || 'Failed to set config';
    }
}
</script>


<style src="./entityTemplate.css"></style>
