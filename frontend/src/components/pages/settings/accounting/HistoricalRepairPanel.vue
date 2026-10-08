<template>
    <section class="ua-panel" aria-labelledby="historical-repair-title">
        <header class="ua-panel__header">
            <div class="ua-panel__heading">
                <h2 id="historical-repair-title">Fix data</h2>
                <p>
                    Reclassify one bounded meter-point history window without
                    changing measured readings. Every repair must be previewed
                    and remains bound to the selected device.
                </p>
            </div>
        </header>

        <form class="ua-editor" aria-labelledby="repair-editor-title" @submit.prevent="previewRepair">
            <div class="ua-editor__head">
                <div>
                    <h3 id="repair-editor-title">Define repair window</h3>
                    <p>Maximum 366 days. The end must be in recorded history.</p>
                </div>
            </div>
            <div class="ua-form-grid">
                <FormField field-id="repair-device" label="Device / meter" :error="fieldErrors.device">
                    <select id="repair-device" v-model.number="form.deviceId" class="ua-select" required>
                        <option :value="0" disabled>Select device</option>
                        <option v-for="device in devices" :key="device.id" :value="device.id">
                            {{ deviceLabel(device) }} · {{ device.shellyID }}
                        </option>
                    </select>
                </FormField>
                <FormField field-id="repair-meter-point" label="Recorded meter point" :error="fieldErrors.channel" hint="Only points with historical readings are shown.">
                    <select id="repair-meter-point" v-model="selectedPoint" class="ua-select" required :disabled="form.deviceId < 1 || loadingPoints">
                        <option value="" disabled>{{ loadingPoints ? 'Loading meter points…' : 'Select meter point' }}</option>
                        <option v-for="point in repairPoints" :key="point.key" :value="point.key">
                            {{ point.label }}
                        </option>
                    </select>
                </FormField>
                <FormField field-id="repair-from" label="From">
                    <input id="repair-from" v-model="form.from" class="ua-input" type="datetime-local" required />
                </FormField>
                <FormField field-id="repair-to" label="To">
                    <input id="repair-to" v-model="form.to" class="ua-input" type="datetime-local" required />
                </FormField>
                <FormField field-id="repair-current-commodity" label="Current commodity">
                    <select id="repair-current-commodity" v-model="form.expectedCommodity" class="ua-select">
                        <option v-for="value in allowedCommodities" :key="value" :value="value">{{ titleCase(value) }}</option>
                    </select>
                </FormField>
                <FormField
                    v-if="isElectrical"
                    field-id="repair-current-electrical-source"
                    label="Current electrical source"
                >
                    <select id="repair-current-electrical-source" v-model="form.expectedElectricalSource" class="ua-select">
                        <option v-for="source in ELECTRICAL_SOURCES" :key="source" :value="source">{{ titleCase(source) }}</option>
                    </select>
                </FormField>
                <FormField field-id="repair-correct-commodity" label="Correct commodity">
                    <select id="repair-correct-commodity" v-model="form.targetCommodity" class="ua-select">
                        <option v-for="value in allowedCommodities" :key="value" :value="value">{{ titleCase(value) }}</option>
                    </select>
                </FormField>
                <FormField
                    v-if="isElectrical"
                    field-id="repair-correct-electrical-source"
                    label="Correct electrical source"
                >
                    <select id="repair-correct-electrical-source" v-model="form.targetElectricalSource" class="ua-select">
                        <option v-for="source in ELECTRICAL_SOURCES" :key="source" :value="source">{{ titleCase(source) }}</option>
                    </select>
                </FormField>
                <FormField label="Source reference" hint="Change ticket, investigation, or evidence reference.">
                    <Input v-model="form.sourceReference" :maxlength="500" required />
                </FormField>
            </div>
            <p v-if="formError" class="ua-form-error" role="alert">{{ formError }}</p>
            <div class="ua-editor__footer">
                <Button
                    type="blue"
                    size="sm"
                    submit
                    :loading="previewing"
                    :disabled="!canUpdateSelectedDevice"
                >
                    Preview repair
                </Button>
            </div>
        </form>

        <section v-if="preview" class="ua-review" aria-labelledby="repair-review-title">
            <div>
                <h3 id="repair-review-title">Preview {{ preview.previewId }}</h3>
                <p>
                    {{ preview.rowCount.toLocaleString() }} rollup rows and
                    {{ preview.quantity.toLocaleString() }} stored quantity units
                    are eligible from {{ preview.firstBucket ?? '—' }} to
                    {{ preview.lastBucket ?? '—' }}.
                </p>
            </div>
            <dl class="ua-summary-grid">
                <div><dt>Eligible</dt><dd>{{ preview.eligible ? 'Yes' : 'No' }}</dd></div>
                <div><dt>Rollup conflicts</dt><dd>{{ preview.rollupConflictCount.toLocaleString() }}</dd></div>
                <div><dt>Raw conflicts</dt><dd>{{ preview.rawConflictCount.toLocaleString() }}</dd></div>
                <div><dt>Pending rollups</dt><dd>{{ preview.dirtyCount.toLocaleString() }}</dd></div>
                <div><dt>Stored domain</dt><dd>{{ selectedPointDomainLabel }}</dd></div>
                <div><dt>Current</dt><dd>{{ expectedSummary }}</dd></div>
                <div><dt>Correct</dt><dd>{{ targetSummary }}</dd></div>
            </dl>
            <div v-if="!canApplyPreview" class="ua-state ua-state--error" role="alert">
                <div>
                    <strong>This preview cannot be applied.</strong>
                    <ul v-if="preview.ineligibilityReasons.length" class="ua-issue-list">
                        <li v-for="reason in preview.ineligibilityReasons" :key="reason">
                            {{ ineligibilityReasonLabel(reason) }}
                        </li>
                    </ul>
                    <span v-else>No eligible rows matched the current classification and window.</span>
                </div>
            </div>
            <label v-else class="ua-check">
                <input v-model="acknowledged" type="checkbox" />
                <span>
                    I reviewed the exact device, channel, period, current axes,
                    and corrected axes. Apply only this persisted preview.
                </span>
            </label>
            <p v-if="applyError" class="ua-form-error" role="alert">{{ applyError }}</p>
            <div class="ua-editor__footer">
                <Button type="blue-hollow" size="sm" @click="clearPreview">Change request</Button>
                <Button
                    v-if="canApplyPreview"
                    type="green"
                    size="sm"
                    :loading="applying"
                    :disabled="!acknowledged"
                    @click="applyRepair"
                >
                    Apply preview
                </Button>
            </div>
        </section>

        <div v-if="applied" class="ua-state" role="status" aria-live="polite">
            <div>
                <strong>Repair {{ applied.previewId }} applied.</strong>
                <span>
                    {{ applied.appliedRows.toLocaleString() }} rollup rows and
                    {{ applied.rawRowsReclassified.toLocaleString() }} raw rows were reclassified.
                    Coverage now starts {{ applied.coverageStart }}.
                </span>
            </div>
        </div>
    </section>
