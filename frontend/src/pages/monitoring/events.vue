<template>
    <div class="space-y-4 p-2">
        <h2 class="sr-only">Events & Plugins</h2>
        <!-- Tier gate -->
        <BasicBlock v-if="store.obsLevel < 1" darker class="text-center py-8">
            <p class="text-[var(--color-text-tertiary)]">Enable monitoring to see event & plugin metrics.</p>
            <button
                class="mt-3 px-4 py-2 text-sm font-mono rounded bg-[var(--color-primary)] text-[var(--color-text-primary)] hover:bg-[var(--color-primary-hover)] transition-colors"
                @click="store.changeLevel(1)"
            >Enable Light Monitoring</button>
        </BasicBlock>

        <template v-if="store.obsLevel >= 1 && store.latest">
            <!-- Event Distributor -->
            <BasicBlock darker>
                <div class="space-y-3">
                    <div class="flex items-center gap-2">
                        <HealthDot :status="store.eventsStatus" />
                        <h3 class="font-semibold text-sm text-[var(--color-text-secondary)]">Event Distributor</h3>
                    </div>
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div class="p-3 bg-[var(--color-surface-1)] rounded-lg">
                            <div class="text-xs text-[var(--color-text-disabled)] mb-1">Listeners</div>
                            <div class="flex items-end justify-between gap-2">
                                <span class="text-sm font-mono font-semibold" :class="store.latest.eventsListeners > 500 ? 'text-[var(--color-warning-text)]' : 'text-[var(--color-text-secondary)]'">
                                    {{ store.latest.eventsListeners }}
                                </span>
                                <SparkLine :data="cachedHistory.eventsListeners" color="#c084fc" :width="60" :height="20" />
                            </div>
                        </div>
                        <div class="p-3 bg-[var(--color-surface-1)] rounded-lg">
                            <div class="text-xs text-[var(--color-text-disabled)] mb-1">Event Types</div>
                            <span class="text-sm font-mono font-semibold text-[var(--color-text-secondary)]">
                                {{ store.latest.eventsTypes }}
                            </span>
                        </div>
                        <div class="p-3 bg-[var(--color-surface-1)] rounded-lg">
                            <div class="text-xs text-[var(--color-text-disabled)] mb-1">Broadcast Rate</div>
                            <div class="flex items-end justify-between gap-2">
                                <span class="text-sm font-mono font-semibold text-[var(--color-text-secondary)]">
                                    {{ store.latest.eventsBroadcastRate }}/min
                                </span>
                                <SparkLine :data="cachedHistory.eventsBroadcastRate" color="#a78bfa" :width="60" :height="20" />
                            </div>
                        </div>
                        <div class="p-3 bg-[var(--color-surface-1)] rounded-lg">
                            <div class="text-xs text-[var(--color-text-disabled)] mb-1">Group Cache</div>
                            <span class="text-sm font-mono font-semibold text-[var(--color-text-secondary)]">
                                {{ store.latestMetrics?.modules?.events?.groupCacheSize ?? '—' }}
                            </span>
                        </div>
                    </div>
                </div>
            </BasicBlock>

            <!-- Plugin System -->
            <BasicBlock darker>
                <div class="space-y-3">
                    <h3 class="font-semibold text-sm text-[var(--color-text-secondary)]">Plugin System</h3>
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div class="p-3 bg-[var(--color-surface-1)] rounded-lg">
                            <div class="text-xs text-[var(--color-text-disabled)] mb-1">Loaded Plugins</div>
                            <span class="text-sm font-mono font-semibold text-[var(--color-text-secondary)]">
                                {{ store.latest.pluginsLoaded }}
                            </span>
                        </div>
                        <div class="p-3 bg-[var(--color-surface-1)] rounded-lg">
                            <div class="text-xs text-[var(--color-text-disabled)] mb-1">Active Workers</div>
                            <span class="text-sm font-mono font-semibold text-[var(--color-text-secondary)]">
                                {{ store.latest.pluginWorkers }}
                            </span>
                        </div>
                        <div class="p-3 bg-[var(--color-surface-1)] rounded-lg">
                            <div class="text-xs text-[var(--color-text-disabled)] mb-1">Commander Components</div>
                            <span class="text-sm font-mono font-semibold text-[var(--color-text-secondary)]">
                                {{ store.latest.commanderComponents }}
                            </span>
                        </div>
                    </div>
                </div>
            </BasicBlock>

            <!-- WS Message Breakdown (Tier 2+) -->
            <BasicBlock v-if="store.obsLevel >= 2 && hasWsBreakdown" darker>
                <div class="space-y-3">
                    <h3 class="font-semibold text-sm text-[var(--color-text-secondary)]">WS Message Types</h3>
                    <div class="overflow-auto max-h-64">
                        <table class="w-full text-xs font-mono">
                            <thead>
                                <tr class="text-[var(--color-text-disabled)] border-b border-[var(--color-border-default)]">
                                    <th class="text-left py-1.5 px-2">Method</th>
                                    <th class="text-right py-1.5 px-2">Count</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="[method, count] in sortedWsBreakdown" :key="method"
                                    class="border-b border-[var(--color-border-default)]">
                                    <td class="py-1.5 px-2 text-[var(--color-text-secondary)]">{{ method }}</td>
                                    <td class="py-1.5 px-2 text-right text-[var(--color-text-tertiary)]">{{ count }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </BasicBlock>

            <!-- Event Counters (Tier 2+) -->
            <BasicBlock v-if="store.obsLevel >= 2 && hasEventCounters" darker>
                <div class="space-y-3">
                    <h3 class="font-semibold text-sm text-[var(--color-text-secondary)]">Event Counters</h3>
                    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                        <div
                            v-for="[key, rate] in eventCounters"
                            :key="key"
                            class="p-2 bg-[var(--color-surface-1)] rounded text-xs font-mono"
                        >
                            <span class="text-[var(--color-text-disabled)]">{{ key }}:</span>
                            <span class="text-[var(--color-text-secondary)] ml-1">{{ store.latestMetrics?.counters?.[key] ?? 0 }}</span>
                            <span v-if="rate" class="ml-1" :class="rate > 0 ? 'text-[var(--color-accent-text)]' : 'text-[var(--color-text-disabled)]'">
                                ({{ rate > 0 ? '+' : '' }}{{ rate }}/min)
                            </span>
                        </div>
                    </div>
                </div>
            </BasicBlock>
        </template>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import HealthDot from '@/components/monitoring/HealthDot.vue';
import SparkLine from '@/components/monitoring/SparkLine.vue';
import {useMonitoringStore} from '@/stores/monitoring';

const store = useMonitoringStore();

const cachedHistory = computed(() => ({
    eventsListeners: store.historyField('eventsListeners'),
    eventsBroadcastRate: store.historyField('eventsBroadcastRate')
}));

const wsBreakdown = computed(
    () => store.latestMetrics?.wsMessageBreakdown ?? {}
);
const hasWsBreakdown = computed(
    () => Object.keys(wsBreakdown.value).length > 0
);
const sortedWsBreakdown = computed(() =>
    Object.entries(wsBreakdown.value).sort(
        ([, a], [, b]) => (b as number) - (a as number)
    )
);

const EVENT_COUNTER_PREFIXES = ['events_', 'plugin_'];

const eventCounters = computed(() => {
    return Object.entries(store.counterRates)
        .filter(([key]) =>
            EVENT_COUNTER_PREFIXES.some((p) => key.startsWith(p))
        )
        .sort(([a], [b]) => a.localeCompare(b));
});

const hasEventCounters = computed(() => eventCounters.value.length > 0);
</script>
