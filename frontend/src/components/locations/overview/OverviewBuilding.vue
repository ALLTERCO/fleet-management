<template>
    <div class="ov-bld">
        <OverviewSection title="Structure" icon="fa-building">
            <OverviewStatGrid
                :stats="structureStats"
                empty-hint="Add building type, year built, and floor count on Settings."
            />
        </OverviewSection>

        <OverviewSection v-if="addressLine || coords" title="Address" icon="fa-location-dot">
            <p v-if="addressLine" class="ov-bld__address">{{ addressLine }}</p>
            <p v-if="coords" class="ov-bld__coords">{{ coords }}</p>
            <AddressGeoBadge
                :location-id="location.id"
                :address="addressObj"
                :geo="geoPoint"
            />
            <p v-if="accessProcedure" class="ov-bld__access">
                <i class="fas fa-key" aria-hidden="true" />
                Access: {{ accessProcedure }}
            </p>
        </OverviewSection>

        <OverviewSection
            v-if="primaryContact || emergencyContact"
            title="Contacts"
            icon="fa-address-book"
        >
            <div class="ov-bld__contacts">
                <OverviewContactCard v-if="primaryContact" :contact="primaryContact" />
                <OverviewContactCard v-if="emergencyContact" :contact="emergencyContact" />
            </div>
        </OverviewSection>

        <OverviewSection
            v-if="operatingHours"
            title="Operating hours"
            icon="fa-clock"
        >
            <OverviewHoursWeek :hours="operatingHours" />
        </OverviewSection>

        <OverviewSection
            v-if="complianceTags.length > 0"
            title="Compliance"
            icon="fa-shield-halved"
        >
            <OverviewComplianceChips :tags="complianceTags" />
        </OverviewSection>

        <OverviewSection
            title="Floors"
            icon="fa-layer-group"
            :hint="floorsHint"
        >
            <OverviewChildGrid
                :children="children"
                empty-hint="No floors added to this building yet. Open Plan to add the first floor."
                @open="$emit('navigate', $event)"
            />
        </OverviewSection>
    </div>
</template>

<script setup lang="ts">
import {computed, toRef} from 'vue';
import AddressGeoBadge from '@/components/locations/overview/AddressGeoBadge.vue';
import OverviewChildGrid from '@/components/locations/overview/OverviewChildGrid.vue';
import OverviewComplianceChips from '@/components/locations/overview/OverviewComplianceChips.vue';
import OverviewContactCard from '@/components/locations/overview/OverviewContactCard.vue';
import OverviewHoursWeek from '@/components/locations/overview/OverviewHoursWeek.vue';
import OverviewSection from '@/components/locations/overview/OverviewSection.vue';
import OverviewStatGrid, {
    type OverviewStat
} from '@/components/locations/overview/OverviewStatGrid.vue';
import {useChildOverview} from '@/composables/useChildOverview';
import {
    formatAddress,
    formatCount,
    formatGeo,
    readContact,
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

const structureStats = computed<OverviewStat[]>(() => {
    const rows: OverviewStat[] = [];
    const type = readString(fields.value.buildingType);
    if (type) rows.push({label: 'Type', value: type});
    const year = readInt(fields.value.yearBuilt);
    if (year != null) rows.push({label: 'Year built', value: String(year)});
    const floors = readInt(fields.value.floorCount);
    if (floors != null) rows.push({label: 'Floors', value: String(floors)});
    const area = readNumber(fields.value.grossFloorArea);
    if (area != null) {
        rows.push({label: 'Gross floor area', value: `${formatCount(area)} m²`});
    }
    const cert = readString(fields.value.energyCertification);
    if (cert) rows.push({label: 'Energy cert.', value: cert});
    return rows;
});

const addressLine = computed(() => formatAddress(fields.value.address));
const coords = computed(() => formatGeo(fields.value.geo));

const addressObj = computed(() =>
    fields.value.address && typeof fields.value.address === 'object'
        ? (fields.value.address as Record<string, unknown>)
        : null
);
const geoPoint = computed(() => {
    const g = fields.value.geo as {lat?: unknown; lng?: unknown} | undefined;
    const lat = readNumber(g?.lat);
    const lng = readNumber(g?.lng);
    return lat != null && lng != null ? {lat, lng} : null;
});
const accessProcedure = computed(() => readString(fields.value.accessProcedure));

const primaryContact = computed(() =>
    readContact(fields.value.primaryContact)
);
const emergencyContact = computed(() =>
    readContact(fields.value.emergencyContact)
);

const operatingHours = computed(() => {
    const raw = fields.value.operatingHours;
    if (!raw || typeof raw !== 'object') return null;
    return raw as Record<string, unknown>;
});

const complianceTags = computed<readonly string[]>(() => {
    const raw = fields.value.complianceTags;
    if (!Array.isArray(raw)) return [];
    return raw.filter((t): t is string => typeof t === 'string' && t.length > 0);
});

const floorsHint = computed(() => {
    const n = children.value.length;
    return n === 0 ? undefined : `${n} floor${n === 1 ? '' : 's'}`;
});

</script>

<style scoped>
.ov-bld {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-5);
}

.ov-bld__address {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-primary);
}

.ov-bld__coords {
    margin: var(--space-1) 0 0;
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    font-variant-numeric: tabular-nums;
}

.ov-bld__access {
    margin: var(--space-2) 0 0;
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
}

.ov-bld__access i {
    color: var(--color-text-tertiary);
}

.ov-bld__contacts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: var(--space-3);
}
</style>
