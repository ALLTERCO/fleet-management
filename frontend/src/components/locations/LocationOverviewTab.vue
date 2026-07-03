<template>
    <div class="lov">
        <component
            :is="tierComponent"
            v-if="props.location"
            :location="props.location"
            @navigate="$emit('navigate', $event)"
        />
        <p v-else class="lov__empty">Loading location…</p>
    </div>
</template>

<script setup lang="ts">
import {type Component, computed} from 'vue';
import OverviewBuilding from '@/components/locations/overview/OverviewBuilding.vue';
import OverviewGeographic from '@/components/locations/overview/OverviewGeographic.vue';
import OverviewIndoor from '@/components/locations/overview/OverviewIndoor.vue';
import OverviewSite from '@/components/locations/overview/OverviewSite.vue';
import {type LocationTier, tierForKind} from '@/helpers/location-tier';
import type {ApiLocation} from '@/stores/locations';

const props = defineProps<{location: ApiLocation | null}>();

defineEmits<{navigate: [id: number]}>();

const TIER_COMPONENT: Record<LocationTier, Component> = {
    geographic: OverviewGeographic,
    site: OverviewSite,
    building: OverviewBuilding,
    indoor: OverviewIndoor
};

const tierComponent = computed<Component | null>(() => {
    const kind = props.location?.kind;
    if (!kind) return null;
    return TIER_COMPONENT[tierForKind(kind)];
});
</script>

<style scoped>
.lov {
    height: 100%;
    min-height: 0;
    overflow-y: auto;
}

.lov__empty {
    padding: var(--space-12) var(--space-5);
    text-align: center;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
</style>
