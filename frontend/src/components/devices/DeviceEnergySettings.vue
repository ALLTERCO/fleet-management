<template>
    <div class="des">
        <p v-if="loading" class="des-muted">Loading energy points…</p>
        <p v-else-if="error" class="des-error">{{ error }}</p>

        <p v-else-if="!hasEnergyData" class="des-muted">
            This device does not report any energy or volume measurements, so
            there is nothing to classify here.
        </p>

        <template v-else>
            <div v-if="deviceMeters.length > 0" class="des-field">
                <span class="des-label">Assigned meters</span>
                <ul class="des-meters">
                    <li
                        v-for="meter in deviceMeters"
                        :key="meter.id"
                        class="des-meter"
                        :class="{
                            'des-meter--editing': editingMeterId === meter.id
                        }"
                    >
                        <span class="des-meter__name">{{ meter.name }}</span>
                        <span class="des-meter__meta">
                            {{ meterRoleLabel(meter) }} ·
                            {{ meter.points.length }}
                            {{ meter.points.length === 1 ? 'point' : 'points' }}
                        </span>
                        <Button
                            v-if="editingMeterId === meter.id"
                            type="blue-hollow"
                            size="sm"
                            @click="cancelEdit"
                        >
                            Cancel
                        </Button>
                        <Button
                            v-else-if="meter.aggregationMode === 'sum_points'"
                            type="blue-hollow"
                            size="sm"
                            :aria-label="`Edit ${meter.name}`"
                            :disabled="!canUpdateDevice"
                            @click="beginEdit(meter)"
                        >
                            Edit
                        </Button>
                    </li>
                </ul>
            </div>

            <p
                v-if="assignablePoints.length === 0 && editingMeterId === null"
                class="des-muted"
            >
                No unassigned energy points found.
            </p>

            <template v-else>
                <div class="des-field">
                    <span class="des-label">Detected points</span>
                    <div
                        v-for="point in compatibleAssignablePoints"
                        :key="energyPointKey(point)"
                        class="des-point"
                    >
                        <Checkbox
                            :model-value="selected.has(energyPointKey(point))"
                            :aria-label="energyPointLabel(point)"
                            :disabled="!canUpdateDevice"
                            @update:model-value="toggle(point)"
                        >
                            {{ energyPointLabel(point) }}
                        </Checkbox>
                        <span class="des-point__actions">
                            <span class="des-tag">
                                {{ energyTagLabel(point.tag) }}
                            </span>
                            <Button
                                v-if="canClassifyReturnedGas(point)"
                                type="blue-hollow"
                                size="sm"
                                @click="reviewReturnedGas(point)"
                            >
                                Classify gas return
                            </Button>
                        </span>
                    </div>
                    <span v-if="excludedPointCount > 0" class="des-hint">
                        {{ excludedPointCount }} other
                        {{ excludedPointCount === 1 ? 'point is' : 'points are' }}
                        hidden because they belong to another utility or are
                        diagnostic/export readings that cannot form a meter total.
                    </span>

                    <section
                        v-if="classificationPoint"
                        class="des-classifier"
                        aria-labelledby="returned-gas-review-title"
                    >
                        <div>
                            <h3 id="returned-gas-review-title">
                                Review returned-gas classification
                            </h3>
                            <p>
                                {{ energyPointLabel(classificationPoint) }} will change
                                from <strong>{{ energyTagLabel(classificationPoint.tag) }}</strong>
                                to <strong>Returned gas volume · network injection</strong>.
                            </p>
                            <small>
                                This explicit mapping affects future samples only. It
                                never guesses injection from a consumption meter and
                                does not rewrite recorded history. Save it as a separate
                                gas injection meter after the points refresh.
                            </small>
                        </div>
                        <p v-if="classificationError" class="des-error" role="alert">
                            {{ classificationError }}
                        </p>
                        <div class="des-classifier__actions">
                            <Button
                                type="blue-hollow"
                                size="sm"
                                :disabled="classifying"
                                @click="cancelReturnedGasReview"
                            >
                                Cancel
                            </Button>
                            <Button
                                type="green"
                                size="sm"
                                :loading="classifying"
                                @click="applyReturnedGasClassification"
                            >
                                Confirm returned-gas mapping
                            </Button>
                        </div>
                    </section>
                </div>

                <div class="des-grid">
                    <div class="des-field">
                        <span class="des-label">Utility</span>
                        <Dropdown
                            aria-label="Utility type"
                            :options="utilityLabels"
                            :default="utilityLabel"
                            :disabled="!canUpdateDevice"
                            @selected="(label: string) => {
                                utilityType = utilityFromLabel(label);
                            }"
                        />
                        <span class="des-hint">
                            Defines the measured commodity, reporting unit, and
                            eligible tariffs.
                        </span>
                    </div>

                    <div class="des-field">
                        <span class="des-label">Flow role</span>
                        <Dropdown
                            aria-label="Role in the utility flow"
                            placeholder="Choose…"
                            :options="roleLabels"
                            :default="roleLabel"
                            :disabled="!canUpdateDevice || editingMeterId !== null"
                            @selected="(label: string) => {
                                role = roleFromLabel(label);
                            }"
                        />
                        <span v-if="roleClearedHint" class="des-hint">
                            Previous choice does not apply to this utility.
                            Pick a new one.
                        </span>
                        <span v-else class="des-hint">
                            <template v-if="editingMeterId !== null">
                                Existing roles are effective-dated. Review changes
                                in Meter topology so older reports keep their meaning.
                            </template>
                            <template v-else>
                                Describes where this meter sits in the flow, such as
                                supply, generation, storage, or final usage.
                            </template>
                        </span>
                    </div>

                    <label class="des-field">
                        <span class="des-label">Name</span>
                        <input
                            v-model="name"
                            class="des-input"
                            placeholder="Main meter"
                            :disabled="!canUpdateDevice"
                        />
                    </label>

                    <label class="des-field">
                        <span class="des-label">Cost centre</span>
                        <input
                            v-model="costCentre"
                            class="des-input des-cost-centre"
                            placeholder="Tenant or department"
                            :disabled="!canUpdateDevice"
                        />
                        <span class="des-hint">
                            Groups this meter on the cost allocation report.
                        </span>
                    </label>

                    <div class="des-field">
                        <span class="des-label">End use / equipment</span>
                        <Dropdown
                            aria-label="End use or equipment kind"
                            :groups="kindGroups"
                            :default="kindId"
                            :searchable="true"
                            :disabled="!canUpdateDevice || editingMeterId !== null"
                            @selected="(value: string) => {
                                kindId = value;
                            }"
                        />
                        <span class="des-hint">
                            Optional. Controls end-use breakdowns; it does not
                            change the measured quantity or flow role.
                        </span>
                    </div>

                    <div class="des-field">
                        <span class="des-label">Group</span>
                        <Dropdown
                            aria-label="Group"
                            :options="groupLabels"
                            :default="groupLabel"
                            :disabled="!canUpdateDevice"
                            @selected="(label: string) => {
                                groupId = valueForLabel(groupIdByLabel, label);
                            }"
                        />
                    </div>

                    <div class="des-field">
                        <span class="des-label">Location</span>
                        <Dropdown
                            aria-label="Location"
                            :options="locationLabels"
                            :default="locationLabel"
                            :disabled="!canUpdateDevice"
                            @selected="(label: string) => {
                                locationId = valueForLabel(
                                    locationIdByLabel,
                                    label
                                );
                            }"
                        />
                    </div>

                    <div v-if="parentOptions.length > 0" class="des-field">
                        <span class="des-label">Upstream meter</span>
                        <Dropdown
                            aria-label="Upstream meter"
                            :options="parentLabels"
                            :default="parentLabel"
                            :disabled="!canUpdateDevice"
                            @selected="(label: string) => {
                                parentMeterId = valueForLabel(
                                    parentIdByLabel,
                                    label
                                );
                            }"
                        />
                    </div>
                </div>

                <div class="des-impact" role="status">
                    <strong>Reporting impact</strong>
                    <span>{{ classificationSummary }}</span>
                    <small v-if="editingMeterId !== null">
                        Physical point changes update the meter structure. Role and
                        end-use changes use a separate effective-dated review.
                    </small>
                    <Button
                        v-if="editingMeterId !== null"
                        type="blue-hollow"
                        size="sm"
                        :disabled="!canUpdateDevice"
                        @click="reviewMeaning"
                    >
                        Review role or end use
                    </Button>
                </div>

                <div class="des-save">
                    <Button
                        type="blue"
                        size="sm"
                        :loading="saving"
                        :disabled="!canSave"
                        @click="save"
                    >
                        {{
                            editingMeterId === null
                                ? 'Save energy assignment'
                                : 'Save meter changes'
                        }}
                    </Button>
                    <span v-if="!canUpdateDevice" class="des-hint">
                        You need update permission for this device to change its
                        energy assignment.
                    </span>
                    <span v-else-if="!canSave" class="des-hint">
                        Still needed: {{ missingForSave.join(', ') }}.
                    </span>
                </div>
            </template>
        </template>
    </div>
