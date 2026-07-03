<template>
    <div class="et">
        <!-- Primary visual: canonical multi-phase grid lives in EntityEM -->
        <EntityEM :entity="entity" />

        <template v-if="isTriphase">
            <!-- Meter settings -->
            <Collapse v-if="canExecute" title="Meter settings">
                <div class="et__form et-em__panel">
                    <label class="et__form-row">
                        <span class="et__form-label">Name</span>
                        <input
                            v-model="local.name"
                            class="et__text"
                            placeholder="(unnamed)"
                            @change="saveSetting({name: local.name})"
                        />
                    </label>

                    <div class="et__form-row">
                        <span class="et__form-label">Blink mode</span>
                        <span class="et-em__hint">What the front-panel LED indicates</span>
                        <div class="et-em__radio-group">
                            <label v-for="opt in BLINK_MODES" :key="opt.value" class="et-em__radio">
                                <input
                                    type="radio"
                                    class="core-radio"
                                    :value="opt.value"
                                    :checked="local.blinkMode === opt.value"
                                    @change="onBlinkChange(opt.value)"
                                />
                                <span>{{ opt.label }}</span>
                            </label>
                        </div>
                    </div>

                    <div class="et__form-row">
                        <span class="et__form-label">Phase selector</span>
                        <span class="et-em__hint">Phase used for selector-driven readings</span>
                        <div class="et-em__radio-group">
                            <label v-for="p in PHASE_SELECTORS" :key="p" class="et-em__radio">
                                <input
                                    type="radio"
                                    class="core-radio"
                                    :value="p"
                                    :checked="local.phaseSelector === p"
                                    @change="onPhaseSelectChange(p)"
                                />
                                <span>{{ p.toUpperCase() }}</span>
                            </label>
                        </div>
                    </div>

                    <div class="et__form-row et__form-row--inline">
                        <span class="et__form-label">Monitor phase sequence</span>
                        <Checkbox
                            v-model="local.monitorPhaseSequence"
                            @update:model-value="
                                saveSetting({
                                    monitor_phase_sequence:
                                        local.monitorPhaseSequence
                                })
                            "
                        />
                    </div>

                    <div v-if="ctTypes.length" class="et__form-row">
                        <span class="et__form-label">CT type</span>
                        <Dropdown
                            :default="local.ctType || ctTypes[0]"
                            :options="ctTypes"
                            @selected="onCtTypeChange"
                        />
                    </div>

                    <div class="et__form-row">
                        <span class="et__form-label">Reverse direction</span>
                        <span class="et-em__hint">Per-phase polarity flip</span>
                        <div class="et-em__phase-toggles">
                            <label v-for="p in PHASES" :key="p" class="et-em__phase-toggle">
                                <span>{{ p.toUpperCase() }}</span>
                                <Checkbox
                                    :model-value="local.reverse[p]"
                                    @update:model-value="(v: boolean) => onReverseChange(p, v)"
                                />
                            </label>
                        </div>
                    </div>

                    <div v-if="settingError" class="et__error" role="alert">
                        <i class="fas fa-triangle-exclamation" /> {{ settingError }}
                    </div>

                    <div v-if="rebootRequired" class="et__banner et__banner--warning">
                        <i class="fas fa-rotate-right" />
                        <span>Setting saved — reboot required to apply</span>
                        <Button
                            type="blue"
                            size="xs"
                            :loading="rebooting"
                            class="et-em__reboot-btn"
                            @click="rebootDevice"
                        >Reboot now</Button>
                    </div>
                    <div v-if="rebootError" class="et__error" role="alert">
                        <i class="fas fa-triangle-exclamation" /> {{ rebootError }}
                    </div>
                </div>
            </Collapse>

            <!-- Phase-to-phase calibration -->
            <Collapse v-if="canExecute" title="Phase-to-phase calibration">
                <div class="et__form et-em__panel">
                    <div class="et__form-row">
                        <span class="et__form-label">Source phase (from)</span>
                        <div class="et-em__radio-group">
                            <label v-for="p in PHASES" :key="p" class="et-em__radio">
                                <input
                                    type="radio"
                                    class="core-radio"
                                    :value="p"
                                    :checked="calibFrom === p"
                                    @change="calibFrom = p"
                                />
                                <span>{{ p.toUpperCase() }}</span>
                            </label>
                        </div>
                    </div>

                    <div class="et__form-row">
                        <span class="et__form-label">Target phase (to)</span>
                        <div class="et-em__radio-group">
                            <label v-for="p in PHASES" :key="p" class="et-em__radio">
                                <input
                                    type="radio"
                                    class="core-radio"
                                    :value="p"
                                    :checked="calibTo === p"
                                    :disabled="p === calibFrom"
                                    @change="calibTo = p"
                                />
                                <span>{{ p.toUpperCase() }}</span>
                            </label>
                        </div>
                    </div>

                    <div class="et-em__btn-group">
                        <Button
                            type="blue"
                            size="sm"
                            :loading="calibrating"
                            :disabled="!canCalibrate"
                            @click="runCalibration"
                        >
                            Calibrate
                        </Button>
                        <Button
                            type="blue-hollow"
                            size="sm"
                            :loading="resettingCalib"
                            :disabled="!calibTo"
                            @click="resetCalibrationFor(calibTo)"
                        >
                            Reset {{ calibTo ? calibTo.toUpperCase() : '' }}
                        </Button>
                    </div>

                    <div v-if="calibratedPhases.length" class="et__form-row">
                        <span class="et__form-label">Currently calibrated phases</span>
                        <div class="et-em__chip-row">
                            <span v-for="p in calibratedPhases" :key="p" class="et-em__cal-chip">
                                {{ p.toUpperCase() }}
                            </span>
                        </div>
                    </div>

                    <div v-if="calibError" class="et__error" role="alert">
                        <i class="fas fa-triangle-exclamation" /> {{ calibError }}
                    </div>
                </div>
            </Collapse>

            <!-- Net energy -->
            <Collapse title="Net energy">
                <div class="et__form et-em__panel">
                    <div class="et__form-row">
                        <span class="et__form-label">Period</span>
                        <div class="et-em__chip-row">
                            <button
                                v-for="p in NET_PERIODS"
                                :key="p.seconds"
                                type="button"
                                class="et__pill"
                                :class="{'et__pill--on': netPeriod === p.seconds}"
                                @click="netPeriod = p.seconds"
                            >{{ p.label }}</button>
                        </div>
                    </div>

                    <label class="et__form-row">
                        <span class="et__form-label">From</span>
                        <input v-model="netFromLocal" type="datetime-local" class="et__text" />
                    </label>

                    <label class="et__form-row">
                        <span class="et__form-label">To</span>
                        <input v-model="netToLocal" type="datetime-local" class="et__text" />
                    </label>

                    <div class="et-em__btn-group">
                        <Button
                            type="blue"
                            size="sm"
                            :loading="netLoading"
                            :disabled="!netRangeValid"
                            @click="loadNetEnergy"
                        >
                            Preview
                        </Button>
                        <Button
                            type="blue-hollow"
                            size="sm"
                            :disabled="netRows.length === 0"
                            @click="downloadCsv"
                        >
                            Download CSV
                        </Button>
                    </div>

                    <div v-if="netError" class="et__error" role="alert">
                        <i class="fas fa-triangle-exclamation" /> {{ netError }}
                    </div>

                    <div v-if="netRows.length > 0" class="et-em__net-table">
                        <div class="et-em__net-row et-em__net-row--head">
                            <span>Time</span>
                            <span>A (Wh)</span>
                            <span>B (Wh)</span>
                            <span>C (Wh)</span>
                            <span>Total (Wh)</span>
                        </div>
                        <div v-for="row in netPreview" :key="row.ts" class="et-em__net-row">
                            <span>{{ row.iso }}</span>
                            <span>{{ row.a.toFixed(2) }}</span>
                            <span>{{ row.b.toFixed(2) }}</span>
                            <span>{{ row.c.toFixed(2) }}</span>
                            <span>{{ row.total.toFixed(2) }}</span>
                        </div>
                        <div
                            v-if="netRows.length > netPreview.length"
                            class="et-em__net-row et-em__net-row--more"
                        >
                            … {{ netRows.length - netPreview.length }} more rows
                            (download CSV for full data)
                        </div>
                    </div>
                </div>
            </Collapse>

            <!-- Stored data -->
            <Collapse v-if="canExecute" title="Stored data">
                <div class="et__form et-em__panel">
                    <div v-if="dataTotals" class="et-em__totals-grid">
                        <div class="et__tile">
                            <span class="et__tile-label">Phase A</span>
                            <span class="et__tile-value">{{ formatKwh(dataTotals.aTotal) }}</span>
                        </div>
                        <div class="et__tile">
                            <span class="et__tile-label">Phase B</span>
                            <span class="et__tile-value">{{ formatKwh(dataTotals.bTotal) }}</span>
                        </div>
                        <div class="et__tile">
                            <span class="et__tile-label">Phase C</span>
                            <span class="et__tile-value">{{ formatKwh(dataTotals.cTotal) }}</span>
                        </div>
                        <div class="et__tile">
                            <span class="et__tile-label">Total active</span>
                            <span class="et__tile-value">{{ formatKwh(dataTotals.totalAct) }}</span>
                        </div>
                        <div class="et__tile">
                            <span class="et__tile-label">Total returned</span>
                            <span class="et__tile-value">{{ formatKwh(dataTotals.totalRet) }}</span>
                        </div>
                    </div>

                    <div class="et__chip-row">
                        <Button type="red" size="sm" :loading="deletingData" @click="deleteAllData">
                            Delete all stored data
                        </Button>
                    </div>

                    <div v-if="dataError" class="et__error" role="alert">
                        <i class="fas fa-triangle-exclamation" /> {{ dataError }}
                    </div>
                </div>
            </Collapse>
        </template>

        <ConfirmationModal ref="confirmModal" />
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, reactive, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import Checkbox from '@/components/core/Checkbox.vue';
import Collapse from '@/components/core/Collapse.vue';
import Dropdown from '@/components/core/Dropdown.vue';
import EntityEM from '@/components/core/Meters/EntityEM.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import {EM_NET_PAGE_LIMIT, EM_NET_PREVIEW_ROWS} from '@/constants';
import {deviceSupports} from '@/helpers/device';
import {useDevicesStore} from '@/stores/devices';
import {sendRPC} from '@/tools/websocket';
import type {em_entity} from '@/types';

