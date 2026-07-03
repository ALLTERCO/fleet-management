<template>
    <div v-if="locationId !== null" class="dash-bc">
        <router-link :to="clearContextTo" class="dash-bc-link">
            <i class="fas fa-layer-group" style="font-size:9px;margin-right:var(--space-1);" />Fleet
        </router-link>
        <template v-for="crumb in breadcrumbs" :key="crumb.id">
            <span class="dash-bc-sep">›</span>
            <span
                class="dash-bc-current"
                :class="{'dash-bc-current--muted': crumb.id !== locationId}"
            >
                {{ crumb.name }}
            </span>
        </template>
    </div>
</template>

<script setup lang="ts">
import type {LocationBreadcrumbEntry} from '@api/location';
import {computed, ref, watch} from 'vue';
import {useRoute} from 'vue-router';
import {useDashboardContext} from '@/composables/useDashboardContext';
import {useLocationsStore} from '@/stores/locations';

const context = useDashboardContext();
const locationsStore = useLocationsStore();
const route = useRoute();

const locationId = computed(() => context.value.locationId);
const breadcrumbs = ref<LocationBreadcrumbEntry[]>([]);

// Same path, location/site query params removed
const clearContextTo = computed(() => {
    const {
        locationId: _removedLocation,
        siteId: _removedSite,
        ...rest
    } = route.query as Record<string, any>;
    return {path: route.path, query: rest};
});

watch(
    locationId,
    async (id) => {
        if (id == null) {
            breadcrumbs.value = [];
            return;
        }
        await locationsStore.fetchLocations();
        const path = await locationsStore.fetchPath(id);
        breadcrumbs.value =
            path.length > 0 ? path : [{id, name: `Location ${id}`, kind: 'site'}];
    },
    {immediate: true}
);
</script>

<style scoped>
.dash-bc {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    padding: var(--space-1-5) var(--space-4) 0;
    font-size: var(--type-body);
    flex-shrink: 0;
}

.dash-bc-link {
    color: var(--color-text-tertiary);
    text-decoration: none;
    transition: color 0.15s;
}

.dash-bc-link:hover {
    color: var(--color-text-secondary);
}

.dash-bc-link:hover, .dash-bc-link:focus-visible {
    text-decoration: underline;
}

.dash-bc-sep {
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}

.dash-bc-current {
    color: var(--color-text-primary);
    font-weight: 500;
}
.dash-bc-current--muted {
    color: var(--color-text-secondary);
    font-weight: 400;
}
</style>