</template>

<script setup lang="ts">
import type {
    EnergyLogicalMeter,
    EnergyMeasurementPoint,
    EnergyMeterRole,
    EnergyUtilityType
} from '@api/energy';
import type {Location as ApiLocation} from '@api/location';
import {storeToRefs} from 'pinia';
import {computed, inject, ref, watch} from 'vue';
import {useRouter} from 'vue-router';
import {type KindEntry, listKinds } from '@/api/kindRpc';
import Button from '@/components/core/Button.vue';
import Checkbox from '@/components/core/Checkbox.vue';
import Dropdown from '@/components/core/Dropdown.vue';
import {settingsDirtyTrackerKey} from '@/composables/useSettingsDirtyTracker';
import {
    deriveEnergyPhaseMode,
    energyPointFlowDirection,
    energyPointKey,
    energyPointLabel,
    energyPointSupportsUtility,
    energyRolesForUtility,
    energyTagLabel,
    optionalNumber,
    optionalString,
    suggestedUtilityForPoints,
    toLogicalMeterPoint
} from '@/helpers/energyAssignment';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {useAuthStore} from '@/stores/auth';
import {type StoreGroup, useGroupsStore } from '@/stores/groups';
import {useLocationsStore} from '@/stores/locations';
import {useToastStore} from '@/stores/toast';
import {
    listLogicalMeters,
    listMeasurementPoints,
    saveLogicalMeter,
    setPointOverride
} from '@/tools/logicalMeters';