type Phase = 'a' | 'b' | 'c';

interface EmConfig {
    name?: string;
    blink_mode_selector?: string;
    phase_selector?: string;
    monitor_phase_sequence?: boolean;
    ct_type?: string;
    reverse?: {a?: boolean; b?: boolean; c?: boolean};
}

interface EmStatus {
    user_calibrated_phase?: string[];
    [k: string]: unknown;
}

interface EmDataStatus {
    a_total_act_energy?: number;
    b_total_act_energy?: number;
    c_total_act_energy?: number;
    total_act?: number;
    total_act_ret?: number;
    [k: string]: unknown;
}

interface NetEnergiesBlock {
    ts: number;
    period: number;
    values: number[][];
    [k: string]: unknown;
}

interface NetEnergiesResponse {
    data?: NetEnergiesBlock[];
    next_record_ts?: number;
    [k: string]: unknown;
}

interface NetRow {
    ts: number;
    iso: string;
    a: number;
    b: number;
    c: number;
    total: number;
}

const props = defineProps<{
    status: Record<string, any> | undefined;
    settings: Record<string, any> | undefined;
    canExecute: boolean;
    entity: em_entity;
}>();

const deviceStore = useDevicesStore();

const PHASES: Phase[] = ['a', 'b', 'c'];
const PHASE_SELECTORS: ('a' | 'b' | 'c' | 'all')[] = ['a', 'b', 'c', 'all'];
const BLINK_MODES = [
    {value: 'active_energy', label: 'Active energy'},
    {value: 'apparent_energy', label: 'Apparent energy'}
];
const NET_PERIODS = [
    {label: '5 min', seconds: 300},
    {label: '15 min', seconds: 900},
    {label: '30 min', seconds: 1800},
    {label: '60 min', seconds: 3600}
];

