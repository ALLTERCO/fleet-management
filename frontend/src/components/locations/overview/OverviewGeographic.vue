<template>
    <div class="ov-geo">
        <OverviewSection
            v-if="identityStats.length > 0"
            title="Identity"
            icon="fa-id-card"
        >
            <OverviewStatGrid :stats="identityStats" />
        </OverviewSection>

        <OverviewSection
            :title="childrenSectionTitle"
            icon="fa-sitemap"
            :hint="childrenHint"
        >
            <OverviewChildGrid
                :children="children"
                :empty-hint="emptyChildHint"
                @open="$emit('navigate', $event)"
            />
        </OverviewSection>
    </div>
</template>

<script setup lang="ts">
import {computed, toRef} from 'vue';
import OverviewChildGrid from '@/components/locations/overview/OverviewChildGrid.vue';
import OverviewSection from '@/components/locations/overview/OverviewSection.vue';
import OverviewStatGrid, {
    type OverviewStat
} from '@/components/locations/overview/OverviewStatGrid.vue';
import {useChildOverview} from '@/composables/useChildOverview';
import type {ApiLocation} from '@/stores/locations';

const props = defineProps<{location: ApiLocation}>();

defineEmits<{navigate: [id: number]}>();

const children = useChildOverview(toRef(() => props.location.id));

const identityStats = computed<OverviewStat[]>(() => {
    const loc = props.location;
    const fields = (loc.kindFields ?? {}) as Record<string, unknown>;
    const rows: OverviewStat[] = [];
    const cc = readString(fields.countryCode) ?? loc.effective?.countryCode;
    if (cc) rows.push({label: 'Country code', value: cc});
    const tz = readString(fields.timezone) ?? loc.effective?.timezone;
    if (tz) rows.push({label: 'Time zone', value: tz});
    const currency = readString(fields.currency) ?? loc.effective?.currency;
    if (currency) rows.push({label: 'Currency', value: currency});
    const reg = readString(fields.regulatoryZone) ?? loc.effective?.regulatoryZone;
    if (reg) rows.push({label: 'Regulatory zone', value: reg});
    const region = readString(fields.regionCode);
    if (region) rows.push({label: 'Region code', value: region});
    return rows;
});

const childrenSectionTitle = computed(() => {
    const k = props.location.kind;
    if (k === 'continent') return 'Countries';
    if (k === 'country' || k === 'region' || k === 'county') return 'Cities & regions';
    if (k === 'city') return 'Sites in this city';
    return 'Children';
});

const childrenHint = computed(() => {
    const n = children.value.length;
    if (n === 0) return undefined;
    return `${n} direct child${n === 1 ? '' : 'ren'}`;
});

const emptyChildHint = computed(() => {
    const k = props.location.kind;
    if (k === 'continent') return 'No countries added under this continent yet.';
    if (k === 'country') return 'Add cities, regions, or sites to populate this country.';
    if (k === 'city') return 'Add sites to populate this city.';
    return 'No children yet.';
});

function readString(raw: unknown): string | null {
    return typeof raw === 'string' && raw.length > 0 ? raw : null;
}
</script>

<style scoped>
.ov-geo {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-5);
}
</style>