const UTILITY_LABELS: Record<EnergyUtilityType, string> = {
    electric: 'Electric',
    gas: 'Gas',
    water: 'Water',
    heat: 'Heat'
};
const NO_KIND = 'No end use';
const NO_GROUP = 'No group';
const NO_LOCATION = 'No location';
const NO_PARENT = 'No parent';

const props = defineProps<{
    shellyID: string;
    deviceName: string;
}>();

const emit = defineEmits<{'dirty-change': [dirty: boolean]}>();

// biome-ignore lint/correctness/useHookAtTopLevel: Vue script setup is component setup.
const toast = useToastStore();
// biome-ignore lint/correctness/useHookAtTopLevel: Vue script setup is component setup.
const auth = useAuthStore();
// biome-ignore lint/correctness/useHookAtTopLevel: Vue script setup is component setup.
const groupsStore = useGroupsStore();
// biome-ignore lint/correctness/useHookAtTopLevel: Vue script setup is component setup.
const locationsStore = useLocationsStore();
// biome-ignore lint/correctness/useHookAtTopLevel: Vue script setup is component setup.
const router = useRouter();
const settingsDirtyTracker = inject(settingsDirtyTrackerKey, null);
const {groups} = storeToRefs(groupsStore);
const {locations} = storeToRefs(locationsStore);