const shellyID = computed(() => props.entity.source);
const componentId = computed(
    () => (props.entity.properties as {id?: number}).id ?? 0
);

const device = computed(() =>
    shellyID.value ? deviceStore.devices[shellyID.value] : null
);

const emStatus = computed<EmStatus | null>(() => {
    if (!device.value) return null;
    return (
        (device.value.status?.[`em:${componentId.value}`] as EmStatus) ?? null
    );
});

const isTriphase = computed(() =>
    deviceSupports(device.value, 'EM.GetConfig')
);

const calibratedPhases = computed<string[]>(
    () => emStatus.value?.user_calibrated_phase ?? []
);

const local = reactive<{
    name: string;
    blinkMode: string;
    phaseSelector: string;
    monitorPhaseSequence: boolean;
    ctType: string;
    reverse: Record<Phase, boolean>;
}>({
    name: '',
    blinkMode: 'active_energy',
    phaseSelector: 'all',
    monitorPhaseSequence: false,
    ctType: '',
    reverse: {a: false, b: false, c: false}
});

const ctTypes = ref<string[]>([]);
const settingError = ref<string | null>(null);
const rebootRequired = ref(false);
const rebooting = ref(false);
const rebootError = ref<string | null>(null);

const calibFrom = ref<Phase>('a');
const calibTo = ref<Phase>('b');
const calibrating = ref(false);
const resettingCalib = ref(false);
const calibError = ref<string | null>(null);
const canCalibrate = computed(() => calibFrom.value !== calibTo.value);

