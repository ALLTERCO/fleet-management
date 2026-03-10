<template>
    <BasicBlock darker>
        <div class="space-y-3">
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                    <HealthDot :status="panelStatus" />
                    <span class="bottleneck__heading font-semibold text-sm">Bottleneck Analysis</span>
                    <span v-if="bottlenecks.length > 0" class="text-xs font-mono px-1.5 py-0.5 rounded"
                        :class="worstSeverity === 'critical' ? 'severity-badge--critical' : 'severity-badge--warning'"
                    >
                        {{ bottlenecks.length }} issue{{ bottlenecks.length !== 1 ? 's' : '' }}
                    </span>
                </div>
            </div>

            <!-- No bottlenecks -->
            <div v-if="bottlenecks.length === 0" class="flex items-center gap-2 py-2">
                <i class="fa-solid fa-circle-check bottleneck__ok-icon" />
                <span class="bottleneck__ok-text text-sm">No bottlenecks detected — all systems within normal thresholds.</span>
            </div>

            <!-- Bottleneck cards -->
            <div v-else class="space-y-2">
                <div
                    v-for="b in bottlenecks"
                    :key="b.id"
                    class="rounded-lg border p-3 transition-colors cursor-pointer"
                    :class="bottleneckCardClass(b.severity)"
                    @click="toggle(b.id)"
                >
                    <div class="flex items-start justify-between gap-2">
                        <div class="flex items-start gap-2 min-w-0">
                            <span class="text-xs font-mono px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5"
                                :class="severityBadgeClass(b.severity)"
                            >
                                {{ b.severity.toUpperCase() }}
                            </span>
                            <div class="min-w-0">
                                <div class="flex items-center gap-2">
                                    <span class="bottleneck__name text-sm font-semibold">{{ b.name }}</span>
                                    <span class="bottleneck__category text-xs font-mono px-1.5 py-0.5 rounded">
                                        {{ b.category }}
                                    </span>
                                    <span v-if="b.trendingUp" class="bottleneck__trending text-xs" title="Trending up">
                                        <i class="fa-solid fa-arrow-trend-up" />
                                    </span>
                                </div>
                                <p class="bottleneck__description text-xs mt-1">{{ b.description }}</p>
                            </div>
                        </div>
                        <i class="fa-solid fa-chevron-down bottleneck__chevron text-xs flex-shrink-0 mt-1 transition-transform"
                            :class="expanded.has(b.id) ? 'rotate-180' : ''"
                        />
                    </div>

                    <!-- Expanded detail -->
                    <div v-if="expanded.has(b.id)" class="bottleneck__detail mt-3 pt-3 space-y-2">
                        <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
                            <div v-for="m in b.affectedMetrics" :key="m.label" class="bottleneck__metric p-2 rounded text-xs font-mono">
                                <span class="bottleneck__metric-label">{{ m.label }}:</span>
                                <span class="bottleneck__metric-value ml-1">{{ m.value }}{{ m.unit ? m.unit : '' }}</span>
                            </div>
                        </div>
                        <div class="bottleneck__tip flex items-start gap-2 p-2 border rounded">
                            <i class="fa-solid fa-lightbulb bottleneck__tip-icon text-xs mt-0.5 flex-shrink-0" />
                            <span class="bottleneck__tip-text text-xs">{{ b.recommendation }}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </BasicBlock>
</template>

<script setup lang="ts">
import {computed, reactive} from 'vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import HealthDot from '@/components/monitoring/HealthDot.vue';
import {
    type BottleneckSeverity,
    useBottleneckAnalysis
} from '@/composables/useBottleneckAnalysis';
import type {FlowStatus} from '@/stores/monitoring';

const {bottlenecks, worstSeverity} = useBottleneckAnalysis();

const expanded = reactive(new Set<string>());

function toggle(id: string) {
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
}

const panelStatus = computed<FlowStatus>(() => {
    if (!worstSeverity.value) return 'healthy';
    if (worstSeverity.value === 'critical') return 'critical';
    if (worstSeverity.value === 'warning') return 'warning';
    return 'healthy';
});

function bottleneckCardClass(severity: BottleneckSeverity): string {
    switch (severity) {
        case 'critical':
            return 'bottleneck-card--critical';
        case 'warning':
            return 'bottleneck-card--warning';
        default:
            return 'bottleneck-card--default';
    }
}

function severityBadgeClass(severity: BottleneckSeverity): string {
    switch (severity) {
        case 'critical':
            return 'severity-badge--critical';
        case 'warning':
            return 'severity-badge--warning';
        default:
            return 'severity-badge--info';
    }
}
</script>

<style scoped>
/* --- Panel header --- */
.bottleneck__heading { color: var(--color-text-secondary); }
.bottleneck__ok-icon { color: var(--color-success); }
.bottleneck__ok-text { color: var(--color-text-tertiary); }

/* --- Severity badges --- */
.severity-badge--critical {
    background-color: color-mix(in srgb, var(--color-danger) 40%, transparent);
    color: var(--color-danger-text);
}
.severity-badge--warning {
    background-color: color-mix(in srgb, var(--color-warning) 40%, transparent);
    color: var(--color-warning-text);
}
.severity-badge--info {
    background-color: color-mix(in srgb, var(--color-primary) 40%, transparent);
    color: var(--color-primary-text);
}

/* --- Bottleneck card variants --- */
.bottleneck-card--critical {
    background-color: color-mix(in srgb, var(--color-danger) 10%, transparent);
    border-color: color-mix(in srgb, var(--color-danger) 30%, transparent);
}
.bottleneck-card--critical:hover {
    border-color: color-mix(in srgb, var(--color-danger) 45%, transparent);
}
.bottleneck-card--warning {
    background-color: color-mix(in srgb, var(--color-warning) 8%, transparent);
    border-color: color-mix(in srgb, var(--color-warning) 22%, transparent);
}
.bottleneck-card--warning:hover {
    border-color: color-mix(in srgb, var(--color-warning) 38%, transparent);
}
.bottleneck-card--default {
    background-color: color-mix(in srgb, var(--color-surface-2) 50%, transparent);
    border-color: color-mix(in srgb, var(--color-border-default) 30%, transparent);
}
.bottleneck-card--default:hover {
    border-color: color-mix(in srgb, var(--color-border-strong) 50%, transparent);
}

/* --- Card content --- */
.bottleneck__name { color: var(--color-text-primary); }
.bottleneck__category {
    color: var(--color-text-disabled);
    background-color: var(--color-surface-2);
}
.bottleneck__trending { color: var(--color-danger-text); }
.bottleneck__description { color: var(--color-text-tertiary); }
.bottleneck__chevron { color: var(--color-border-strong); }

/* --- Expanded detail --- */
.bottleneck__detail { border-top: 1px solid color-mix(in srgb, var(--color-border-default) 50%, transparent); }
.bottleneck__metric {
    background-color: color-mix(in srgb, var(--color-surface-1) 80%, transparent);
}
.bottleneck__metric-label { color: var(--color-text-disabled); }
.bottleneck__metric-value { color: var(--color-text-primary); }

/* --- Recommendation tip --- */
.bottleneck__tip {
    background-color: color-mix(in srgb, var(--color-primary) 12%, transparent);
    border-color: color-mix(in srgb, var(--color-primary) 20%, transparent);
}
.bottleneck__tip-icon { color: var(--color-primary-text); }
.bottleneck__tip-text { color: var(--color-primary-text); }
</style>