const points = ref<EnergyMeasurementPoint[]>([]);
const meters = ref<EnergyLogicalMeter[]>([]);
const kinds = ref<KindEntry[]>([]);
const selected = ref<Set<string>>(new Set());
const utilityType = ref<EnergyUtilityType>('electric');
const role = ref<EnergyMeterRole | ''>('');
const name = ref('');
const costCentre = ref('');
const kindId = ref('');
const groupId = ref('');
const locationId = ref('');
const parentMeterId = ref('');
const editingMeterId = ref<number | null>(null);
const roleClearedHint = ref(false);
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const classificationPoint = ref<EnergyMeasurementPoint | null>(null);
const classificationError = ref('');
const classifying = ref(false);
// Dirty is a live diff against the baseline captured after load / mode
// switches — hand-reverting an edit clears the unsaved state on its own.
const formBaseline = ref('');

const canUpdateDevice = computed(() =>
    auth.canPerformComponent('devices', 'update', props.shellyID)
);
const canSave = computed(
    () =>
        canUpdateDevice.value &&
        role.value !== '' &&
        name.value.trim() !== '' &&
        selected.value.size > 0
);
const missingForSave = computed(() => {
    const missing: string[] = [];
    if (name.value.trim() === '') missing.push('a name');
    if (role.value === '') missing.push('a flow role');
    if (selected.value.size === 0) missing.push('at least one selected point');
    return missing;
});
const roleOptions = computed(() => energyRolesForUtility(utilityType.value));
const kindOptions = computed(() =>
    [...kinds.value].sort((a, b) => a.name.localeCompare(b.name))
);
const groupOptions = computed<StoreGroup[]>(() =>
    Object.values(groups.value).sort((a, b) => a.name.localeCompare(b.name))
);
const locationOptions = computed<ApiLocation[]>(() =>
    Object.values(locations.value).sort((a, b) => a.name.localeCompare(b.name))
);
const parentOptions = computed(() =>
    meters.value
        .filter(
            (meter) =>
                meter.aggregationMode !== 'formula' &&
                meter.id !== editingMeterId.value
        )
        .sort((a, b) => a.name.localeCompare(b.name))
);

const deviceIds = computed(
    () => new Set(points.value.map((point) => point.deviceId))
);
const deviceMeters = computed(() =>
    meters.value
        .filter((meter) =>
            meter.points.some((point) => deviceIds.value.has(point.deviceId))
        )
        .sort((a, b) => a.name.localeCompare(b.name))
);
const hasEnergyData = computed(
    () => points.value.length > 0 || deviceMeters.value.length > 0
);

// Points offered by the form: unassigned ones, plus — while editing — the
// edited meter's own points so they can be kept or dropped.
const assignablePoints = computed(() =>
    points.value.filter(
        (point) =>
            point.assignedMeterId == null ||
            (editingMeterId.value !== null &&
                point.assignedMeterId === editingMeterId.value)
    )
);

const utilityLabels = Object.values(UTILITY_LABELS);
const utilityLabel = computed(() => UTILITY_LABELS[utilityType.value]);
const roleLabels = computed(() => roleOptions.value.map((o) => o.label));
const roleLabel = computed(
    () => roleOptions.value.find((o) => o.role === role.value)?.label
);

const RECOMMENDED_KIND_IDS: Partial<Record<EnergyMeterRole, readonly string[]>> = {
    grid: ['grid_source'],
    pv: ['generated_energy', 'inverter'],
    battery: ['battery', 'ups'],
    generator: ['generator', 'generated_energy'],
    ev_charge: ['ev_charger'],
    load: ['generic_appliance', 'plug_load', 'sub_circuit'],
    usage: ['generic_appliance'],
    supply: ['grid_source']
};

