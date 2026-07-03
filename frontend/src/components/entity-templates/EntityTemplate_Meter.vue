<template>
    <div class="et">
        <!-- Hero: dominant power reading -->
        <header v-if="heroPower !== null" class="et__hero">
            <div class="et__hero-value">{{ heroPower }} W</div>
            <div class="et__hero-label">Power</div>
        </header>

        <!-- Banners: errors / flags / data errors / calibration -->
        <div v-if="status?.errors?.length" class="et__banner et__banner--danger" role="alert">
            <i class="fas fa-triangle-exclamation" />
            <span class="et__banner-list">
                <span v-for="err in status.errors" :key="err">{{ err }}</span>
            </span>
        </div>
        <div v-if="status?.flags?.length" class="et__banner et__banner--warning">
            <i class="fas fa-info-circle" />
            <span class="et__banner-list">
                <span v-for="flag in status.flags" :key="flag">{{ flag }}</span>
            </span>
        </div>
        <div v-if="dataStatus?.errors?.length" class="et__banner et__banner--danger" role="alert">
            <i class="fas fa-triangle-exclamation" />
            <span class="et__banner-list">
                <span v-for="err in dataStatus.errors" :key="err">Data: {{ err }}</span>
            </span>
        </div>
        <div v-if="status?.calibration" class="et__banner et__banner--info">
            <i class="fas fa-sliders" />
            <span>Calibration: {{ status.calibration }}</span>
        </div>

        <!-- KPI strip: secondary metrics -->
        <ul v-if="secondaryMetrics.length > 0" class="et__kpis">
            <li v-for="m in secondaryMetrics" :key="m.label" class="et__kpi">
                <span class="et__kpi-value">{{ m.value }}</span>
                <span class="et__kpi-label">{{ m.label }}</span>
            </li>
        </ul>

        <!-- Energy panel -->
        <section v-if="hasEnergy" class="et__panel">
            <div v-if="totalEnergy !== null" class="et__panel-row">
                <span>Total energy</span>
                <span class="et__panel-value">{{ totalEnergy }} <small>kWh</small></span>
            </div>
            <div v-if="returnedEnergy !== null" class="et__panel-row">
                <span>Returned energy</span>
                <span class="et__panel-value">{{ returnedEnergy }} <small>kWh</small></span>
            </div>
        </section>

        <!-- Reset counters chip -->
        <div v-if="canExecute && shellyID && hasEnergy" class="et__chip-row">
            <button type="button" class="et__chip" @click="resetCounters">
                <i class="fas fa-rotate-left" /><span>Reset counters</span>
            </button>
        </div>

        <!-- Net Energy (EM1 only) -->
        <section v-if="isEM1 && shellyID && canExecute" class="et__panel">
            <header
                class="et__section-head"
                role="button"
                tabindex="0"
                :aria-expanded="!collapsed.has('netenergy')"
                @click="toggleSection('netenergy')"
                @keydown="onSectionKey($event, 'netenergy')"
            >
                <span class="et__section-title"><i class="fas fa-chart-line" /> Net energy</span>
                <i class="fas et__chevron" :class="collapsed.has('netenergy') ? 'fa-chevron-right' : 'fa-chevron-down'" />
            </header>
            <template v-if="!collapsed.has('netenergy')">
                <div class="et-meter__net-controls">
                    <select
                        class="et__select"
                        :value="netPeriod"
                        @change="(e: Event) => { netPeriod = Number((e.target as HTMLSelectElement).value); loadNetEnergy(); }"
                    >
                        <option :value="3600">Hourly</option>
                        <option :value="300">5 min</option>
                    </select>
                    <select
                        class="et__select"
                        :value="netHours"
                        @change="(e: Event) => { netHours = Number((e.target as HTMLSelectElement).value); loadNetEnergy(); }"
                    >
                        <option :value="6">Last 6h</option>
                        <option :value="12">Last 12h</option>
                        <option :value="24">Last 24h</option>
                    </select>
                    <button
                        type="button"
                        class="et__chip"
                        :disabled="netLoading"
                        :aria-label="netLoading ? 'Loading…' : 'Refresh'"
                        @click="loadNetEnergy"
                    >
                        <i :class="netLoading ? 'fas fa-spinner fa-spin' : 'fas fa-rotate'" />
                    </button>
                </div>
                <div v-if="netEntries.length > 0" class="et-meter__net-list">
                    <div v-for="entry in netEntries" :key="entry.time" class="et-meter__net-row">
                        <span class="et-meter__net-time">{{ entry.time }}</span>
                        <span
                            class="et-meter__net-val"
                            :class="entry.value >= 0 ? 'et-meter__net-val--pos' : 'et-meter__net-val--neg'"
                        >
                            {{ entry.value >= 0 ? '+' : '' }}{{ entry.value.toFixed(2) }} Wh
                        </span>
                    </div>
                </div>
                <div v-else-if="!netLoading" class="et-meter__net-empty">No data available</div>
            </template>
        </section>

        <!-- Configure: meter settings (EM1) -->
        <details v-if="canExecute && settings && shellyID && isEM1" class="et__configure">
            <summary class="et__configure-summary">
                <span><i class="fas fa-gear" /> Configure</span>
                <i class="fas fa-chevron-down et__configure-chevron" />
            </summary>

            <div class="et__configure-body">
                <!-- Meter settings -->
                <section class="et__group">
                    <header
                        class="et__section-head"
                        role="button"
                        tabindex="0"
                        :aria-expanded="!collapsed.has('settings')"
                        @click="toggleSection('settings')"
                        @keydown="onSectionKey($event, 'settings')"
                    >
                        <span class="et__section-title">Channel</span>
                        <i class="fas et__chevron" :class="collapsed.has('settings') ? 'fa-chevron-right' : 'fa-chevron-down'" />
                    </header>
                    <div v-if="!collapsed.has('settings')" class="et__form">
                        <label v-if="settings.name != null" class="et__form-row">
                            <span class="et__form-label">Name</span>
                            <input
                                type="text"
                                class="et__text"
                                :value="settings.name"
                                placeholder="Channel name"
                                @change="(e: Event) => setConfig({name: (e.target as HTMLInputElement).value})"
                            />
                        </label>
                        <label v-if="settings.ct_type != null" class="et__form-row">
                            <span class="et__form-label">CT type</span>
                            <select
                                class="et__select"
                                :value="settings.ct_type"
                                @change="(e: Event) => setConfig({ct_type: (e.target as HTMLSelectElement).value})"
                            >
                                <option v-for="ct in ctTypes" :key="ct" :value="ct">{{ ct }}</option>
                            </select>
                        </label>
                        <div v-if="settings.reverse != null" class="et__form-row et__form-row--inline">
                            <span class="et__form-label">Reverse direction</span>
                            <button
                                type="button"
                                class="et__switch"
                                :class="settings.reverse && 'et__switch--on'"
                                :aria-pressed="!!settings.reverse"
                                @click="confirmReverse"
                            ><span class="et__switch-thumb" /></button>
                        </div>
                        <div v-if="status?.calibration" class="et__form-row et__form-row--inline">
                            <span class="et__form-label">Revert to factory calibration</span>
                            <button type="button" class="et__chip" @click="revertCalibration">
                                <i class="fas fa-rotate-left" /><span>Revert</span>
                            </button>
                        </div>
                        <div v-if="calibrateOtherId != null" class="et__form-row et__form-row--inline">
                            <span class="et__form-label">Calibrate from channel {{ calibrateOtherId }}</span>
                            <button type="button" class="et__chip" @click="calibrateFrom">
                                <i class="fas fa-arrows-left-right" /><span>Calibrate</span>
                            </button>
                        </div>
                    </div>
                </section>

                <!-- Alarms -->
                <section v-if="settings.alarms" class="et__group">
                    <header
                        class="et__section-head"
                        role="button"
                        tabindex="0"
                        :aria-expanded="!collapsed.has('alarms')"
                        @click="toggleSection('alarms')"
                        @keydown="onSectionKey($event, 'alarms')"
                    >
                        <span class="et__section-title"><i class="fas fa-bell" /> Alarms</span>
                        <i class="fas et__chevron" :class="collapsed.has('alarms') ? 'fa-chevron-right' : 'fa-chevron-down'" />
                    </header>
                    <div v-if="!collapsed.has('alarms')" class="et__form">
                        <div v-for="alarm in ['voltage', 'current', 'power']" :key="alarm" class="et__limit-row">
                            <span class="et__form-label">{{ alarm.charAt(0).toUpperCase() + alarm.slice(1) }}</span>
                            <input
                                type="number"
                                class="et__num"
                                :value="settings.alarms[alarm]?.[0]"
                                placeholder="Min"
                                @change="(e: Event) => setAlarm(alarm, {index: 0, value: (e.target as HTMLInputElement).value})"
                            />
                            <span class="et__form-label">–</span>
                            <input
                                type="number"
                                class="et__num"
                                :value="settings.alarms[alarm]?.[1]"
                                placeholder="Max"
                                @change="(e: Event) => setAlarm(alarm, {index: 1, value: (e.target as HTMLInputElement).value})"
                            />
                            <span class="et__unit">{{ alarm === 'voltage' ? 'V' : alarm === 'current' ? 'A' : 'W' }}</span>
                        </div>
                    </div>
                </section>
            </div>
        </details>

        <!-- Danger: delete all energy data -->
        <div v-if="canExecute && shellyID && isEM1 && hasEnergy" class="et__chip-row">
            <button type="button" class="et__chip et__chip--danger" @click="deleteAllData">
                <span>Delete all energy data</span>
            </button>
        </div>

        <!-- Read-only summary -->
        <section v-if="!canExecute && settings && isEM1" class="et__readonly">
            <h4 class="et__section-title"><i class="fas fa-gear" /> Meter settings</h4>
            <dl class="et__kv">
                <div v-if="settings.name" class="et__kv-row"><dt>Name</dt><dd>{{ settings.name }}</dd></div>
                <div v-if="settings.ct_type" class="et__kv-row"><dt>CT type</dt><dd>{{ settings.ct_type }}</dd></div>
                <div v-if="settings.reverse != null" class="et__kv-row"><dt>Reverse</dt><dd>{{ settings.reverse ? 'Yes' : 'No' }}</dd></div>
                <div v-if="status?.calibration" class="et__kv-row"><dt>Calibration</dt><dd>{{ status.calibration }}</dd></div>
            </dl>
        </section>

        <!-- Error feedback -->
        <div v-if="configError" class="et__error" role="alert">
            <i class="fas fa-triangle-exclamation" /> {{ configError }}
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, ref} from 'vue';
import {useAccordion} from '@/composables/useAccordion';
import {buildPowerMetrics, formatKwh} from '@/helpers/powerMetrics';
import {useDevicesStore} from '@/stores/devices';
import {sendRPC} from '@/tools/websocket';

