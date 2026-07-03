<template>
    <div class="ov-indoor">
        <OverviewSection title="Identity" icon="fa-id-card">
            <OverviewStatGrid :stats="identityStats" />
        </OverviewSection>

        <OverviewSection
            v-if="setpointStats.length > 0"
            title="Environmental setpoint"
            icon="fa-temperature-half"
        >
            <OverviewStatGrid :stats="setpointStats" />
        </OverviewSection>

        <OverviewSection
            v-if="complianceTags.length > 0"
            title="Compliance"
            icon="fa-shield-halved"
        >
            <OverviewComplianceChips :tags="complianceTags" />
        </OverviewSection>

        <OverviewSection
            v-if="children.length > 0"
            title="Inside this space"
            icon="fa-sitemap"
            :hint="childrenHint"
        >
            <OverviewChildGrid
                :children="children"
                @open="$emit('navigate', $event)"
            />
        </OverviewSection>
    </div>
</template>

<script setup lang="ts">
import {computed, toRef} from 'vue';
import OverviewChildGrid from '@/components/locations/overview/OverviewChildGrid.vue';
import OverviewComplianceChips from '@/components/locations/overview/OverviewComplianceChips.vue';
import OverviewSection from '@/components/locations/overview/OverviewSection.vue';
import OverviewStatGrid, {
    type OverviewStat
} from '@/components/locations/overview/OverviewStatGrid.vue';
import {useChildOverview} from '@/composables/useChildOverview';
import {
    formatCount,
    formatRange,
    readInt,
    readNumber,
    readString
} from '@/helpers/location-field-format';
import type {ApiLocation} from '@/stores/locations';

const props = defineProps<{location: ApiLocation}>();

defineEmits<{navigate: [id: number]}>();

const children = useChildOverview(toRef(() => props.location.id));

const fields = computed(
    () => (props.location.kindFields ?? {}) as Record<string, unknown>
);

const identityStats = computed<OverviewStat[]>(() => {
    const rows: OverviewStat[] = [];
    const floor = readInt(fields.value.floorNumber);
    if (floor != null) rows.push({label: 'Floor', value: String(floor)});
    const room = readString(fields.value.roomNumber);
    if (room) rows.push({label: 'Room', value: room});
    const roomType = readString(fields.value.roomType);
    if (roomType) rows.push({label: 'Type', value: roomType});
    const capacity = readInt(fields.value.capacity);
    if (capacity != null) {
        rows.push({label: 'Capacity', value: `${capacity} people`});
    }
    const area = readNumber(fields.value.grossFloorArea);
    if (area != null) rows.push({label: 'Area', value: `${formatCount(area)} m²`});
    const access = readString(fields.value.accessProcedure);
    if (access) rows.push({label: 'Access', value: access});
    return rows;
});

const setpointStats = computed<OverviewStat[]>(() => {
    const raw = fields.value.environmentalSetpoint;
    if (!raw || typeof raw !== 'object') return [];
    const sp = raw as Record<string, unknown>;
    const rows: OverviewStat[] = [];
    const tMin = readNumber(sp.tempMinC);
    const tMax = readNumber(sp.tempMaxC);
    if (tMin !== null || tMax !== null) {
        rows.push({label: 'Temperature', value: formatRange({min: tMin, max: tMax, unit: '°C'})});
    }
    const hMin = readNumber(sp.humidityMinPct);
    const hMax = readNumber(sp.humidityMaxPct);
    if (hMin !== null || hMax !== null) {
        rows.push({label: 'Humidity', value: formatRange({min: hMin, max: hMax, unit: '%'})});
    }
    return rows;
});

const complianceTags = computed<readonly string[]>(() => {
    const raw = fields.value.complianceTags;
    if (!Array.isArray(raw)) return [];
    return raw.filter((t): t is string => typeof t === 'string' && t.length > 0);
});

const childrenHint = computed(() => {
    const n = children.value.length;
    return n === 0 ? undefined : `${n} child${n === 1 ? '' : 'ren'}`;
});

</script>

<style scoped>
.ov-indoor {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-5);
}
</style>
