<template>
    <Modal :visible="true" wide tall @close="emit('close')">
        <template #title>
            <ModalHeader title="Dashboard settings" description="Energy" />
        </template>

        <template #default>
            <!-- Nested modal — helpers/modalStack gives it its own depth above this one. -->
            <EnergyTariffEditor
                v-if="tariffEditorOpen"
                :editing-id="tariffEditorId"
                :default-currency="form.currency"
                :default-timezone="form.tariffTimezone || 'UTC'"
                @close="tariffEditorOpen = false"
                @saved="onTariffSaved"
            />

            <div class="esp-body">
                <ModalTabRail
                    v-model="tab"
                    :tabs="railTabs"
                    aria-label="Dashboard settings sections"
                />

                <div class="esp-panel">
                    <!-- Scope -->
                    <section v-show="tab === 'scope'" class="esp-stack">
                        <FormField label="Dashboard name">
                            <Input v-model="name" placeholder="Energy" :maxlength="120" />
                        </FormField>
                        <FormField label="What this dashboard covers">
                            <ViewToggle v-model="form.scopeType" :options="SCOPE_OPTIONS" />
                        </FormField>
                        <FormField
                            v-if="form.scopeType === 'group'"
                            label="Group"
                            :error="scopeInvalid ? 'Pick a group — without one the dashboard would silently fall back to the whole fleet.' : ''"
                        >
                            <Dropdown
                                :groups="groupOptions"
                                :default="form.groupId ?? undefined"
                                placeholder="Choose a group"
                                aria-label="Group"
                                @selected="onGroupPicked"
                            />
                        </FormField>
                    </section>

                    <!-- Tariff -->
                    <section v-show="tab === 'tariff'" class="esp-stack">
                        <div v-if="form.tariffId != null" class="esp-legacy-tariff">
                            <div>
                                <strong>Legacy dashboard tariff</strong>
                                <p>{{ tariffName(form.tariffId) }}</p>
                            </div>
                            <span>Read only</span>
                        </div>
                        <p v-if="form.tariffId != null" class="esp-hint">
                            This stored dashboard billing value remains untouched, but it is not part of the canonical tariff hierarchy.
                        </p>

                        <div class="esp-tariff-actions">
                            <Button type="blue-hollow" size="sm" @click="openTariffEditor(null)">
                                New tariff
                            </Button>
                            <Button
                                v-if="assignmentTariffId != null"
                                type="blue-hollow"
                                size="sm"
                                @click="openTariffEditor(assignmentTariffId)"
                            >
                                Edit selected
                            </Button>
                        </div>
                        <p class="esp-hint">
                            Seasonal, time-of-use and live tariffs are created here and shared across the organisation.
                        </p>

                        <FormSection
                            v-if="tariffList.length"
                            title="Where this tariff applies"
                            icon="fas fa-sitemap"
                        >
                            <p class="esp-hint">
                                Set the default at one exact level. More specific assignments stay in place and continue to win.
                            </p>

                            <FormField
                                label="Tariff to assign"
                                :error="assignmentTariffId == null ? 'Choose the tariff to assign.' : ''"
                            >
                                <Dropdown
                                    :key="`assignment-tariff-${assignmentTariffId ?? 'none'}`"
                                    :groups="tariffOptions"
                                    :default="assignmentTariffId ?? undefined"
                                    placeholder="Choose a tariff"
                                    aria-label="Tariff to assign"
                                    @selected="onAssignmentTariffPicked"
                                />
                            </FormField>

                            <FormField label="Assignment level">
                                <ViewToggle
                                    v-model="assignmentScope"
                                    :options="TARIFF_SCOPE_OPTIONS"
                                />
                            </FormField>

                            <FormField
                                v-if="assignmentScope === 'location'"
                                label="Location"
                                :error="assignmentLocationId == null ? 'Choose the location this tariff applies to.' : ''"
                            >
                                <Dropdown
                                    :key="`location-${assignmentLocationId ?? 'none'}`"
                                    :groups="assignmentLocationOptions"
                                    :default="assignmentLocationId ?? undefined"
                                    searchable
                                    placeholder="Choose a location"
                                    aria-label="Tariff location"
                                    @selected="onAssignmentLocationPicked"
                                />
                            </FormField>

                            <FormField
                                v-if="assignmentScope === 'device' || assignmentScope === 'channel'"
                                label="Meter"
                                :error="assignmentDeviceId === '' ? 'Choose the meter this tariff applies to.' : ''"
                            >
                                <Dropdown
                                    :key="`device-${assignmentDeviceId || 'none'}`"
                                    :groups="assignmentDeviceOptions"
                                    :default="assignmentDeviceId || undefined"
                                    searchable
                                    placeholder="Choose a meter"
                                    aria-label="Tariff meter"
                                    @selected="onAssignmentDevicePicked"
                                />
                            </FormField>

                            <FormField
                                v-if="assignmentScope === 'channel'"
                                label="Channel"
                                :error="assignmentChannel == null ? 'Choose the channel this tariff applies to.' : ''"
                            >
                                <Dropdown
                                    :key="`channel-${assignmentDeviceId}-${assignmentChannel ?? 'none'}`"
                                    :groups="assignmentChannelOptions"
                                    :default="assignmentChannel ?? undefined"
                                    placeholder="Choose a channel"
                                    aria-label="Tariff channel"
                                    @selected="onAssignmentChannelPicked"
                                />
                            </FormField>

                            <div class="esp-impact" aria-live="polite">
                                <div class="esp-impact__icon" aria-hidden="true">
                                    <i :class="assignmentImpact.icon" />
                                </div>
                                <div class="esp-impact__copy">
                                    <strong>{{ assignmentImpact.title }}</strong>
                                    <p>{{ assignmentImpact.detail }}</p>
                                    <p v-if="exactAssignment" class="esp-impact__current">
                                        This exact level currently uses
                                        <strong>{{ tariffName(exactAssignment.tariffId) }}</strong>.
                                    </p>
                                </div>
                            </div>

                            <p v-if="assignmentError" class="esp-assignment-status esp-assignment-status--error" role="alert">
                                {{ assignmentError }}
                            </p>
                            <p v-else-if="assignmentSuccess" class="esp-assignment-status esp-assignment-status--success" role="status">
                                {{ assignmentSuccess }}
                            </p>

                            <div v-if="assignmentReviewOpen" class="esp-assignment-review">
                                <p>
                                    Confirm: assign <strong>{{ selectedTariffName }}</strong> to
                                    <strong>{{ assignmentImpact.target }}</strong>.
                                    Applying it can change calculated energy and demand costs for every metering point inheriting this scope.
                                    Narrower overrides remain; unassigned or mixed points remain unavailable.
                                </p>
                                <div class="esp-assignment-review__actions">
                                    <Button
                                        type="blue-hollow"
                                        size="sm"
                                        :disabled="assignmentBusy"
                                        @click="assignmentReviewOpen = false"
                                    >
                                        Back
                                    </Button>
                                    <Button
                                        type="blue"
                                        size="sm"
                                        :loading="assignmentBusy"
                                        :disabled="assignmentBusy"
                                        @click="applyTariffAssignment"
                                    >
                                        Confirm assignment
                                    </Button>
                                </div>
                            </div>
                            <Button
                                v-else
                                type="blue-hollow"
                                size="sm"
                                :disabled="!assignmentValid || assignmentBusy"
                                @click="reviewTariffAssignment"
                            >
                                Review assignment
                            </Button>
                        </FormSection>

                        <p v-if="form.tariffId == null" class="esp-legacy-tariff-note">
                            No legacy dashboard tariff is configured. Create or select an organisation tariff above, then assign it at the exact scope where it applies.
                        </p>
                    </section>

                    <!-- Meters (real device pickers) -->
                    <section v-show="tab === 'meters'" class="esp-stack">
                        <FormField
                            :label="`Main meters — grid entry points (${form.mainMeterIds.length} selected)`"
                            hint="The meters that measure your total grid import / export."
                        >
                            <EnergyDevicePicker v-model="form.mainMeterIds" :devices="deviceList" />
                        </FormField>
                        <FormField
                            :label="`Peak-power devices (${form.peakDeviceIds.length} selected)`"
                            hint="Counted toward the peak-demand figure. Leave empty to use every device in scope."
                        >
                            <EnergyDevicePicker v-model="form.peakDeviceIds" :devices="deviceList" />
                        </FormField>
                    </section>

                    <!-- Display — auto-refresh cadence intentionally lives in the shell ⋮ menu, not here -->
                    <section v-show="tab === 'display'" class="esp-stack">
                        <FormField label="Default date range">
                            <Dropdown
                                :groups="RANGE_GROUPS"
                                :default="form.defaultRange"
                                aria-label="Default date range"
                                @selected="onRangePicked"
                            />
                        </FormField>
                        <FormSection title="Power quality">
                            <div class="esp-row">
                                <FormField label="Nominal voltage (V)">
                                    <input v-model.number="form.nominalVoltage" :class="INPUT_CLASS" type="number" step="1" min="1" />
                                </FormField>
                                <FormField label="Nominal frequency (Hz)">
                                    <input v-model.number="form.nominalHz" :class="INPUT_CLASS" type="number" step="1" min="1" />
                                </FormField>
                            </div>
                            <p class="esp-hint">
                                Sets the EN 50160 ±10 % voltage band used for the power-quality checks and report.
                            </p>
                        </FormSection>
                    </section>

                    <!-- PV -->
                    <section v-show="tab === 'pv'" class="esp-stack">
                        <FormField label="PV / solar">
                            <ViewToggle v-model="form.pvMode" :options="PV_OPTIONS" />
                        </FormField>
                        <template v-if="form.pvMode !== ''">
                            <p v-if="form.feedInRate" class="esp-legacy-tariff-note">
                                Legacy dashboard feed-in rate: {{ form.feedInRate }} per kWh. Read only; canonical export pricing belongs in the tariff library.
                            </p>
                            <FormField
                                :label="`Generation meters — PV inverters (${form.pvGenIds.length} selected)`"
                                hint="Meters that measure what your panels produce."
                            >
                                <EnergyDevicePicker v-model="form.pvGenIds" :devices="deviceList" />
                            </FormField>
                            <FormField
                                :label="`Grid meters for PV (${form.pvGridIds.length} selected)`"
                                hint="Meters at the grid connection, so exported solar is measured correctly."
                            >
                                <EnergyDevicePicker v-model="form.pvGridIds" :devices="deviceList" />
                            </FormField>
                        </template>
                    </section>

                    <!-- Carbon -->
                    <section v-show="tab === 'carbon'" class="esp-stack">
                        <FormField
                            label="Grid emission factor — location-based (g CO₂ / kWh)"
                            hint="The average grid mix where these devices run."
                        >
                            <input v-model.number="form.emissionFactor" :class="INPUT_CLASS" type="number" step="1" min="0" />
                        </FormField>
                        <FormField
                            label="Market-based factor — green tariff / RECs (g CO₂ / kWh)"
                            hint="Set this only if you buy certified green energy."
                        >
                            <input
                                v-model.number="form.emissionFactorMbm"
                                :class="INPUT_CLASS"
                                type="number"
                                step="1"
                                min="0"
                                placeholder="Leave blank if none"
                            />
                        </FormField>
                        <FormField label="CO₂ budget for the period (kg)">
                            <input v-model.number="form.co2Budget" :class="INPUT_CLASS" type="number" step="1" min="0" />
                        </FormField>
                    </section>
                </div>
            </div>
        </template>

        <template #footer>
            <ModalFooter>
                <template v-if="scopeInvalid" #meta>
                    <span class="esp-footer-warn">
                        <i class="fas fa-circle-exclamation" aria-hidden="true" />
                        Scope needs a group before saving
                    </span>
                </template>
                <template #secondary>
                    <Button type="blue-hollow" :disabled="saving" @click="emit('close')">Cancel</Button>
                </template>
                <template #primary>
                    <Button type="blue" :loading="saving" :disabled="!canSave" @click="save">Save</Button>
                </template>
            </ModalFooter>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import {computed, onMounted, reactive, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import Dropdown from '@/components/core/Dropdown.vue';
import FormField from '@/components/core/FormField.vue';
import FormSection from '@/components/core/FormSection.vue';
import Input from '@/components/core/Input.vue';
import ModalFooter from '@/components/core/ModalFooter.vue';
import ModalHeader from '@/components/core/ModalHeader.vue';
import ModalTabRail, {type TabRailItem} from '@/components/core/ModalTabRail.vue';
import ViewToggle, {type ViewToggleOption} from '@/components/core/ViewToggle.vue';
import Modal from '@/components/modals/Modal.vue';
import * as ws from '@/tools/websocket';
import type {DashboardSettings} from '@/types/dashboard';
import EnergyDevicePicker from './EnergyDevicePicker.vue';
import EnergyTariffEditor from './EnergyTariffEditor.vue';
import {type EnergySettingsForm, toSettingsPayload} from './energySettings.payload';

const props = defineProps<{
    settings: DashboardSettings;
    name: string;
    groupId: number | null;
    groups: {id: number; name: string}[];
    devices?: {id: number; shellyId: string; name: string}[];
    assignmentDevices?: {
        shellyId: string;
        name: string;
        locationId: number | null;
        channels: number[];
    }[];
    locations?: {id: number; name: string}[];
    tariffs?: {id: number; name: string; kind: string; currency: string}[];
    dashboardId: number;
    /** Parent-owned RPC chain in flight — disables Save and shows the spinner. */
    saving?: boolean;
}>();
const emit = defineEmits<{
    close: [];
    save: [payload: Partial<DashboardSettings & {groupId: number | null; name: string}>];
    'reload-tariffs': [];
}>();

// The shared Input atom renders exactly these classes; native number/time
// inputs reuse them so every field in the modal looks identical.
const INPUT_CLASS = 'core-input border text-base rounded-lg block w-full p-2';

type TariffAssignmentScope =
    | 'organization'
    | 'location'
    | 'device'
    | 'channel';
interface TariffAssignment {
    tariffId: number;
    scopeLevel: TariffAssignmentScope | 'dashboard';
    dashboardId: number | null;
    locationId: number | null;
    deviceExternalId: string | null;
    channel: number | null;
}

const SCOPE_OPTIONS: ViewToggleOption<'fleet' | 'group'>[] = [
    {value: 'fleet', label: 'Whole fleet'},
    {value: 'group', label: 'A group'}
];
const TARIFF_SCOPE_OPTIONS: ViewToggleOption<TariffAssignmentScope>[] = [
    {value: 'organization', label: 'Organisation'},
    {value: 'location', label: 'Location'},
    {value: 'device', label: 'Meter'},
    {value: 'channel', label: 'Channel'}
];
const PV_OPTIONS: ViewToggleOption<string>[] = [
    {value: 'parallel', label: 'Parallel'},
    {value: 'backup', label: 'Backup'},
    {value: 'balcony', label: 'Balcony'},
    {value: '', label: 'None'}
];
const RANGE_GROUPS = [
    {
        label: 'Presets',
        items: [
            {value: 'last_7_days', label: 'Last 7 days'},
            {value: 'last_30_days', label: 'Last 30 days'},
            {value: 'mtd', label: 'This month'},
            {value: 'last_month', label: 'Last month'}
        ]
    }
];


const tab = ref('scope');
const name = ref(props.name);
const deviceList = computed(() => props.devices ?? []);
const tariffList = computed(() => props.tariffs ?? []);

// Canonical tariff assignments are Fleet-owned. This form reads and writes
// them through Tariff.* only; dashboard settings and browser storage are not
// used as a second hierarchy.
const assignmentTariffId = ref<number | null>(null);
const assignments = ref<TariffAssignment[]>([]);
const assignmentScope = ref<TariffAssignmentScope>('organization');
const assignmentLocationId = ref<number | null>(null);
const assignmentDeviceId = ref('');
const assignmentChannel = ref<number | null>(null);
const assignmentBusy = ref(false);
const assignmentReviewOpen = ref(false);
const assignmentError = ref('');
const assignmentSuccess = ref('');

const assignmentDeviceList = computed(() => props.assignmentDevices ?? []);
const assignmentLocationOptions = computed(() => [
    {
        label: 'Locations',
        items: (props.locations ?? []).map((location) => ({
            value: location.id,
            label: location.name
        }))
    }
]);
const assignmentDeviceOptions = computed(() => [
    {
        label: 'Meters',
        items: assignmentDeviceList.value.map((device) => ({
            value: device.shellyId,
            label: device.name
        }))
    }
]);
const selectedAssignmentDevice = computed(() =>
    assignmentDeviceList.value.find(
        (device) => device.shellyId === assignmentDeviceId.value
    )
);
const assignmentChannelOptions = computed(() => [
    {
        label: 'Meter channels',
        items: (selectedAssignmentDevice.value?.channels ?? []).map(
            (channel) => ({value: channel, label: `Channel ${channel}`})
        )
    }
]);

function onAssignmentLocationPicked(id: number) {
    assignmentLocationId.value = id;
}
function onAssignmentTariffPicked(id: number) {
    assignmentTariffId.value = id;
}
function onAssignmentDevicePicked(id: string) {
    assignmentDeviceId.value = id;
    const channels = assignmentDeviceList.value.find(
        (device) => device.shellyId === id
    )?.channels;
    assignmentChannel.value = channels?.length === 1 ? channels[0] : null;
}
function onAssignmentChannelPicked(channel: number) {
    assignmentChannel.value = channel;
}

const assignmentValid = computed(() => {
    if (assignmentTariffId.value == null) return false;
    if (assignmentScope.value === 'location') {
        return assignmentLocationId.value != null;
    }
    if (assignmentScope.value === 'device') {
        return assignmentDeviceId.value !== '';
    }
    if (assignmentScope.value === 'channel') {
        return assignmentDeviceId.value !== '' && assignmentChannel.value != null;
    }
    return true;
});

function tariffName(id: number): string {
    return tariffList.value.find((tariff) => tariff.id === id)?.name ?? `Tariff ${id}`;
}
const selectedTariffName = computed(() =>
    assignmentTariffId.value == null
        ? 'the selected tariff'
        : tariffName(assignmentTariffId.value)
);

const assignmentTarget = computed(() => {
    if (assignmentScope.value === 'location') {
        const location = (props.locations ?? []).find(
            (item) => item.id === assignmentLocationId.value
        );
        return {
            icon: 'fas fa-location-dot',
            target: location?.name ?? 'the selected location'
        };
    }
    if (assignmentScope.value === 'device') {
        const target = selectedAssignmentDevice.value?.name ?? 'the selected meter';
        return {
            icon: 'fas fa-gauge-high',
            target
        };
    }
    if (assignmentScope.value === 'channel') {
        const meter = selectedAssignmentDevice.value?.name ?? 'the selected meter';
        const target = assignmentChannel.value == null
            ? `${meter}, selected channel`
            : `${meter}, channel ${assignmentChannel.value}`;
        return {
            icon: 'fas fa-wave-square',
            target
        };
    }
    return {
        icon: 'fas fa-building',
        target: 'the organisation default'
    };
});

function assignmentRequest(): Record<string, unknown> | null {
    if (!assignmentValid.value || assignmentTariffId.value == null) return null;
    const input: Record<string, unknown> = {
        tariffId: assignmentTariffId.value,
        scopeLevel: assignmentScope.value
    };
    if (assignmentScope.value === 'location') {
        input.locationId = assignmentLocationId.value;
    } else if (assignmentScope.value === 'device') {
        input.deviceExternalId = assignmentDeviceId.value;
    } else if (assignmentScope.value === 'channel') {
        input.deviceExternalId = assignmentDeviceId.value;
        input.channel = assignmentChannel.value;
    }
    return input;
}

async function loadTariffAssignments() {
    try {
        const result = (await ws.sendRPC(
            'FLEET_MANAGER',
            'tariff.listassignments',
            {}
        )) as {items?: TariffAssignment[]};
        assignments.value = result.items ?? [];
    } catch (error) {
        assignmentError.value =
            (error as {message?: string})?.message ??
            'Could not load current tariff assignments. You can still review the selected scope.';
    }
}

const exactAssignment = computed(() =>
    assignments.value.find((assignment) => {
        if (assignment.scopeLevel !== assignmentScope.value) return false;
        if (assignmentScope.value === 'organization') return true;
        if (assignmentScope.value === 'location') {
            return assignment.locationId === assignmentLocationId.value;
        }
        if (assignmentScope.value === 'device') {
            return assignment.deviceExternalId === assignmentDeviceId.value;
        }
        return (
            assignment.deviceExternalId === assignmentDeviceId.value &&
            assignment.channel === assignmentChannel.value
        );
    })
);

const assignmentImpact = computed(() => {
    if (assignmentScope.value === 'organization') {
        return {
            ...assignmentTarget.value,
            title: 'Organisation default',
            detail:
                'Fleet metering points without a narrower assignment inherit this tariff. Applying it can change their calculated energy and demand costs; unassigned or mixed points remain unavailable.'
        };
    }
    if (assignmentScope.value === 'location') {
        return {
            ...assignmentTarget.value,
            title: `Location default: ${assignmentTarget.value.target}`,
            detail:
                'Meter points in this location and its descendants may inherit this tariff, changing calculated energy and demand costs. Meter and channel overrides remain unchanged.'
        };
    }
    if (assignmentScope.value === 'device') {
        return {
            ...assignmentTarget.value,
            title: `Meter default: ${assignmentTarget.value.target}`,
            detail:
                'This meter’s points may inherit the tariff, changing calculated energy and demand costs. Channel overrides remain unchanged.'
        };
    }
    return {
        ...assignmentTarget.value,
        title: `Exact channel: ${assignmentTarget.value.target}`,
        detail:
            'Only this exact channel is replaced, which can change its calculated energy and demand costs. No broader assignment is changed.'
    };
});

function reviewTariffAssignment() {
    if (!assignmentValid.value) return;
    assignmentError.value = '';
    assignmentSuccess.value = '';
    assignmentReviewOpen.value = true;
}

async function applyTariffAssignment() {
    if (assignmentBusy.value) return;
    const input = assignmentRequest();
    if (!input) return;

    assignmentBusy.value = true;
    assignmentError.value = '';
    try {
        await ws.sendRPC('FLEET_MANAGER', 'tariff.assign', input);
        assignmentReviewOpen.value = false;
        assignmentSuccess.value =
            `${selectedTariffName.value} now applies to ${assignmentTarget.value.target}. ` +
            'Narrower overrides were preserved.';
        await loadTariffAssignments();
    } catch (error) {
        assignmentError.value =
            (error as {message?: string})?.message ??
            'Could not save the tariff assignment. Try again.';
    } finally {
        assignmentBusy.value = false;
    }
}

watch(
    [
        assignmentTariffId,
        assignmentScope,
        assignmentLocationId,
        assignmentDeviceId,
        assignmentChannel,
        assignmentDeviceList
    ],
    () => {
        assignmentReviewOpen.value = false;
        assignmentError.value = '';
        assignmentSuccess.value = '';
    }
);
onMounted(() => void loadTariffAssignments());

// Inline tariff editor (create / edit a reusable org tariff).
const tariffEditorOpen = ref(false);
const tariffEditorId = ref<number | null>(null);
function openTariffEditor(id: number | null) {
    tariffEditorId.value = id;
    tariffEditorOpen.value = true;
}
function onTariffSaved(id: number) {
    tariffEditorOpen.value = false;
    assignmentTariffId.value = id;
    emit('reload-tariffs');
}

const cs = (props.settings.chartSettings ?? {}) as Record<string, unknown>;
const s = props.settings;
const form = reactive<EnergySettingsForm>({
    scopeType: props.groupId == null ? 'fleet' : 'group',
    groupId: props.groupId,
    tariffId: s.tariffId ?? null,
    tariffMode: s.tariffMode ?? 'single',
    tariff: s.tariff ?? 0,
    dayRate: s.dayRate ?? 0,
    nightRate: s.nightRate ?? 0,
    dayStart: (s.dayStart ?? '07:00:00').slice(0, 5),
    dayEnd: (s.dayEnd ?? '23:00:00').slice(0, 5),
    currency: s.currency ?? 'EUR',
    tariffTimezone: s.tariffTimezone ?? '',
    tariffWindows: [...(s.tariffWindows ?? [])],
    weekendEnabled: (s.tariffWeekendOverride?.length ?? 0) > 0,
    weekendWindows: [...(s.tariffWeekendOverride ?? [])],
    holidaysText: (s.tariffHolidays ?? []).join(', '),
    defaultRange: s.defaultRange ?? 'last_7_days',
    emissionFactor: s.emissionFactorGPerKWh ?? 414,
    emissionFactorMbm: s.emissionFactorMbmGPerKWh ?? null,
    co2Budget: s.co2BudgetKg ?? null,
    pvMode: s.pvMode ?? '',
    feedInRate: (cs.feedInRate as number | undefined) ?? 0,
    demandRate: (cs.demandRate as number | undefined) ?? 0,
    standingCharge: (cs.standingCharge as number | undefined) ?? 0,
    standingPeriod: (cs.standingPeriod as 'day' | 'month' | undefined) ?? 'month',
    vatPct: (cs.vatPct as number | undefined) ?? 0,
    billingDay: (cs.billingDay as number | undefined) ?? 1,
    nominalVoltage: (cs.nominalVoltage as number | undefined) ?? 230,
    nominalHz: (cs.nominalHz as number | undefined) ?? 50,
    mainMeterIds: [...((cs.mainMeterIds as string[] | undefined) ?? [])],
    peakDeviceIds: [...(s.peakDeviceIds ?? [])],
    pvGridIds: (s.pvGridRefs ?? []).map((r) => r.device),
    pvGenIds: (s.pvGenerationRefs ?? []).map((r) => r.device)
});

// A group scope without a group would save groupId:null and silently flip the
// dashboard to fleet scope — flagged on the rail and blocking Save instead.
const scopeInvalid = computed(() => form.scopeType === 'group' && form.groupId == null);

const railTabs = computed<TabRailItem[]>(() => [
    {key: 'scope', label: 'Scope', icon: 'fa-crosshairs', invalid: scopeInvalid.value},
    {key: 'tariff', label: 'Tariff & rates', icon: 'fa-coins'},
    {key: 'meters', label: 'Meters', icon: 'fa-gauge-high'},
    {key: 'display', label: 'Display', icon: 'fa-sliders'},
    {key: 'pv', label: 'Solar / PV', icon: 'fa-solar-panel'},
    {key: 'carbon', label: 'Carbon', icon: 'fa-leaf'}
]);

// Dirty = the form (or the name) differs from what this dialog was seeded with.
// Serialize-compare is enough: the object shape never changes after setup, so
// key order is stable on both sides.
const baseline = JSON.stringify({name: name.value, form});
const dirty = computed(() => JSON.stringify({name: name.value, form}) !== baseline);

const canSave = computed(() => dirty.value && !scopeInvalid.value && !props.saving);

const groupOptions = computed(() => [
    {label: 'Groups', items: props.groups.map((g) => ({value: g.id, label: g.name}))}
]);
function onGroupPicked(id: number) {
    form.groupId = id;
}

const tariffOptions = computed(() => [
    {
        label: 'Saved tariffs',
        items: tariffList.value.map((t) => ({
            value: t.id,
            label: `${t.name} · ${t.kind} · ${t.currency}`
        }))
    }
]);

function onRangePicked(range: string) {
    form.defaultRange = range;
}

function save() {
    if (scopeInvalid.value) {
        // Surface the inline error rather than saving a broken scope.
        tab.value = 'scope';
        return;
    }
    const trimmed = name.value.trim();
    const payload = toSettingsPayload(form, cs) as Partial<
        DashboardSettings & {groupId: number | null; name: string}
    >;
    // Only carry a name when it changed and is non-empty — the rename runs a
    // separate dashboard.update and an empty name would be rejected.
    if (trimmed && trimmed !== props.name) payload.name = trimmed;
    emit('save', payload);
}
</script>

<style scoped>
.esp-body {
    display: grid;
    grid-template-columns: var(--form-tab-rail-width) minmax(0, 1fr);
    gap: var(--gap-md);
    align-items: start;
}

.esp-panel {
    min-width: 0;
}

.esp-stack {
    display: flex;
    flex-direction: column;
    gap: var(--gap-md);
}

.esp-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--gap-sm);
    align-items: start;
}