const props = defineProps<{
    status: Record<string, any> | undefined;
    settings: Record<string, any> | undefined;
    canExecute: boolean;
    shellyID?: string;
}>();

const deviceStore = useDevicesStore();
const configError = ref<string | null>(null);
const ctTypes = ref<string[]>([]);

const {collapsed, toggle: toggleSection, onKey: onSectionKey} = useAccordion();

// Detect EM1 vs PM1 — EM1 has act_power and ct_type in config
const isEM1 = computed(
    () =>
        props.status?.act_power !== undefined ||
        props.settings?.ct_type !== undefined
);

// Energy totals — from em1data/pm1 status via device store
const dataStatus = computed(() => {
    if (!props.shellyID) return null;
    const device = deviceStore.devices[props.shellyID];
    if (!device) return null;
    const id = props.status?.id ?? 0;
    // em1data:N for EM1, pm1 status itself has aenergy for PM1
    if (isEM1.value) {
        return device.status?.[`em1data:${id}`] ?? null;
    }
    return null;
});

const metrics = computed(() => buildPowerMetrics(props.status));

const heroPower = computed(() => {
    const power = props.status?.apower ?? props.status?.act_power;
    return power !== undefined ? power : null;
});

const secondaryMetrics = computed(() =>
    metrics.value.filter((m) => m.label !== 'Power')
);

