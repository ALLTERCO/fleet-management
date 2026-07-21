<template>
    <div class="h-full flex flex-col monitoring-page">
        <h2 class="sr-only">Monitoring</h2>
        <RouterView v-slot="{Component}">
            <Transition name="tab-fade">
                <component :is="Component" :key="$route.path" />
            </Transition>
        </RouterView>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, onUnmounted, provide} from 'vue';
import {useRoute} from 'vue-router';
import {monitoringTabsForPath} from '@/helpers/monitoringNavigation';
import {useMonitoringStore} from '@/stores/monitoring';

const monitoringStore = useMonitoringStore();
const route = useRoute();

// Each cluster of pages shares one tab row; the sidebar holds the clusters.
provide(
    'monitoringTabs',
    computed(() => monitoringTabsForPath(route.path))
);

onMounted(() => monitoringStore.startPolling());
onUnmounted(() => monitoringStore.stopPolling());
</script>

<style scoped>
.monitoring-page {
    padding: 0;
}
/* Console-panel refinement, scoped to Monitoring only (does not touch the
   app-wide BasicBlock used elsewhere): flatter surface + hairline border +
   consistent radius, matching the Investigate panels. */
.monitoring-page :deep(.basic-block--darker),
.monitoring-page :deep(.basic-block--default),
.monitoring-page :deep(.basic-block--glass) {
    border: 1px solid var(--color-border-subtle);
    box-shadow: none;
    border-radius: var(--radius-lg, 12px);
}
</style>