.esp-hint {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    line-height: var(--leading-normal);
}

.esp-tariff-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--gap-sm);
}

.esp-impact {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--gap-sm);
    align-items: start;
    padding: var(--gap-sm);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
}

.esp-impact__icon {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border-radius: var(--radius-sm);
    background: var(--color-surface-3);
    color: var(--color-primary-text);
}

.esp-impact__copy {
    min-width: 0;
}

.esp-impact__copy strong {
    color: var(--color-text-primary);
}

.esp-impact__copy p {
    margin: var(--space-1) 0 0;
    color: var(--color-text-secondary);
    line-height: var(--leading-normal);
    overflow-wrap: anywhere;
}

.esp-impact__copy .esp-impact__current {
    color: var(--color-warning-text);
}

.esp-assignment-review {
    display: grid;
    gap: var(--gap-sm);
    padding: var(--gap-sm);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface-3);
}

.esp-assignment-review p,
.esp-assignment-status {
    margin: 0;
    line-height: var(--leading-normal);
}

.esp-assignment-review p {
    color: var(--color-text-secondary);
}

.esp-assignment-review p strong {
    color: var(--color-text-primary);
}

.esp-assignment-review__actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--gap-sm);
}

.esp-assignment-status--error {
    color: var(--color-danger-text);
}

.esp-assignment-status--success {
    color: var(--color-success-text);
}

.esp-footer-warn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-warning-text);
    font-size: var(--type-body);
}

@media (max-width: 900px) {
    .esp-body {
        grid-template-columns: 1fr;
    }
}

@media (max-width: 640px) {
    .esp-row {
        grid-template-columns: 1fr;
    }
}
</style>