const confirmModal = ref<InstanceType<typeof ConfirmationModal> | null>(null);

const netPeriod = ref<number>(3600);
const netFromLocal = ref('');
const netToLocal = ref('');
const netLoading = ref(false);
const netRows = ref<NetRow[]>([]);
const netError = ref<string | null>(null);

const dataTotals = computed(() => {
    if (!device.value) return null;
    const ds = device.value.status?.[`emdata:${componentId.value}`] as
        | EmDataStatus
        | undefined;
    if (!ds) return null;
    return {
        aTotal: ds.a_total_act_energy ?? 0,
        bTotal: ds.b_total_act_energy ?? 0,
        cTotal: ds.c_total_act_energy ?? 0,
        totalAct: ds.total_act ?? 0,
        totalRet: ds.total_act_ret ?? 0
    };
});
const deletingData = ref(false);
const dataError = ref<string | null>(null);

const netPreview = computed(() =>
    netRows.value.slice(-EM_NET_PREVIEW_ROWS)
);
const netRangeValid = computed(() => {
    const f = new Date(netFromLocal.value).getTime();
    const t = new Date(netToLocal.value).getTime();
    return Number.isFinite(f) && Number.isFinite(t) && t > f;
});

function loadFromConfig(): void {
    const c = (props.settings as EmConfig | undefined) ?? {};
    local.name = c.name ?? '';
    local.blinkMode = c.blink_mode_selector ?? 'active_energy';
    local.phaseSelector = c.phase_selector ?? 'all';
    local.monitorPhaseSequence = c.monitor_phase_sequence ?? false;
    local.ctType = c.ct_type ?? '';
    local.reverse = {
        a: c.reverse?.a ?? false,
        b: c.reverse?.b ?? false,
        c: c.reverse?.c ?? false
    };
}

async function loadCtTypes(): Promise<void> {
    if (!shellyID.value) return;
    try {
        const r = await sendRPC<{supported?: string[]}>(
            'FLEET_MANAGER',
            'EM.GetCTTypes',
            {shellyID: shellyID.value, id: componentId.value}
        );
        ctTypes.value = r?.supported ?? [];
    } catch {
        ctTypes.value = [];
    }
}

async function saveSetting(patch: Partial<EmConfig>): Promise<void> {
    if (!shellyID.value) return;
    settingError.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'EM.SetConfig', {
            shellyID: shellyID.value,
            id: componentId.value,
            config: patch
        });
        rebootRequired.value = true;
    } catch (e: any) {
        settingError.value = e?.message ?? 'Failed to save setting';
    }
}