// PM1 stores aenergy.total in mWh; EM1 stores em1data totals already in Wh.
// formatKwh divides by 1000 — both call sites pass the raw value as-is.
const totalEnergy = computed(
    () =>
        formatKwh(props.status?.aenergy?.total) ??
        formatKwh(dataStatus.value?.total_act_energy)
);

const returnedEnergy = computed(
    () =>
        formatKwh(props.status?.ret_aenergy?.total) ??
        formatKwh(dataStatus.value?.total_act_ret_energy)
);

const hasEnergy = computed(
    () => totalEnergy.value !== null || returnedEnergy.value !== null
);

async function resetCounters() {
    if (!props.shellyID) return;
    configError.value = null;
    const id = props.status?.id ?? 0;
    const ns = isEM1.value ? 'Em1Data' : 'Pm1';
    try {
        await sendRPC('FLEET_MANAGER', `${ns}.ResetCounters`, {
            shellyID: props.shellyID,
            id
        });
    } catch (e: any) {
        configError.value = e.message || 'Failed to reset counters';
    }
}

// Net energy query
const netPeriod = ref(3600);
const netHours = ref(12);
const netLoading = ref(false);
const netEntries = ref<{time: string; value: number}[]>([]);

async function loadNetEnergy() {
    if (!props.shellyID || !isEM1.value) return;
    netLoading.value = true;
    netEntries.value = [];
    const id = props.status?.id ?? 0;
    const now = Math.floor(Date.now() / 1000);
    const period = netPeriod.value;
    const ts = Math.floor((now - netHours.value * 3600) / period) * period;
    try {
        const result = await sendRPC<{data?: any[]}>(
            'FLEET_MANAGER',
            'Em1Data.GetNetEnergies',
            {shellyID: props.shellyID, id, ts, period}
        );
        const data = result?.data;
        if (data?.length) {
            const block = data[0];
            const entries: {time: string; value: number}[] = [];
            for (let i = 0; i < block.values.length; i++) {
                const entryTs = block.ts + i * block.period;
                const d = new Date(entryTs * 1000);
                const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                entries.push({time, value: block.values[i][0]});
            }
            netEntries.value = entries;
        }
    } catch (e: any) {
        configError.value = e.message || 'Failed to load net energy';
    } finally {
        netLoading.value = false;
    }
}