const kindGroups = computed(() => {
    const recommendedIds = new Set(RECOMMENDED_KIND_IDS[role.value || 'aux'] ?? []);
    const recommended = kindOptions.value.filter((kind) =>
        recommendedIds.has(kind.id)
    );
    const categories = new Map<string, KindEntry[]>();
    for (const kind of kindOptions.value) {
        if (recommendedIds.has(kind.id)) continue;
        const list = categories.get(kind.category) ?? [];
        list.push(kind);
        categories.set(kind.category, list);
    }
    return [
        {
            label: 'Selection',
            items: [{value: '', label: NO_KIND}]
        },
        ...(recommended.length > 0
            ? [
                  {
                      label: 'Recommended for this role',
                      items: recommended.map(kindOption)
                  }
              ]
            : []),
        ...[...categories.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([category, entries]) => ({
                label: titleCase(category),
                items: entries.map(kindOption)
            }))
    ];
});

function kindOption(kind: KindEntry): {value: string; label: string; icon?: string} {
    return {
        value: kind.id,
        label: kind.name,
        ...(kind.icon ? {icon: kind.icon} : {})
    };
}

function titleCase(value: string): string {
    return value
        .replaceAll('_', ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const groupIdByLabel = computed<Record<string, string>>(() => {
    const out: Record<string, string> = {[NO_GROUP]: ''};
    for (const group of groupOptions.value) out[group.name] = String(group.id);
    return out;
});
const groupLabels = computed(() => [
    NO_GROUP,
    ...groupOptions.value.map((group) => group.name)
]);
const groupLabel = computed(() =>
    groupId.value === ''
        ? NO_GROUP
        : (groupOptions.value.find(
              (group) => String(group.id) === groupId.value
          )?.name ?? groupId.value)
);

const locationIdByLabel = computed<Record<string, string>>(() => {
    const out: Record<string, string> = {[NO_LOCATION]: ''};
    for (const location of locationOptions.value) {
        out[location.name] = String(location.id);
    }
    return out;
});
const locationLabels = computed(() => [
    NO_LOCATION,
    ...locationOptions.value.map((location) => location.name)
]);
const locationLabel = computed(() =>
    locationId.value === ''
        ? NO_LOCATION
        : (locationOptions.value.find(
              (location) => String(location.id) === locationId.value
          )?.name ?? locationId.value)
);

const parentIdByLabel = computed<Record<string, string>>(() => {
    const out: Record<string, string> = {[NO_PARENT]: ''};
    for (const meter of parentOptions.value) out[meter.name] = String(meter.id);
    return out;
});
const parentLabels = computed(() => [
    NO_PARENT,
    ...parentOptions.value.map((meter) => meter.name)
]);
const parentLabel = computed(() =>
    parentMeterId.value === ''
        ? NO_PARENT
        : (parentOptions.value.find(
              (meter) => String(meter.id) === parentMeterId.value
          )?.name ?? parentMeterId.value)
);

const compatibleAssignablePoints = computed(() =>
    assignablePoints.value.filter((point) => {
        if (!energyPointSupportsUtility(point, utilityType.value)) return false;
        if (utilityType.value !== 'gas') return true;
        const selectedDirection = selectedGasDirection.value;
        return (
            selectedDirection === null ||
            energyPointFlowDirection(point) === selectedDirection
        );
    })
);
const selectedGasDirection = computed<'import' | 'export' | null>(() => {
    if (utilityType.value !== 'gas') return null;
    for (const point of assignablePoints.value) {
        if (!selected.value.has(energyPointKey(point))) continue;
        const direction = energyPointFlowDirection(point);
        if (direction) return direction;
    }
    return null;
});
const excludedPointCount = computed(
    () => assignablePoints.value.length - compatibleAssignablePoints.value.length
);
const classificationSummary = computed(() => {
    const utility = UTILITY_LABELS[utilityType.value];
    const flow = roleLabel.value ?? 'No flow role selected';
    const endUse =
        kindOptions.value.find((kind) => kind.id === kindId.value)?.name ??
        'No end use';
    return `${utility} · ${flow} · ${endUse} · ${selected.value.size} ${selected.value.size === 1 ? 'point' : 'points'}`;
});

function utilityFromLabel(label: string): EnergyUtilityType {
    const entry = Object.entries(UTILITY_LABELS).find(
        ([, utilityName]) => utilityName === label
    );
    if (!entry) throw new Error(`Unknown utility option: ${label}`);
    return entry[0] as EnergyUtilityType;
}

function roleFromLabel(label: string): EnergyMeterRole {
    const option = roleOptions.value.find((o) => o.label === label);
    if (!option) throw new Error(`Unknown role option: ${label}`);
    return option.role;
}

function valueForLabel(map: Record<string, string>, label: string): string {
    const value = map[label];
    if (value === undefined) throw new Error(`Unknown option: ${label}`);
    return value;
}

function meterRoleLabel(meter: EnergyLogicalMeter): string {
    const options = energyRolesForUtility(meter.utilityType);
    return options.find((o) => o.role === meter.role)?.label ?? meter.role;
}

function serializeForm(): string {
    return JSON.stringify({
        selected: [...selected.value].sort(),
        utilityType: utilityType.value,
        role: role.value,
        name: name.value.trim(),
        costCentre: costCentre.value.trim(),
        kindId: kindId.value,
        groupId: groupId.value,
        locationId: locationId.value,
        parentMeterId: parentMeterId.value,
        editingMeterId: editingMeterId.value
    });
}

const dirty = computed(
    () => formBaseline.value !== '' && serializeForm() !== formBaseline.value
);
watch(
    dirty,
    (value) => {
        emit('dirty-change', value);
    },
    {immediate: true}
);

function captureBaseline(): void {
    formBaseline.value = serializeForm();
}

function toggle(point: EnergyMeasurementPoint): void {
    if (!canUpdateDevice.value) return;
    const key = energyPointKey(point);
    const next = new Set(selected.value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selected.value = next;
}

function canClassifyReturnedGas(point: EnergyMeasurementPoint): boolean {
    return (
        auth.canPerformComponent('devices', 'update', props.shellyID) &&
        point.componentKey != null &&
        point.assignedMeterId == null &&
        !(
            point.tag === 'volume_returned_m3' &&
            point.electricalDomain === 'gas'
        )
    );
}

function reviewReturnedGas(point: EnergyMeasurementPoint): void {
    if (!canClassifyReturnedGas(point)) return;
    classificationPoint.value = point;
    classificationError.value = '';
}

function cancelReturnedGasReview(): void {
    if (classifying.value) return;
    classificationPoint.value = null;
    classificationError.value = '';
}

async function applyReturnedGasClassification(): Promise<void> {
    const point = classificationPoint.value;
    if (!point || !canClassifyReturnedGas(point) || classifying.value) return;
    if (!point.componentKey) return;
    classifying.value = true;
    classificationError.value = '';
    try {
        await setPointOverride({
            deviceId: point.deviceId,
            componentKey: point.componentKey,
            channel: point.channel,
            tag: 'volume_returned_m3',
            electricalDomain: 'gas'
        });
        const found = await listMeasurementPoints({
            shellyID: props.shellyID,
            includeAssigned: true
        });
        points.value = found;
        selected.value = new Set(
            found
                .filter((candidate) =>
                    selected.value.has(energyPointKey(candidate))
                )
                .map(energyPointKey)
        );
        classificationPoint.value = null;
        toast.success('Returned-gas mapping saved');
    } catch (err) {
        classificationError.value =
            rpcErrorMessage(err);
    } finally {
        classifying.value = false;
    }
}

function selectUnassigned(): void {
    const unassigned = points.value.filter(
        (point) => point.assignedMeterId == null
    );
    const suggestion = suggestedUtilityForPoints(unassigned);
    if (editingMeterId.value === null && suggestion) {
        utilityType.value = suggestion;
    }
    let eligible = unassigned.filter((point) =>
        energyPointSupportsUtility(point, utilityType.value)
    );
    if (utilityType.value === 'gas') {
        const direction =
            eligible.find(
                (point) => energyPointFlowDirection(point) === 'import'
            ) != null
                ? 'import'
                : 'export';
        eligible = eligible.filter(
            (point) => energyPointFlowDirection(point) === direction
        );
    }
    selected.value = new Set(eligible.map(energyPointKey));
}

async function load(): Promise<void> {
    loading.value = true;
    error.value = '';
    try {
        // Assigned points are fetched too: they identify this device's
        // existing meters and pre-fill the form when one is edited.
        const [found, existingMeters, kindRows] = await Promise.all([
            listMeasurementPoints({
                shellyID: props.shellyID,
                includeAssigned: true
            }),
            listLogicalMeters(),
            listKinds('both'),
            groupsStore.fetchGroups(),
            locationsStore.fetchLocations()
        ]);
        points.value = found;
        meters.value = existingMeters;
        kinds.value = kindRows;
        selectUnassigned();
        if (name.value.trim() === '') name.value = props.deviceName;
        captureBaseline();
    } catch (err) {
        error.value = rpcErrorMessage(err);
    } finally {
        loading.value = false;
    }
}

async function save(): Promise<void> {
    if (!canUpdateDevice.value || !canSave.value || role.value === '') return;
    saving.value = true;
    error.value = '';
    try {
        const chosen = points.value.filter((point) =>
            selected.value.has(energyPointKey(point))
        );
        const editing =
            editingMeterId.value === null
                ? null
                : (meters.value.find(
                      (meter) => meter.id === editingMeterId.value
                  ) ?? null);
        if (editingMeterId.value !== null && editing === null) {
            throw new Error('The meter being edited no longer exists.');
        }
        // An edited meter may span devices: keep its points on other devices
        // untouched and replace only this device's selection. Fields the form
        // does not carry (cost center, formula) pass through unchanged —
        // the save RPC nulls whatever is omitted.
        const foreignPoints =
            editing?.points.filter(
                (point) => !deviceIds.value.has(point.deviceId)
            ) ?? [];
        await saveLogicalMeter({
            id: editing?.id,
            name: name.value.trim(),
            utilityType: utilityType.value,
            role: role.value,
            kindId: optionalString(kindId.value),
            phaseMode:
                editing && foreignPoints.length > 0
                    ? editing.phaseMode
                    : deriveEnergyPhaseMode(chosen),
            aggregationMode: editing?.aggregationMode ?? 'sum_points',
            points: [...chosen.map(toLogicalMeterPoint), ...foreignPoints],
            groupId: optionalNumber(groupId.value),
            locationId: optionalNumber(locationId.value),
            costCenter: optionalString(costCentre.value),
            parentMeterId: optionalNumber(parentMeterId.value),
            virtualFormula: editing?.virtualFormula ?? null
        });
        toast.success(`${name.value.trim()} saved`);
        resetForm();
        await load();
    } catch (err) {
        error.value = rpcErrorMessage(err);
    } finally {
        saving.value = false;
    }
}

function resetForm(): void {
    editingMeterId.value = null;
    utilityType.value = 'electric';
    role.value = '';
    name.value = props.deviceName;
    costCentre.value = '';
    kindId.value = '';
    groupId.value = '';
    locationId.value = '';
    parentMeterId.value = '';
    roleClearedHint.value = false;
    classificationPoint.value = null;
    classificationError.value = '';
}

function beginEdit(meter: EnergyLogicalMeter): void {
    if (!canUpdateDevice.value) return;
    editingMeterId.value = meter.id;
    utilityType.value = meter.utilityType;
    role.value = meter.role;
    name.value = meter.name;
    costCentre.value = meter.costCenter ?? '';
    kindId.value = meter.kindId ?? '';
    groupId.value = meter.groupId != null ? String(meter.groupId) : '';
    locationId.value = meter.locationId != null ? String(meter.locationId) : '';
    parentMeterId.value =
        meter.parentMeterId != null ? String(meter.parentMeterId) : '';
    roleClearedHint.value = false;
    selected.value = new Set(
        points.value
            .filter((point) => point.assignedMeterId === meter.id)
            .map(energyPointKey)
    );
    captureBaseline();
}

function cancelEdit(): void {
    resetForm();
    selectUnassigned();
    captureBaseline();
}

function reviewMeaning(): void {
    if (editingMeterId.value === null || !canUpdateDevice.value) return;
    const meterId = editingMeterId.value;
    const navigate = () => {
        void router.push({
            path: '/settings/energy/meters',
            query: {meterId: String(meterId)}
        });
    };
    if (settingsDirtyTracker?.requestExit) settingsDirtyTracker.requestExit(navigate);
    else navigate();
}

watch(
    () => props.shellyID,
    () => {
        resetForm();
        void load();
    },
    {immediate: true}
);

watch(utilityType, () => {
    const valid = roleOptions.value.some((option) => option.role === role.value);
    if (!valid) {
        // Keep a still-valid role across utility changes; clear only when the
        // new utility has no such role, and say so instead of blanking silently.
        if (role.value !== '') roleClearedHint.value = true;
        role.value = '';
    }
    selected.value = new Set(
        [...selected.value].filter((key) => {
            const point = points.value.find(
                (candidate) => energyPointKey(candidate) === key
            );
            return point
                ? energyPointSupportsUtility(point, utilityType.value)
                : false;
        })
    );
    if (selected.value.size === 0 && editingMeterId.value === null) {
        selected.value = new Set(
            compatibleAssignablePoints.value
                .filter((point) => point.assignedMeterId == null)
                .map(energyPointKey)
        );
    }
});

watch(role, (value) => {
    if (value !== '') roleClearedHint.value = false;
});
</script>

<style scoped>
.des {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.des-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: var(--space-3);
}

.des-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}

.des-label {
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
}

.des-input {
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--glass-border, transparent);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-1);
    color: var(--color-text-primary);
}

