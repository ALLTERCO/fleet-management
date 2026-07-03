<template>
    <div class="wi" :class="`wi--${widget}`">
        <svg
            class="wi-svg"
            viewBox="0 0 80 56"
            preserveAspectRatio="xMidYMid meet"
            aria-hidden="true"
            focusable="false"
        >
            <!-- ── Chart: ascending line with peak ── -->
            <template v-if="widget === 'chart_widget'">
                <polyline
                    points="6,46 18,38 28,42 40,22 52,30 62,14 74,18"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                />
                <line x1="6" y1="50" x2="74" y2="50" stroke="currentColor" stroke-width="1" opacity="0.3" />
            </template>

            <!-- ── Gauge: 270° arc with needle ── -->
            <template v-else-if="widget === 'gauge_widget'">
                <path
                    d="M 18 42 A 22 22 0 1 1 62 42"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="3"
                    stroke-linecap="round"
                    opacity="0.3"
                />
                <path
                    d="M 18 42 A 22 22 0 0 1 54 18"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="3"
                    stroke-linecap="round"
                />
                <line x1="40" y1="42" x2="52" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                <circle cx="40" cy="42" r="3" fill="currentColor" />
            </template>

            <!-- ── Stats: 3 numbered cells ── -->
            <template v-else-if="widget === 'stats_summary_widget'">
                <rect x="6" y="14" width="20" height="28" rx="2" fill="currentColor" opacity="0.15" />
                <rect x="30" y="14" width="20" height="28" rx="2" fill="currentColor" opacity="0.3" />
                <rect x="54" y="14" width="20" height="28" rx="2" fill="currentColor" opacity="0.15" />
                <line x1="10" y1="22" x2="22" y2="22" stroke="currentColor" stroke-width="2" />
                <line x1="34" y1="22" x2="46" y2="22" stroke="currentColor" stroke-width="2" />
                <line x1="58" y1="22" x2="70" y2="22" stroke="currentColor" stroke-width="2" />
                <line x1="12" y1="34" x2="20" y2="34" stroke="currentColor" stroke-width="1" opacity="0.4" />
                <line x1="36" y1="34" x2="44" y2="34" stroke="currentColor" stroke-width="1" opacity="0.4" />
                <line x1="60" y1="34" x2="68" y2="34" stroke="currentColor" stroke-width="1" opacity="0.4" />
            </template>

            <!-- ── Top consumers: ranked horizontal bars ── -->
            <template v-else-if="widget === 'top_consumers_widget'">
                <rect x="6" y="12" width="60" height="6" rx="1" fill="currentColor" />
                <rect x="6" y="22" width="46" height="6" rx="1" fill="currentColor" opacity="0.7" />
                <rect x="6" y="32" width="32" height="6" rx="1" fill="currentColor" opacity="0.5" />
                <rect x="6" y="42" width="20" height="6" rx="1" fill="currentColor" opacity="0.35" />
            </template>

            <!-- ── State timeline: alternating on/off blocks ── -->
            <template v-else-if="widget === 'state_timeline_widget'">
                <rect x="6" y="22" width="12" height="12" fill="currentColor" />
                <rect x="20" y="22" width="6" height="12" fill="currentColor" opacity="0.3" />
                <rect x="28" y="22" width="18" height="12" fill="currentColor" />
                <rect x="48" y="22" width="10" height="12" fill="currentColor" opacity="0.3" />
                <rect x="60" y="22" width="14" height="12" fill="currentColor" />
                <line x1="6" y1="42" x2="74" y2="42" stroke="currentColor" stroke-width="1" opacity="0.3" />
            </template>

            <!-- ── Activity heatmap: 6x4 grid ── -->
            <template v-else-if="widget === 'activity_heatmap_widget'">
                <template v-for="row in 4" :key="`r${row}`">
                    <template v-for="col in 6" :key="`c${col}`">
                        <rect
                            :x="6 + (col - 1) * 12"
                            :y="10 + (row - 1) * 10"
                            width="10"
                            height="8"
                            rx="1"
                            fill="currentColor"
                            :opacity="heatmapAlpha(row, col)"
                        />
                    </template>
                </template>
            </template>

            <!-- ── Energy flow: source → load arrows ── -->
            <template v-else-if="widget === 'energy_flow_sankey_widget'">
                <rect x="6" y="14" width="16" height="10" rx="1" fill="currentColor" opacity="0.6" />
                <rect x="6" y="32" width="16" height="10" rx="1" fill="currentColor" opacity="0.4" />
                <rect x="58" y="14" width="16" height="10" rx="1" fill="currentColor" opacity="0.8" />
                <rect x="58" y="32" width="16" height="10" rx="1" fill="currentColor" opacity="0.5" />
                <path d="M 22 19 Q 40 19 58 19" stroke="currentColor" stroke-width="3" fill="none" opacity="0.6" />
                <path d="M 22 37 Q 40 26 58 19" stroke="currentColor" stroke-width="2" fill="none" opacity="0.4" />
                <path d="M 22 19 Q 40 26 58 37" stroke="currentColor" stroke-width="2" fill="none" opacity="0.4" />
                <path d="M 22 37 Q 40 37 58 37" stroke="currentColor" stroke-width="3" fill="none" opacity="0.5" />
            </template>

            <!-- ── Fleet KPIs: 4 stat tiles ── -->
            <template v-else-if="widget === 'fleet_kpi_strip_widget'">
                <rect x="6" y="14" width="16" height="28" rx="2" fill="currentColor" opacity="0.18" />
                <rect x="24" y="14" width="16" height="28" rx="2" fill="currentColor" opacity="0.32" />
                <rect x="42" y="14" width="16" height="28" rx="2" fill="currentColor" opacity="0.18" />
                <rect x="60" y="14" width="14" height="28" rx="2" fill="currentColor" opacity="0.32" />
                <line x1="10" y1="22" x2="18" y2="22" stroke="currentColor" stroke-width="2" />
                <line x1="28" y1="22" x2="36" y2="22" stroke="currentColor" stroke-width="2" />
                <line x1="46" y1="22" x2="54" y2="22" stroke="currentColor" stroke-width="2" />
                <line x1="64" y1="22" x2="70" y2="22" stroke="currentColor" stroke-width="2" />
            </template>

            <!-- ── Site grid: 3x2 site tiles ── -->
            <template v-else-if="widget === 'site_grid_widget'">
                <rect x="6" y="14" width="20" height="14" rx="2" fill="currentColor" opacity="0.4" />
                <rect x="30" y="14" width="20" height="14" rx="2" fill="currentColor" opacity="0.7" />
                <rect x="54" y="14" width="20" height="14" rx="2" fill="currentColor" opacity="0.4" />
                <rect x="6" y="32" width="20" height="14" rx="2" fill="currentColor" opacity="0.7" />
                <rect x="30" y="32" width="20" height="14" rx="2" fill="currentColor" opacity="0.4" />
                <rect x="54" y="32" width="20" height="14" rx="2" fill="currentColor" opacity="0.55" />
            </template>

            <!-- ── Maintenance: alert rows ── -->
            <template v-else-if="widget === 'maintenance_list_widget'">
                <circle cx="10" cy="16" r="3" fill="currentColor" />
                <rect x="18" y="13" width="40" height="6" rx="1" fill="currentColor" opacity="0.5" />
                <circle cx="10" cy="28" r="3" fill="currentColor" opacity="0.6" />
                <rect x="18" y="25" width="46" height="6" rx="1" fill="currentColor" opacity="0.4" />
                <circle cx="10" cy="40" r="3" fill="currentColor" opacity="0.4" />
                <rect x="18" y="37" width="34" height="6" rx="1" fill="currentColor" opacity="0.3" />
            </template>

            <!-- ── Cross-site bar: vertical bars ── -->
            <template v-else-if="widget === 'cross_site_bar_widget'">
                <rect x="10" y="22" width="8" height="24" fill="currentColor" />
                <rect x="22" y="14" width="8" height="32" fill="currentColor" opacity="0.85" />
                <rect x="34" y="28" width="8" height="18" fill="currentColor" opacity="0.7" />
                <rect x="46" y="18" width="8" height="28" fill="currentColor" opacity="0.6" />
                <rect x="58" y="32" width="8" height="14" fill="currentColor" opacity="0.4" />
                <line x1="6" y1="50" x2="74" y2="50" stroke="currentColor" stroke-width="1" opacity="0.3" />
            </template>

            <!-- ── Data table: header + rows ── -->
            <template v-else-if="widget === 'data_table_widget'">
                <rect x="6" y="10" width="68" height="6" rx="1" fill="currentColor" opacity="0.4" />
                <rect x="6" y="20" width="68" height="4" rx="1" fill="currentColor" opacity="0.2" />
                <rect x="6" y="28" width="68" height="4" rx="1" fill="currentColor" opacity="0.2" />
                <rect x="6" y="36" width="68" height="4" rx="1" fill="currentColor" opacity="0.2" />
                <rect x="6" y="44" width="68" height="4" rx="1" fill="currentColor" opacity="0.2" />
            </template>

            <!-- ── Clock: face + hands ── -->
            <template v-else-if="widget === 'clock_widget'">
                <circle cx="40" cy="28" r="18" fill="none" stroke="currentColor" stroke-width="2" opacity="0.5" />
                <line x1="40" y1="28" x2="40" y2="14" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                <line x1="40" y1="28" x2="50" y2="32" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                <circle cx="40" cy="28" r="1.5" fill="currentColor" />
            </template>

            <!-- ── Fallback: generic boxes ── -->
            <template v-else>
                <rect x="6" y="14" width="68" height="28" rx="2" fill="currentColor" opacity="0.25" />
            </template>
        </svg>
    </div>
