<template>
    <div class="ov-site">
        <OverviewSection title="Identity" icon="fa-id-card">
            <OverviewStatGrid :stats="identityStats" />
        </OverviewSection>

        <OverviewSection v-if="addressLine || coords" title="Address" icon="fa-location-dot">
            <p v-if="addressLine" class="ov-site__address">{{ addressLine }}</p>
            <p v-if="coords" class="ov-site__coords">{{ coords }}</p>
            <AddressGeoBadge
                :location-id="location.id"
                :address="addressObj"
                :geo="geoPoint"
            />
            <p v-if="accessProcedure" class="ov-site__access">
                <i class="fas fa-key" aria-hidden="true" />
                Access: {{ accessProcedure }}
            </p>
        </OverviewSection>

        <OverviewSection
            v-if="primaryContact || emergencyContact"
            title="Contacts"
            icon="fa-address-book"
        >
            <div class="ov-site__contacts">
                <OverviewContactCard v-if="primaryContact" :contact="primaryContact" />
                <OverviewContactCard v-if="emergencyContact" :contact="emergencyContact" />
            </div>
        </OverviewSection>

        <OverviewSection
            v-if="operatingHours"
            title="Operating hours"
            icon="fa-clock"
            :hint="hoursTimezone"
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
            title="Buildings"
            icon="fa-building"
            :hint="childrenHint"
        >
            <OverviewChildGrid
                :children="children"
                empty-hint="No buildings added to this site yet."
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
    formatGeo,
    readContact,
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
    const loc = props.location;
    const rows: OverviewStat[] = [];
    const siteType = readString(fields.value.siteType);
    if (siteType) rows.push({label: 'Site type', value: siteType});
    const tier = readString(fields.value.operationalTier);
    if (tier) rows.push({label: 'Operational tier', value: tier});
    const tz = readString(fields.value.timezone) ?? loc.effective?.timezone;
    if (tz) rows.push({label: 'Time zone', value: tz});
    const cc = loc.effective?.countryCode;
    if (cc) rows.push({label: 'Country', value: cc});
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

const hoursTimezone = computed(() => {
    const tz = readString(operatingHours.value?.timezone);
    return tz ?? undefined;
});

const complianceTags = computed<readonly string[]>(() => {
    const raw = fields.value.complianceTags;
    if (!Array.isArray(raw)) return [];
    return raw.filter((t): t is string => typeof t === 'string' && t.length > 0);
});

const childrenHint = computed(() => {
    const n = children.value.length;
    return n === 0 ? undefined : `${n} building${n === 1 ? '' : 's'}`;
});

</script>

<style scoped>
.ov-site {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-5);
}

.ov-site__address {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-primary);
}

.ov-site__coords {
    margin: var(--space-1) 0 0;
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    font-variant-numeric: tabular-nums;
}

.ov-site__access {
    margin: var(--space-2) 0 0;
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
}

.ov-site__access i {
    color: var(--color-text-tertiary);
}

.ov-site__contacts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: var(--space-3);
}
</style>