async function rebootDevice(): Promise<void> {
    if (!shellyID.value) return;
    rebooting.value = true;
    rebootError.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Shelly.Reboot', {
            shellyID: shellyID.value
        });
        rebootRequired.value = false;
    } catch (e: any) {
        rebootError.value = e?.message ?? 'Reboot failed';
    } finally {
        rebooting.value = false;
    }
}

function onBlinkChange(value: string): void {
    local.blinkMode = value;
    void saveSetting({blink_mode_selector: value});
}

function onPhaseSelectChange(value: string): void {
    local.phaseSelector = value;
    void saveSetting({phase_selector: value});
}

function onCtTypeChange(value: string): void {
    local.ctType = value;
    void saveSetting({ct_type: value});
}

function onReverseChange(p: Phase, checked: boolean): void {
    local.reverse[p] = checked;
    void saveSetting({
        reverse: {
            a: local.reverse.a,
            b: local.reverse.b,
            c: local.reverse.c
        }
    });
}

function runCalibration(): void {
    if (!shellyID.value || !canCalibrate.value) return;
    const from = calibFrom.value.toUpperCase();
    const to = calibTo.value.toUpperCase();
    confirmModal.value?.storeAction(
        async () => {
            calibError.value = null;
            calibrating.value = true;
            try {
                await sendRPC('FLEET_MANAGER', 'EM.PhaseToPhaseCalib', {
                    shellyID: shellyID.value,
                    id: componentId.value,
                    from: calibFrom.value,
                    to: calibTo.value
                });
            } catch (e: any) {
                calibError.value = e?.message ?? 'Calibration failed';
            } finally {
                calibrating.value = false;
            }
        },
        {
            title: `Calibrate phase ${to}`,
            message: `Calibrate phase ${to} from phase ${from}?`,
            confirmLabel: 'Calibrate'
        }
    );
}

function resetCalibrationFor(phase: Phase): void {
    if (!shellyID.value) return;
    const phaseLabel = phase.toUpperCase();
    confirmModal.value?.storeAction(
        async () => {
            calibError.value = null;
            resettingCalib.value = true;
            try {
                await sendRPC('FLEET_MANAGER', 'EM.PhaseToPhaseCalibReset', {
                    shellyID: shellyID.value,
                    id: componentId.value,
                    phase
                });
            } catch (e: any) {
                calibError.value = e?.message ?? 'Reset failed';
            } finally {
                resettingCalib.value = false;
            }
        },
        {
            title: `Reset calibration ${phaseLabel}`,
            message: `Reset user calibration for phase ${phaseLabel}?`,
            confirmLabel: 'Reset'
        }
    );
}

