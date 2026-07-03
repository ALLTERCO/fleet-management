<template>
    <PageTemplate title="Overview" :tabs="monitoringTabs" fill>
        <MonitoringHealthStrip />

        <ErrorBoundary>
        <!-- DB Writes Disabled warning -->
        <BasicBlock v-if="store.dbWritesDisabled" darker class="border border-[var(--color-danger)] bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)]">
            <div class="flex items-center gap-2 text-[var(--color-danger-text)]">
                <i class="fas fa-database" />
                <span class="text-sm font-semibold">DB Writes Disabled</span>
                <span class="text-xs opacity-75">— Status history and audit logs are not being recorded</span>
            </div>
        </BasicBlock>

        <!-- Loading skeleton while waiting for first metrics -->
        <PageSkeleton v-if="store.obsLevel > 0 && !store.latest" variant="cards" :count="3" />

        <MonitoringRuntimeSummary />

        <!-- Bottleneck Analysis (Tier 1+) -->
        <BottleneckPanel v-if="store.obsLevel > 0 && store.latest" />

        <!-- Recent topology changes strip (Tier 1+) -->
        <RecentChangesStrip v-if="store.obsLevel > 0" />

        <!-- Auto-derived topology diagram (Tier 1+) -->
        <div v-if="store.obsLevel > 0" class="topology-host">
            <TopologyDiagram />
        </div>

        <!-- Monitoring disabled state -->
        <BasicBlock v-if="store.obsLevel === 0" darker class="text-center py-12">
            <div class="space-y-3">
                <i class="fas fa-chart-line text-4xl overview-disabled-icon" />
                <p class="overview-disabled-text">Enable monitoring to see system metrics</p>
                <p class="text-xs overview-disabled-hint">
                    Light mode is safe for production. Medium adds RPC/DB timings.
                </p>
                <button
                    type="button"
                    class="px-4 py-2 text-sm font-mono rounded overview-enable-btn transition-colors"
                    @click="store.changeLevel(1)"
                >
                    Enable Light Monitoring
                </button>
            </div>
        </BasicBlock>

        <!-- DEMOTED — moved to /monitoring/host -->
        </ErrorBoundary>

    </PageTemplate>
</template>

<script setup lang="ts">
import {type ComputedRef, inject} from 'vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import ErrorBoundary from '@/components/core/ErrorBoundary.vue';
import PageSkeleton from '@/components/core/PageSkeleton.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import BottleneckPanel from '@/components/monitoring/BottleneckPanel.vue';
import MonitoringHealthStrip from '@/components/monitoring/MonitoringHealthStrip.vue';
import MonitoringRuntimeSummary from '@/components/monitoring/MonitoringRuntimeSummary.vue';
import RecentChangesStrip from '@/components/monitoring/RecentChangesStrip.vue';
import TopologyDiagram from '@/components/monitoring/topology/TopologyDiagram.vue';
import {useMonitoringStore} from '@/stores/monitoring';
import type {RouteTab} from '@/types/page-template';

const monitoringTabs = inject<ComputedRef<RouteTab[]>>('monitoringTabs');
const store = useMonitoringStore();
</script>

<style scoped>
.overview-disabled-icon { color: var(--color-border-strong); }
.overview-disabled-text { color: var(--color-text-tertiary); }
.overview-disabled-hint { color: var(--color-text-disabled); }

.overview-enable-btn {
    background-color: var(--color-primary-hover);
    color: var(--primitive-blue-100);
}
.overview-enable-btn:hover {
    background-color: var(--color-primary);
}

.topology-host {
    width: 100%;
}
</style>