function confirmReverse() {
    const msg =
        'Reversing measurement direction requires a device restart. Continue?';
    if (window.confirm(msg)) {
        setConfig({reverse: !props.settings?.reverse});
    }
}

// Find the other EM1 channel ID for CalibrateFrom
const calibrateOtherId = computed(() => {
    if (!props.shellyID || !isEM1.value) return null;
    const device = deviceStore.devices[props.shellyID];
    if (!device) return null;
    const myId = props.status?.id ?? 0;
    // Find other em1:N keys in status
    for (const key of Object.keys(device.status ?? {})) {
        if (key.startsWith('em1:')) {
            const otherId = Number.parseInt(key.split(':')[1], 10);
            if (otherId !== myId) return otherId;
        }
    }
    return null;
});

async function calibrateFrom() {
    if (!props.shellyID || calibrateOtherId.value == null) return;
    const msg = `Calibrate this channel from channel ${calibrateOtherId.value}? Requires minimum 500W load. Takes ~5 seconds.`;
    if (!window.confirm(msg)) return;
    configError.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Em1.CalibrateFrom', {
            shellyID: props.shellyID,
            id: props.status?.id ?? 0,
            other_id: calibrateOtherId.value
        });
    } catch (e: any) {
        configError.value = e.message || 'Calibration failed';
    }
}

function setAlarm(type: string, change: {index: number; value: string}) {
    if (!props.shellyID) return;
    const current = props.settings?.alarms?.[type] ?? [null, null];
    const updated = [...current];
    updated[change.index] = change.value.trim() ? Number(change.value) : null;
    setConfig({alarms: {[type]: updated}});
}

async function deleteAllData() {
    if (!props.shellyID) return;
    if (
        !window.confirm(
            'Delete ALL stored energy data for this channel? This cannot be undone.'
        )
    )
        return;
    configError.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Em1Data.DeleteAllData', {
            shellyID: props.shellyID,
            id: props.status?.id ?? 0
        });
    } catch (e: any) {
        configError.value = e.message || 'Failed to delete data';
    }
}

async function revertCalibration() {
    if (!props.shellyID) return;
    const msg =
        'Revert to factory calibration? This will discard any custom calibration.';
    if (!window.confirm(msg)) return;
    configError.value = null;
    try {
        await sendRPC(
            'FLEET_MANAGER',
            'Em1.RevertToFactoryCalibration',
            {shellyID: props.shellyID, id: props.status?.id ?? 0}
        );
    } catch (e: any) {
        configError.value = e.message || 'Failed to revert calibration';
    }
}

async function setConfig(config: Record<string, any>) {
    if (!props.shellyID) return;
    configError.value = null;
    const id = props.status?.id ?? 0;
    const ns = isEM1.value ? 'Em1' : 'Pm1';
    try {
        await sendRPC('FLEET_MANAGER', `${ns}.SetConfig`, {
            shellyID: props.shellyID,
            id,
            config
        });
    } catch (e: any) {
        configError.value = e.message || 'Failed to set config';
    }
}

async function loadCTTypes() {
    if (!props.shellyID || !isEM1.value) return;
    try {
        const result = await sendRPC<{supported?: string[]}>(
            'FLEET_MANAGER',
            'Em1.GetCTTypes',
            {shellyID: props.shellyID, id: props.status?.id ?? 0}
        );
        ctTypes.value = result?.supported ?? [];
    } catch {
        // Device may not support GetCTTypes — use defaults
        ctTypes.value = ['50A', '80A', '120A'];
    }
}

onMounted(() => {
    if (props.shellyID && isEM1.value) loadCTTypes();
});
</script>

<style src="./entityTemplate.css"></style>

<style scoped>
/* Meter-specific: net-energy list rows */
.et-meter__net-controls {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
}
.et-meter__net-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    max-height: 14rem;
    overflow-y: auto;
    margin-top: var(--space-2);
}
.et-meter__net-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: var(--type-body);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
}
.et-meter__net-row:nth-child(even) {
    background-color: var(--color-surface-3);
}
.et-meter__net-time {
    color: var(--color-text-quaternary);
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    font-variant-numeric: tabular-nums;
}
.et-meter__net-val {
    font-weight: var(--font-semibold);
    font-variant-numeric: tabular-nums;
}
.et-meter__net-val--pos {
    color: var(--color-success-text);
}
.et-meter__net-val--neg {
    color: var(--color-danger-text);
}
.et-meter__net-empty {
    font-size: var(--type-body);
    color: var(--color-text-quaternary);
    text-align: center;
    padding: var(--space-3);
}
</style>