.des-point {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    background-color: var(--color-surface-1);
    color: var(--color-text-primary);
}

.des-point__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
}

.des-classifier {
    display: grid;
    gap: var(--space-2);
    margin-top: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--color-border-focus);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    color: var(--color-text-secondary);
}

.des-classifier h3,
.des-classifier p {
    margin: 0;
}

.des-classifier h3 {
    color: var(--color-text-primary);
    font-size: var(--type-body);
    line-height: 1.25;
}

.des-classifier small {
    display: block;
    margin-top: var(--space-1);
    line-height: 1.45;
}

.des-classifier__actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
}

.des-meters {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
}

.des-meter {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    background-color: var(--color-surface-1);
}

.des-meter--editing {
    outline: 1px solid var(--color-border-focus);
}

.des-meter__name {
    overflow: hidden;
    color: var(--color-text-primary);
    font-weight: var(--font-medium);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.des-meter__meta {
    flex: 1;
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
}

.des-save {
    display: flex;
    align-items: center;
    gap: var(--space-3);
}

.des-impact {
    display: grid;
    gap: var(--space-1);
    padding: var(--space-3);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
}

.des-impact strong {
    color: var(--color-text-primary);
    font-size: var(--type-body);
}

.des-impact small {
    color: var(--color-warning-text, var(--color-text-secondary));
}

.des-hint {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}

.des-tag,
.des-muted {
    color: var(--color-text-secondary);
}

.des-error {
    color: var(--color-danger);
}
</style>
