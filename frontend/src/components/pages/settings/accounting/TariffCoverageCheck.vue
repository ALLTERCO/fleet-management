<template>
    <div class="ua-section-heading">
        <div>
            <h3>Coverage</h3>
            <p>
                Pick a device or a location and see which tariff wins for
                import and for export.
            </p>
        </div>
    </div>

    <div class="flex flex-wrap items-end gap-3">
        <label class="ua-compact-field">
            <span>Check</span>
            <select id="coverage-scope" v-model="scope" class="ua-select">
                <option value="device">One device</option>
                <option value="location">One location</option>
            </select>
        </label>
        <label v-if="scope === 'device'" class="ua-compact-field">
            <span>Device</span>
            <select id="coverage-device" v-model="deviceId" class="ua-select">
                <option value="" disabled>Select device</option>
                <option v-for="device in devices" :key="device.shellyID" :value="device.shellyID">
                    {{ deviceName(device) }} · {{ device.shellyID }}
                </option>
            </select>
        </label>
        <label v-else class="ua-compact-field">
            <span>Location</span>
            <select id="coverage-location" v-model="locationId" class="ua-select">
                <option value="" disabled>Select location</option>
                <option v-for="location in locations" :key="location.id" :value="location.id">
                    {{ location.name }}
                </option>
            </select>
        </label>
        <Button
            type="blue-hollow"
            size="sm"
            :loading="loading"
            :disabled="matchingDevices.length === 0"
            @click="checkCoverage"
        >
            Check coverage
        </Button>
    </div>

    <p v-if="checkError" class="ua-form-error" role="alert">{{ checkError }}</p>

    <div v-if="emptyLocation" class="ua-state" role="status">
        <div>
            <strong>No devices in this location yet.</strong>
            <span>The locations under it hold no devices either.</span>
        </div>
    </div>

    <div v-if="tie" class="ua-state" role="status">
        <div>
            <strong>
                Two tariffs tie on the same scope, so Fleet Manager does not
                choose.
            </strong>
            <span>
                Every point marked ambiguous stays unpriced. Remove one of
                the tied assignments.
            </span>
        </div>
    </div>

    <div v-if="deviceWideGap" class="ua-state" role="status">
        <div>
            <strong>No single answer for the whole device.</strong>
            <span>
                Two tariffs tie for it, or some of its channels carry their
                own tariff.
            </span>
        </div>
    </div>

    <div v-if="truncated" class="ua-state" role="status">
        <div>
            <strong>Only the first {{ checkedDevices }} devices were checked.</strong>
            <span>Pick a smaller location to see the rest.</span>
        </div>
    </div>

    <DataList
        v-if="rows.length > 0"
        :rows="rows"
        :columns="COVERAGE_COLUMNS"
        row-key="key"
        :loading="loading"
    >
        <template #cell-device="{row}">
            <span class="ua-primary" dir="auto">{{ row.name }}</span>
            <span v-if="row.channel !== null"> · Channel {{ row.channel }}</span>
        </template>
        <template #cell-importTariff="{row}">
            <span v-if="row.importAnswer?.ambiguous" class="ua-badge ua-badge--warn">
                {{ coverageTariffLabel(row.importAnswer, tariffs) }}
            </span>
            <template v-else>
                <span>{{ coverageTariffLabel(row.importAnswer, tariffs) }}</span>
                <span> {{ coverageSourceLabel(row.importAnswer, locations) }}</span>
            </template>
        </template>
        <template #cell-exportTariff="{row}">
            <span v-if="row.exportAnswer?.ambiguous" class="ua-badge ua-badge--warn">
                {{ coverageTariffLabel(row.exportAnswer, tariffs) }}
            </span>
            <template v-else>
                <span>{{ coverageTariffLabel(row.exportAnswer, tariffs) }}</span>
                <span> {{ coverageSourceLabel(row.exportAnswer, locations) }}</span>
            </template>
        </template>
    </DataList>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import DataList from '@/components/core/DataList.vue';
import {rpcErrorMessage} from '@/helpers/rpcError';
import type {HostResult} from '@/shell/template-host/generated/contract';
import type {ApiLocation} from '@/stores/locations';
import {sendRPC} from '@/tools/websocket';
import type {shelly_device_t} from '@/types/device';
import {
    type Assignment,
    type Commodity,
    deviceName,
    type Tariff
} from './tariffAssignmentView';
import {
    COVERAGE_COLUMNS,
    type CoveragePoint,
    type CoverageRow,
    channelOverrides,
    childLocationsOf,
    coveragePlan,
    coverageRowsFrom,
    coverageSourceLabel,
    coverageTariffLabel,
    isAmbiguous,
    locationWithDescendants,
    type Resolution,
    resolutionPoints
} from './tariffCoverageView';

const props = defineProps<{
    devices: shelly_device_t[];
    locations: ApiLocation[];
    assignments: Assignment[];
    tariffs: Tariff[];
    commodity: Commodity;
}>();

const scope = ref<'device' | 'location'>('device');
const deviceId = ref('');
const locationId = ref<string | number>('');
const rows = ref<CoverageRow[]>([]);
const loading = ref(false);
const checkedDevices = ref(0);
const truncated = ref(false);
const checkError = ref('');
let request = 0;

const childLocations = computed(() => childLocationsOf(props.locations));
const matchingDevices = computed<shelly_device_t[]>(() => {
    if (scope.value === 'device') {
        const device = props.devices.find(
            (candidate) => candidate.shellyID === deviceId.value
        );
        return device ? [device] : [];
    }
    const covered = locationWithDescendants(
        childLocations.value,
        Number(locationId.value)
    );
    return props.devices.filter(
        (device) =>
            device.locationId !== null &&
            device.locationId !== undefined &&
            covered.has(device.locationId)
    );
});
const emptyLocation = computed(
    () =>
        scope.value === 'location' &&
        locationId.value !== '' &&
        matchingDevices.value.length === 0
);
const tie = computed(() =>
    rows.value.some((row) => row.channel !== null && isAmbiguous(row))
);
const deviceWideGap = computed(() =>
    rows.value.some((row) => row.channel === null && isAmbiguous(row))
);

// An answer kept after a new pick would name the tariff of the old pick.
watch([() => props.commodity, scope, deviceId, locationId], () => {
    request += 1;
    rows.value = [];
    truncated.value = false;
    checkError.value = '';
});

async function checkCoverage(): Promise<void> {
    if (loading.value || matchingDevices.value.length === 0) return;
    loading.value = true;
    checkError.value = '';
    request += 1;
    try {
        await showCoverage(request);
    } catch (error) {
        checkError.value = rpcErrorMessage(error, 'Could not check coverage');
    } finally {
        loading.value = false;
    }
}

async function showCoverage(asked: number): Promise<void> {
    const matching = matchingDevices.value;
    const plan = coveragePlan(
        matching,
        channelOverrides(props.assignments, props.commodity)
    );
    const answers = await resolveCoverage(plan.points);
    // A pick made while the answer was in flight makes that answer stale.
    if (asked !== request) return;
    rows.value = coverageRowsFrom(plan.points, answers);
    checkedDevices.value = plan.checkedDevices;
    truncated.value = plan.checkedDevices < matching.length;
}

async function resolveCoverage(
    points: CoveragePoint[]
): Promise<Resolution[]> {
    const result = await sendRPC<HostResult<'tariff.resolveassignments'>>(
        'FLEET_MANAGER',
        'tariff.resolveassignments',
        {points: resolutionPoints(points, props.commodity)}
    );
    return result.items ?? [];
}
</script>
