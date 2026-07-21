<template>
    <div
        class="hs"
        role="region"
        aria-label="System Health"
        :data-overall="overall"
        :data-obs-level="obsLevel"
    >
        <div class="hs__left">
            <HealthDot :status="overall" />
            <div class="hs__overall-text">
                <h2 class="hs__overall-label">{{ OVERALL_LABELS[overall] }}</h2>
                <span v-if="uptimeText" class="hs__uptime">Uptime {{ uptimeText }}</span>
            </div>
        </div>

        <ul
            v-if="hasSnapshot"
            class="hs__buckets"
            aria-label="Modules by status"
        >
            <li
                v-for="bucket in buckets"
                :key="bucket.status"
                class="hs__bucket"
                :class="`hs__bucket--${bucket.status}`"
                :data-status="bucket.status"
            >
                <span class="hs__bucket-count">{{ bucket.count }}</span>
                <span class="hs__bucket-label">{{ bucket.label }}</span>
            </li>
        </ul>
        <span v-else class="hs__buckets-placeholder">Awaiting topology…</span>

        <div class="hs__right">
            <span
                class="hs__obs-pill"
                :class="`hs__obs-pill--${obsLevelKey}`"
                :data-obs-level="obsLevel"
            >
                {{ OBS_LEVEL_LABELS[obsLevel] }}
            </span>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import HealthDot from '@/components/monitoring/HealthDot.vue';
import {formatDuration} from '@/helpers/format';
import {countByStatus} from '@/helpers/topologyStatusCounts';
import {type FlowStatus, useMonitoringStore} from '@/stores/monitoring';
import {useTopologyStore} from '@/stores/topology';
import {OBS_LEVEL_LABELS} from '@/tools/observability';
import type {ModuleStatus} from '@/types/topology';

interface BucketSpec {
    status: ModuleStatus;
    label: string;
}

const OVERALL_LABELS: Record<FlowStatus, string> = {
    healthy: 'All systems nominal',
    warning: 'Degraded',
    critical: 'Critical',
    unknown: 'No signal'
};

const BUCKET_ORDER: ReadonlyArray<BucketSpec> = [
    {status: 'critical', label: 'critical'},
    {status: 'warning', label: 'warning'},
    {status: 'healthy', label: 'healthy'},
    {status: 'unknown', label: 'unknown'}
];

const monitoring = useMonitoringStore();
const topology = useTopologyStore();

const overall = computed<FlowStatus>(() => monitoring.overallStatus);
const obsLevel = computed(() => monitoring.obsLevel);
const obsLevelKey = computed(() => {
    switch (monitoring.obsLevel) {
        case 0: return 'off';
        case 1: return 'light';
        case 2: return 'medium';
        case 3: return 'heavy';
        default: return 'off';
    }
});

const hasSnapshot = computed(() => topology.current !== null);

const uptimeText = computed(() => {
    const s = monitoring.latestMetrics?.uptimeS;
    return typeof s === 'number' ? formatDuration(s) : null;
});

const buckets = computed(() => {
    const counts = countByStatus(topology.current?.nodes ?? []);
    return BUCKET_ORDER.map((b) => ({...b, count: counts[b.status]}));
});
</script>

<style scoped>
.hs {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: var(--gap-lg);
    padding: var(--gap-sm) var(--gap-md);
    background: var(--color-surface-1);
    border-bottom: 1px solid var(--color-border-subtle);
}

.hs__left {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    min-width: 0;
}

.hs__overall-text {
    display: grid;
    gap: var(--space-0-5);
    min-width: 0;
}

.hs__overall-label {
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    line-height: var(--leading-tight);
}

.hs__uptime {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    font-family: var(--font-mono);
}

.hs__buckets {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-xs);
    flex: 1;
    justify-content: center;
}

.hs__bucket {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-1-5);
    padding: 4px 10px;
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-subtle);
    font-size: var(--type-caption);
}

.hs__bucket-count {
    font-family: var(--font-mono);
    font-weight: var(--font-semibold);
    font-size: var(--type-body);
    color: var(--color-text-primary);
}

.hs__bucket-label {
    color: var(--color-text-tertiary);
    text-transform: lowercase;
    letter-spacing: var(--tracking-wide);
}

.hs__bucket--critical {
    border-color: color-mix(in srgb, var(--color-danger) 55%, transparent);
    background: color-mix(in srgb, var(--color-danger) 10%, var(--color-surface-2));
}
.hs__bucket--critical .hs__bucket-count { color: var(--color-danger-text); }

.hs__bucket--warning {
    border-color: color-mix(in srgb, var(--color-warning) 55%, transparent);
    background: color-mix(in srgb, var(--color-warning) 10%, var(--color-surface-2));
}
.hs__bucket--warning .hs__bucket-count { color: var(--color-warning-text); }

.hs__bucket--healthy {
    border-color: color-mix(in srgb, var(--color-success) 50%, transparent);
}
.hs__bucket--healthy .hs__bucket-count { color: var(--color-success-text); }

.hs__bucket--unknown {
    opacity: 0.7;
}

.hs__buckets-placeholder {
    flex: 1;
    text-align: center;
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    font-style: italic;
}

.hs__right {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    margin-left: auto;
}

.hs__obs-pill {
    font-size: var(--type-caption);
    font-family: var(--font-mono);
    padding: 3px 8px;
    border-radius: var(--radius-sm);
    background: var(--color-surface-3);
    color: var(--color-text-secondary);
}
.hs__obs-pill--off { color: var(--color-text-tertiary); }
.hs__obs-pill--light { color: var(--color-primary-text); }
.hs__obs-pill--medium { color: var(--color-accent-text); }
.hs__obs-pill--heavy { color: var(--color-warning-text); }

@media (max-width: 720px) {
    .hs {
        flex-wrap: wrap;
        gap: var(--gap-sm);
    }
    .hs__buckets {
        order: 3;
        flex-basis: 100%;
        justify-content: flex-start;
    }
    .hs__right {
        margin-left: 0;
    }
}
</style>