function localToEpochSeconds(v: string): number | null {
    if (!v) return null;
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

async function loadNetEnergy(): Promise<void> {
    if (!shellyID.value) return;
    const fromS = localToEpochSeconds(netFromLocal.value);
    const toS = localToEpochSeconds(netToLocal.value);
    if (fromS === null || toS === null || toS <= fromS) {
        netError.value = '"From" must be before "To"';
        return;
    }
    netError.value = null;
    netLoading.value = true;
    netRows.value = [];

    try {
        const period = netPeriod.value;
        const tsAligned = Math.floor(fromS / period) * period;
        const rows: NetRow[] = [];
        let cursor = tsAligned;
        let safety = 0;
        while (cursor < toS && safety < EM_NET_PAGE_LIMIT) {
            const res = await sendRPC<NetEnergiesResponse>(
                'FLEET_MANAGER',
                'EMData.GetNetEnergies',
                {
                    shellyID: shellyID.value,
                    id: componentId.value,
                    ts: cursor,
                    period,
                    end_ts: toS
                }
            );
            const blocks = res?.data ?? [];
            for (const block of blocks) {
                const blockPeriod = block.period ?? period;
                for (let i = 0; i < block.values.length; i++) {
                    const ts = block.ts + i * blockPeriod;
                    if (ts >= toS) break;
                    const [a = 0, b = 0, c = 0] = block.values[i];
                    rows.push({
                        ts,
                        iso: new Date(ts * 1000).toISOString(),
                        a,
                        b,
                        c,
                        total: a + b + c
                    });
                }
            }
            const next = res?.next_record_ts;
            if (!next || next <= cursor) break;
            cursor = next;
            safety += 1;
        }
        netRows.value = rows;
        if (rows.length === 0) {
            netError.value = 'No net-energy records in this range';
        }
    } catch (e: any) {
        netError.value = e?.message ?? 'Failed to load net energy';
    } finally {
        netLoading.value = false;
    }
}

function csvEscape(v: string | number): string {
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

function downloadCsv(): void {
    if (netRows.value.length === 0) return;
    const header = [
        'ts_iso',
        'period_seconds',
        'a_net_act_energy_Wh',
        'b_net_act_energy_Wh',
        'c_net_act_energy_Wh',
        'total_Wh'
    ].join(',');
    const lines = netRows.value.map((r) =>
        [
            csvEscape(r.iso),
            netPeriod.value,
            r.a.toFixed(4),
            r.b.toFixed(4),
            r.c.toFixed(4),
            r.total.toFixed(4)
        ].join(',')
    );
    const blob = new Blob([`${header}\n${lines.join('\n')}\n`], {
        type: 'text/csv;charset=utf-8'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `em-net-energy-${shellyID.value}-${componentId.value}-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function deleteAllData(): void {
    if (!shellyID.value) return;
    confirmModal.value?.storeAction(
        async () => {
            dataError.value = null;
            deletingData.value = true;
            try {
                await sendRPC('FLEET_MANAGER', 'EMData.DeleteAllData', {
                    shellyID: shellyID.value,
                    id: componentId.value
                });
            } catch (e: any) {
                dataError.value = e?.message ?? 'Failed to delete data';
            } finally {
                deletingData.value = false;
            }
        },
        {
            title: 'Delete stored EM data',
            message:
                'Delete ALL stored EM data on this device? This cannot be undone.',
            confirmLabel: 'Delete all',
            secured: true
        }
    );
}

function formatKwh(wh: number): string {
    return `${(wh / 1000).toFixed(3)} kWh`;
}

onMounted(() => {
    loadFromConfig();
    void loadCtTypes();
});

watch(
    () => props.settings,
    () => {
        loadFromConfig();
    },
    {deep: true}
);

watch(
    () => shellyID.value,
    () => {
        loadFromConfig();
        void loadCtTypes();
        netRows.value = [];
        rebootRequired.value = false;
        rebootError.value = null;
    }
);
</script>

<style src="./entityTemplate.css"></style>

<style scoped>
/* EM-specific: panel padding, radio groups, calibrated-phase chips, net-energy table */
.et-em__panel {
    padding: var(--space-3) 0;
}
.et-em__hint {
    font-size: var(--type-caption);
    color: var(--color-text-quaternary);
}
.et-em__radio-group {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
}
.et-em__radio {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--type-body);
    color: var(--color-text-primary);
    cursor: pointer;
}
.et-em__phase-toggles {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
}
.et-em__phase-toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--type-body);
    cursor: pointer;
}
.et-em__btn-group {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
}
.et-em__chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1-5);
}
.et-em__cal-chip {
    display: inline-flex;
    align-items: center;
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    background-color: color-mix(in srgb, var(--color-success) 16%, transparent);
    color: var(--color-success-text);
    font-size: var(--type-caption);
    font-family: var(--font-mono);
    font-weight: var(--font-semibold);
}
.et-em__reboot-btn {
    margin-left: var(--space-2);
}
.et-em__net-table {
    display: flex;
    flex-direction: column;
    gap: var(--space-px);
    margin-top: var(--space-2);
    font-size: var(--type-caption);
}
.et-em__net-row {
    display: grid;
    grid-template-columns: 2fr repeat(4, 1fr);
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    font-variant-numeric: tabular-nums;
}
.et-em__net-row:not(.et-em__net-row--head):nth-child(even) {
    background-color: var(--color-surface-3);
}
.et-em__net-row--head {
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
    background: transparent;
}
.et-em__net-row--more {
    grid-template-columns: 1fr;
    color: var(--color-text-quaternary);
    text-align: center;
    font-style: italic;
}
.et-em__totals-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: var(--space-2);
}
</style>