</template>

<script setup lang="ts">
import type {UiWidgetId} from '@/types/dashboard-entry';

defineProps<{
    widget: UiWidgetId;
}>();

/** Pseudo-random alpha for the heatmap thumbnail — deterministic per cell. */
function heatmapAlpha(row: number, col: number): number {
    const seed = (row * 31 + col * 17) % 100;
    return 0.18 + (seed / 100) * 0.6;
}
</script>

<style scoped>
.wi {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-primary);
}
.wi-svg {
    width: 100%;
    height: 100%;
    max-width: 100%;
    max-height: 100%;
}
.wi--clock_widget { color: var(--color-text-secondary); }
.wi--maintenance_list_widget { color: var(--color-warning); }
.wi--data_table_widget { color: var(--color-text-tertiary); }
.wi--gauge_widget { color: var(--color-info); }
.wi--state_timeline_widget { color: var(--color-status-on); }
.wi--energy_flow_sankey_widget { color: var(--color-warning); }
.wi--top_consumers_widget { color: var(--color-warning); }
.wi--cross_site_bar_widget { color: var(--color-accent); }
.wi--fleet_kpi_strip_widget { color: var(--color-primary); }
.wi--site_grid_widget { color: var(--color-success); }
.wi--activity_heatmap_widget { color: var(--color-info); }
.wi--stats_summary_widget { color: var(--color-text-secondary); }
</style>