</template>

<script setup lang="ts">
import {computed, onMounted, reactive, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import FormField from '@/components/core/FormField.vue';
import Input from '@/components/core/Input.vue';
import {rpcErrorMessage} from '@/helpers/rpcError';
import type {HostResult} from '@/shell/template-host/generated/contract';
import {useAuthStore} from '@/stores/auth';
import {useDevicesStore} from '@/stores/devices';
import {useToastStore} from '@/stores/toast';
import {sendRPC} from '@/tools/websocket';
import type {shelly_device_t} from '@/types';

type Commodity = 'electricity' | 'water' | 'gas' | 'heat';
type ElectricalSource = 'ac_mains' | 'dc_pv' | 'dc_battery' | 'dc_bus';
type RepairTag = 'total_act_energy' | 'total_act_ret_energy' | 'volume_l' | 'volume_m3';
interface RepairPreview {
    previewId: number;
    eligible: boolean;
    rowCount: number;
    quantity: number;
    conflictCount: number;
    rollupConflictCount: number;
    rawConflictCount: number;
    dirtyCount: number;
    ineligibilityReasons: Array<'no_source_rows' | 'rollup_conflict' | 'raw_conflict' | 'pending_rollup'>;
    firstBucket: string | null;
    lastBucket: string | null;
}
interface RepairApplied {
    previewId: number;
    status: 'applied';
    appliedRows: number;
    rawRowsReclassified: number;
    coverageStart: string;
    appliedAt: string;
}

const ELECTRICAL_SOURCES: ElectricalSource[] = ['ac_mains', 'dc_pv', 'dc_battery', 'dc_bus'];
// biome-ignore lint/correctness/useHookAtTopLevel: Vue script setup is component setup.
const auth = useAuthStore();
// biome-ignore lint/correctness/useHookAtTopLevel: Vue script setup is component setup.
const deviceStore = useDevicesStore();
// biome-ignore lint/correctness/useHookAtTopLevel: Vue script setup is component setup.
const toast = useToastStore();
const devices = computed(() =>
    Object.values(deviceStore.devices).sort((a, b) => deviceLabel(a).localeCompare(deviceLabel(b)))
);

const form = reactive({
    deviceId: 0,
    channel: '' as string | number,
    tag: 'total_act_energy' as RepairTag,
    from: '',
    to: '',
    expectedCommodity: 'electricity' as Commodity,
    expectedElectricalSource: 'ac_mains' as ElectricalSource,
    targetCommodity: 'electricity' as Commodity,
    targetElectricalSource: 'dc_pv' as ElectricalSource,
    sourceReference: ''
});
type MeasurementPoint = HostResult<'energy.listmeasurementpoints'>['points'][number];
const selectedPoint = ref('');
const points = ref<MeasurementPoint[]>([]);
const loadingPoints = ref(false);
const repairPoints = computed(() => {
    const seen = new Set<string>();
    return points.value
        .filter(
            (point) =>
                point.hasHistory &&
                ['total_act_energy', 'total_act_ret_energy', 'volume_l', 'volume_m3'].includes(point.tag)
        )
        .flatMap((point) => {
            const key = `${point.channel}|${point.tag}|${point.electricalDomain}`;
            if (seen.has(key)) return [];
            seen.add(key);
            return [{
                key,
                label: `${point.componentKey ?? 'Stored point'} · channel ${point.channel} · ${titleCase(point.tag)} · ${domainLabel(point.electricalDomain)}`,
                point
            }];
        });
});
const fieldErrors = reactive({device: '', channel: ''});
const formError = ref('');
const applyError = ref('');
const previewing = ref(false);
const applying = ref(false);
const acknowledged = ref(false);
const preview = ref<RepairPreview | null>(null);
const applied = ref<RepairApplied | null>(null);

const isElectrical = computed(() => form.tag.startsWith('total_act_'));
const allowedCommodities = computed<Commodity[]>(() =>
    isElectrical.value ? ['electricity'] : ['water', 'gas']
);
const selectedDevice = computed(() =>
    devices.value.find((device) => device.id === form.deviceId)
);
const canUpdateSelectedDevice = computed(() =>
    Boolean(
        selectedDevice.value &&
        auth.canPerformComponent(
            'devices',
            'update',
            selectedDevice.value.shellyID
        )
    )
);
const canApplyPreview = computed(() =>
    Boolean(preview.value?.eligible && preview.value.rowCount > 0 && preview.value.conflictCount === 0)
);
const expectedSummary = computed(() =>
    isElectrical.value
        ? `Electricity · ${titleCase(form.expectedElectricalSource)}`
        : titleCase(form.expectedCommodity)
);
const targetSummary = computed(() =>
    isElectrical.value
        ? `Electricity · ${titleCase(form.targetElectricalSource)}`
        : titleCase(form.targetCommodity)
);
const selectedPointDomainLabel = computed(() => {
    const point = repairPoints.value.find((item) => item.key === selectedPoint.value)?.point;
    return point ? domainLabel(point.electricalDomain) : '—';
});

onMounted(() => void deviceStore.fetchDevices());

watch(selectedPoint, (value) => {
    const match = repairPoints.value.find((item) => item.key === value)?.point;
    if (!match) return;
    form.channel = match.channel;
    form.tag = match.tag as RepairTag;
    prefillCurrentAxes(match);
});
watch(
    () => form.deviceId,
    async (deviceId) => {
        selectedPoint.value = '';
        points.value = [];
        if (deviceId < 1) return;
        const device = devices.value.find((item) => item.id === deviceId);
        if (!device) return;
        loadingPoints.value = true;
        try {
            const result = (await sendRPC(
                'FLEET_MANAGER',
                'energy.listmeasurementpoints',
                {shellyID: device.shellyID, includeAssigned: true}
            )) as HostResult<'energy.listmeasurementpoints'>;
            points.value = result.points ?? [];
        } catch (error) {
            formError.value = rpcErrorMessage(
                error,
                'Could not load recorded meter points'
            );
        } finally {
            loadingPoints.value = false;
        }
    }
);
watch(
    () => form.tag,
    () => {
        clearPreview();
        const selected = repairPoints.value.find(
            (item) => item.key === selectedPoint.value
        )?.point;
        if (selected) {
            prefillCurrentAxes(selected);
            return;
        }
        if (isElectrical.value) {
            form.expectedCommodity = 'electricity';
            form.targetCommodity = 'electricity';
            form.expectedElectricalSource = 'ac_mains';
            form.targetElectricalSource = 'dc_pv';
        } else {
            form.expectedCommodity = 'water';
            form.targetCommodity = 'gas';
        }
    }
);
watch(
    () => [
        form.deviceId,
        form.channel,
        form.from,
        form.to,
        form.expectedCommodity,
        form.expectedElectricalSource,
        form.targetCommodity,
        form.targetElectricalSource,
        form.sourceReference
    ],
    () => {
        if (preview.value) clearPreview();
    }
);

async function previewRepair(): Promise<void> {
    if (!canUpdateSelectedDevice.value || previewing.value) return;
    formError.value = '';
    fieldErrors.device = '';
    fieldErrors.channel = '';
    applied.value = null;
    const validation = validateRequest();
    if (validation) {
        formError.value = validation;
        return;
    }
    previewing.value = true;
    try {
        preview.value = (await sendRPC('FLEET_MANAGER', 'energy.previewcommodityrepair', {
            deviceId: form.deviceId,
            channel: Number(form.channel),
            tag: form.tag,
            from: new Date(form.from).toISOString(),
            to: new Date(form.to).toISOString(),
            expectedCommodity: form.expectedCommodity,
            expectedElectricalSource: isElectrical.value ? form.expectedElectricalSource : null,
            targetCommodity: form.targetCommodity,
            targetElectricalSource: isElectrical.value ? form.targetElectricalSource : null,
            sourceReference: form.sourceReference.trim()
        })) as RepairPreview;
        acknowledged.value = false;
    } catch (error) {
        formError.value = rpcErrorMessage(error, 'Could not preview the repair');
    } finally {
        previewing.value = false;
    }
}

async function applyRepair(): Promise<void> {
    if (!preview.value || !canApplyPreview.value || !acknowledged.value || applying.value) return;
    applying.value = true;
    applyError.value = '';
    try {
        applied.value = (await sendRPC('FLEET_MANAGER', 'energy.applycommodityrepair', {
            previewId: preview.value.previewId,
            deviceId: form.deviceId
        })) as RepairApplied;
        toast.success('Historical classification repair applied');
        preview.value = null;
        acknowledged.value = false;
    } catch (error) {
        applyError.value = rpcErrorMessage(error, 'Could not apply the persisted preview');
    } finally {
        applying.value = false;
    }
}

function validateRequest(): string | null {
    if (form.deviceId < 1) return 'Select a device.';
    if (!selectedPoint.value) return 'Select a recorded meter point.';
    if (!Number.isInteger(Number(form.channel)) || Number(form.channel) < 0) return 'Channel must be zero or a positive integer.';
    const from = Date.parse(form.from);
    const to = Date.parse(form.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 'To must be later than from.';
    if (to > Date.now()) return 'The repair must end in recorded history.';
    if (to - from > 366 * 24 * 60 * 60 * 1000) return 'The repair window cannot exceed 366 days.';
    if (!form.sourceReference.trim()) return 'Source reference is required.';
    if (expectedSummary.value === targetSummary.value) return 'Correct classification must differ from the current classification.';
    return null;
}

function clearPreview(): void {
    preview.value = null;
    acknowledged.value = false;
    applyError.value = '';
}
function deviceLabel(device: shelly_device_t): string {
    return String(device.info?.name || device.info?.model || 'Unnamed device');
}
function titleCase(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1).replaceAll('_', ' ');
}
function prefillCurrentAxes(point: MeasurementPoint): void {
    if (['ac_mains', 'dc_pv', 'dc_battery', 'dc_bus'].includes(point.electricalDomain)) {
        form.expectedCommodity = 'electricity';
        form.expectedElectricalSource = point.electricalDomain as ElectricalSource;
        form.targetCommodity = 'electricity';
        form.targetElectricalSource =
            point.electricalDomain === 'dc_pv' ? 'ac_mains' : 'dc_pv';
        return;
    }
    if (point.electricalDomain === 'gas') {
        form.expectedCommodity = 'gas';
        form.targetCommodity = 'water';
        return;
    }
    form.expectedCommodity = 'water';
    form.targetCommodity = 'gas';
}
function domainLabel(domain: MeasurementPoint['electricalDomain']): string {
    if (domain === 'unspecified') return 'Unspecified volume (assumed water)';
    if (domain === 'thermal') return 'Thermal';
    if (domain === 'gas') return 'Gas';
    return `Electricity · ${titleCase(domain)}`;
}
function ineligibilityReasonLabel(reason: RepairPreview['ineligibilityReasons'][number]): string {
    const labels: Record<typeof reason, string> = {
        no_source_rows: 'No source rows match this exact classification and window.',
        rollup_conflict: 'One or more rollup rows already have a conflicting classification.',
        raw_conflict: 'One or more raw readings already have a conflicting classification.',
        pending_rollup: 'Pending rollups must finish before this repair can be applied.'
    };
    return labels[reason];
}
</script>
