<template>
    <div class="space-y-4 p-2">
        <h2 class="sr-only">Services</h2>
        <!-- Tier gate -->
        <BasicBlock v-if="store.obsLevel < 1" darker class="text-center py-8">
            <p class="text-[var(--color-text-tertiary)]">Enable monitoring to see service metrics.</p>
            <button
                class="mt-3 px-4 py-2 text-sm font-mono rounded bg-[var(--color-primary)] text-[var(--color-text-primary)] hover:bg-[var(--color-primary-hover)] transition-colors"
                @click="store.changeLevel(1)"
            >Enable Light Monitoring</button>
        </BasicBlock>

        <template v-if="store.obsLevel >= 1 && store.latest">
            <!-- Energy Meter Sync -->
            <BasicBlock darker>
                <div class="space-y-3">
                    <div class="flex items-center gap-2">
                        <HealthDot :status="store.emSyncStatus" />
                        <h3 class="font-semibold text-sm text-[var(--color-text-secondary)]">Energy Meter Sync</h3>
                    </div>
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div class="p-3 bg-[var(--color-surface-1)] rounded-lg">
                            <div class="text-xs text-[var(--color-text-disabled)] mb-1">Queue Size</div>
                            <span class="text-sm font-mono font-semibold" :class="store.latest.emQueueSize > 200 ? 'text-[var(--color-danger-text)]' : store.latest.emQueueSize > 50 ? 'text-[var(--color-warning-text)]' : 'text-[var(--color-text-secondary)]'">
                                {{ store.latest.emQueueSize }}
                            </span>
                        </div>
                        <div class="p-3 bg-[var(--color-surface-1)] rounded-lg">
                            <div class="text-xs text-[var(--color-text-disabled)] mb-1">Active Syncs</div>
                            <div class="flex items-end justify-between gap-2">
                                <span class="text-sm font-mono font-semibold" :class="store.latest.emActiveSyncs >= 40 ? 'text-[var(--color-danger-text)]' : store.latest.emActiveSyncs > 30 ? 'text-[var(--color-warning-text)]' : 'text-[var(--color-text-secondary)]'">
                                    {{ store.latest.emActiveSyncs }} / 40
                                </span>
                                <SparkLine :data="cachedHistory.emActiveSyncs" color="#fb923c" :width="60" :height="20" />
                            </div>
                        </div>
                    </div>
                    <!-- Concurrency bar -->
                    <div class="w-full h-3 bg-[var(--color-surface-1)] rounded-full overflow-hidden flex">
                        <div
                            class="h-full transition-all"
                            :class="store.latest.emActiveSyncs >= 40 ? 'bg-[var(--color-danger)]' : store.latest.emActiveSyncs > 30 ? 'bg-[var(--color-warning)]' : 'bg-[var(--color-orange)]'"
                            :style="{width: emConcurrencyPercent + '%'}"
                            :title="`Active: ${store.latest.emActiveSyncs}/40`"
                        />
                    </div>
                    <div class="flex gap-4 text-xs font-mono text-[var(--color-text-disabled)]">
                        <span><span class="inline-block w-2 h-2 rounded-sm bg-[var(--color-orange)] mr-1" />Active Syncs</span>
                        <span class="text-[var(--color-text-disabled)]">{{ emConcurrencyPercent }}% capacity</span>
                    </div>
                    <!-- EM Counters (Tier 2+) -->
                    <div v-if="store.obsLevel >= 2" class="grid grid-cols-2 md:grid-cols-3 gap-2 pt-1">
                        <div class="p-2 bg-[var(--color-surface-1)] rounded text-xs font-mono">
                            <span class="text-[var(--color-text-disabled)]">completed:</span>
                            <span class="text-[var(--color-text-secondary)] ml-1">{{ store.latestMetrics?.counters?.em_syncs_completed ?? 0 }}</span>
                            <span v-if="store.counterRates.em_syncs_completed" class="ml-1 text-[var(--color-success-text)]">
                                (+{{ store.counterRates.em_syncs_completed }}/min)
                            </span>
                        </div>
                        <div class="p-2 bg-[var(--color-surface-1)] rounded text-xs font-mono">
                            <span class="text-[var(--color-text-disabled)]">failed:</span>
                            <span class="text-[var(--color-text-secondary)] ml-1">{{ store.latestMetrics?.counters?.em_syncs_failed ?? 0 }}</span>
                            <span v-if="store.counterRates.em_syncs_failed" class="ml-1 text-[var(--color-danger-text)]">
                                (+{{ store.counterRates.em_syncs_failed }}/min)
                            </span>
                        </div>
                    </div>
                </div>
            </BasicBlock>

            <!-- Waiting Room -->
            <BasicBlock darker>
                <div class="space-y-3">
                    <div class="flex items-center gap-2">
                        <HealthDot :status="store.waitingRoomStatus" />
                        <h3 class="font-semibold text-sm text-[var(--color-text-secondary)]">Waiting Room</h3>
                    </div>
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div class="p-3 bg-[var(--color-surface-1)] rounded-lg">
                            <div class="text-xs text-[var(--color-text-disabled)] mb-1">Pending Devices</div>
                            <div class="flex items-end justify-between gap-2">
                                <span class="text-sm font-mono font-semibold" :class="store.latest.waitingRoomPending > 100 ? 'text-[var(--color-danger-text)]' : store.latest.waitingRoomPending > 20 ? 'text-[var(--color-warning-text)]' : 'text-[var(--color-text-secondary)]'">
                                    {{ store.latest.waitingRoomPending }}
                                </span>
                                <SparkLine :data="cachedHistory.waitingRoomPending" color="#f472b6" :width="60" :height="20" />
                            </div>
                        </div>
                    </div>
                    <!-- WR Counters (Tier 2+) -->
                    <div v-if="store.obsLevel >= 2" class="grid grid-cols-2 md:grid-cols-3 gap-2 pt-1">
                        <div class="p-2 bg-[var(--color-surface-1)] rounded text-xs font-mono">
                            <span class="text-[var(--color-text-disabled)]">approved:</span>
                            <span class="text-[var(--color-text-secondary)] ml-1">{{ store.latestMetrics?.counters?.waiting_room_approved ?? 0 }}</span>
                            <span v-if="store.counterRates.waiting_room_approved" class="ml-1 text-[var(--color-success-text)]">
                                (+{{ store.counterRates.waiting_room_approved }}/min)
                            </span>
                        </div>
                        <div class="p-2 bg-[var(--color-surface-1)] rounded text-xs font-mono">
                            <span class="text-[var(--color-text-disabled)]">denied:</span>
                            <span class="text-[var(--color-text-secondary)] ml-1">{{ store.latestMetrics?.counters?.waiting_room_denied ?? 0 }}</span>
                            <span v-if="store.counterRates.waiting_room_denied" class="ml-1 text-[var(--color-danger-text)]">
                                (+{{ store.counterRates.waiting_room_denied }}/min)
                            </span>
                        </div>
                    </div>
                </div>
            </BasicBlock>

            <!-- Discovery & Firmware -->
            <BasicBlock darker>
                <div class="space-y-3">
                    <h3 class="font-semibold text-sm text-[var(--color-text-secondary)]">Discovery & Firmware</h3>
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div class="p-3 bg-[var(--color-surface-1)] rounded-lg">
                            <div class="text-xs text-[var(--color-text-disabled)] mb-1">mDNS Scanner</div>
                            <span class="text-sm font-mono font-semibold" :class="store.latest.mdnsRunning ? 'text-[var(--color-success-text)]' : 'text-[var(--color-text-disabled)]'">
                                {{ store.latest.mdnsRunning ? 'Running' : 'Stopped' }}
                            </span>
                        </div>
                        <div class="p-3 bg-[var(--color-surface-1)] rounded-lg">
                            <div class="text-xs text-[var(--color-text-disabled)] mb-1">Firmware Scheduler</div>
                            <span class="text-sm font-mono font-semibold" :class="store.latest.firmwareRunning ? 'text-[var(--color-success-text)]' : 'text-[var(--color-text-disabled)]'">
                                {{ store.latest.firmwareRunning ? 'Running' : 'Stopped' }}
                            </span>
                        </div>
                    </div>
                    <!-- Discovery counter (Tier 2+) -->
                    <div v-if="store.obsLevel >= 2" class="grid grid-cols-2 md:grid-cols-3 gap-2 pt-1">
                        <div class="p-2 bg-[var(--color-surface-1)] rounded text-xs font-mono">
                            <span class="text-[var(--color-text-disabled)]">mdns_discovered:</span>
                            <span class="text-[var(--color-text-secondary)] ml-1">{{ store.latestMetrics?.counters?.mdns_discovered ?? 0 }}</span>
                            <span v-if="store.counterRates.mdns_discovered" class="ml-1 text-[var(--color-primary-text)]">
                                (+{{ store.counterRates.mdns_discovered }}/min)
                            </span>
                        </div>
                    </div>
                </div>
            </BasicBlock>

            <!-- Registry Cache -->
            <BasicBlock darker>
                <div class="space-y-3">
                    <h3 class="font-semibold text-sm text-[var(--color-text-secondary)]">Registry Cache</h3>
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div class="p-3 bg-[var(--color-surface-1)] rounded-lg">
                            <div class="text-xs text-[var(--color-text-disabled)] mb-1">File Cache</div>
                            <span class="text-sm font-mono font-semibold text-[var(--color-text-secondary)]">
                                {{ store.latestMetrics?.modules?.registry?.fileCacheSize ?? 0 }}
                            </span>
                        </div>
                        <div class="p-3 bg-[var(--color-surface-1)] rounded-lg">
                            <div class="text-xs text-[var(--color-text-disabled)] mb-1">DB Result Cache</div>
                            <span class="text-sm font-mono font-semibold text-[var(--color-text-secondary)]">
                                {{ store.latestMetrics?.modules?.registry?.dbCacheSize ?? 0 }}
                            </span>
                        </div>
                        <div class="p-3 bg-[var(--color-surface-1)] rounded-lg">
                            <div class="text-xs text-[var(--color-text-disabled)] mb-1">Combined</div>
                            <div class="flex items-end justify-between gap-2">
                                <span class="text-sm font-mono font-semibold text-[var(--color-text-secondary)]">
                                    {{ store.latest.registryCacheSize }}
                                </span>
                                <SparkLine :data="cachedHistory.registryCacheSize" color="#fbbf24" :width="60" :height="20" />
                            </div>
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
    emActiveSyncs: store.historyField('emActiveSyncs'),
    waitingRoomPending: store.historyField('waitingRoomPending'),
    registryCacheSize: store.historyField('registryCacheSize')
}));

const emConcurrencyPercent = computed(() => {
    if (!store.latest) return 0;
    return Math.round((store.latest.emActiveSyncs / 40) * 100);
});
</script>
