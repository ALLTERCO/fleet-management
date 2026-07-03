<template>
    <div v-if="phaseMetrics" class="dash-phase-table">
        <div class="dpt-header">
            <span class="dpt-title">Phase balance &middot; {{ phaseMetrics.threePhaseDeviceCount }} devices</span>
            <span v-if="phaseMetrics.imbalancedCount > 0" class="dpt-badge dpt-badge--warn">
                &#x26A0; {{ phaseMetrics.imbalancedCount }} imbalanced
            </span>
        </div>

        <!-- Aggregate L1/L2/L3 -->
        <div class="dpt-agg">
            <div v-for="(phase, idx) in phaseMetrics.phases" :key="phase.label" class="dpt-agg-item">
                <div class="dpt-agg-label">
                    <span class="dpt-agg-dot" :class="'dpt-dot--' + idx" />
                    {{ phase.label }} total
                </div>
                <div class="dpt-agg-value">{{ formatPower(phase.totalPower) }} <span class="dpt-agg-unit">W</span></div>
                <div class="dpt-agg-sub">
                    {{ phase.avgVoltage != null ? phase.avgVoltage.toFixed(1) + ' V' : '\u2014' }}
                    &middot;
                    {{ phase.avgCurrent != null ? phase.avgCurrent.toFixed(1) + ' A' : '\u2014' }}
                </div>
            </div>
        </div>

        <!-- Per-device table -->
        <div class="dpt-table-wrap" :class="{'dpt-table-wrap--expanded': showAll}">
            <table class="dpt-table">
                <thead>
                    <tr>
                        <th class="dpt-th--left">Device</th>
                        <th>L1</th>
                        <th>L2</th>
                        <th>L3</th>
                        <th>Total</th>
                        <th>Balance</th>
                        <th>Dist.</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="dev in visibleDevices" :key="dev.shellyId">
                        <td class="dpt-td--name">
                            <span class="dpt-status-dot" :class="dev.online ? 'dpt-status--on' : 'dpt-status--off'" />
                            {{ dev.name }}
                        </td>
                        <td v-for="(ch, ci) in dev.channels.slice(0, 3)" :key="ci">
                            {{ ch.act_power != null ? (ch.act_power >= 1000 ? (ch.act_power / 1000).toFixed(1) + ' kW' : Math.round(ch.act_power) + ' W') : '\u2014' }}
                        </td>
                        <td class="dpt-td--total">{{ dev.totalPower >= 1000 ? (dev.totalPower / 1000).toFixed(1) + ' kW' : Math.round(dev.totalPower) + ' W' }}</td>
                        <td>
                            <span class="dpt-bal" :class="balanceClass(dev.imbalancePct)">
                                {{ dev.imbalancePct != null ? dev.imbalancePct + '%' : '\u2014' }}
                            </span>
                        </td>
                        <td>
                            <div class="dpt-dist">
                                <div v-for="(seg, si) in dev.distribution" :key="si"
                                    class="dpt-dist-seg"
                                    :class="'dpt-seg--' + si"
                                    :style="{width: seg + '%'}" />
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>

        <button v-if="sortedDevices.length > 10 && !showAll" class="dpt-show-all" @click="showAll = true">
            Show all {{ sortedDevices.length }} devices
        </button>
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import type {EmChannel, PhaseMetrics} from '@/helpers/liveMetrics';
import {calcImbalance} from '@/helpers/liveMetrics';

export interface PhaseDevice {
    id: number;
    shellyId: string;
    name: string;
    online: boolean;
    groupName?: string;
    channels: EmChannel[];
}

const props = defineProps<{
    phaseMetrics: PhaseMetrics | null;
    devices: PhaseDevice[];
    loading?: boolean;
}>();

const showAll = ref(false);

const sortedDevices = computed(() => {
    return [...props.devices]
        .map((d) => {
            const imbalancePct = calcImbalance(d.channels);
            const totalPower = d.channels.reduce(
                (s, c) => s + (c.act_power ?? 0),
                0
            );
            const total = totalPower || 1;
            const distribution = d.channels
                .slice(0, 3)
                .map((c) => Math.round(((c.act_power ?? 0) / total) * 100));
            return {...d, imbalancePct, totalPower, distribution};
        })
        .sort((a, b) => (b.imbalancePct ?? 0) - (a.imbalancePct ?? 0));
});

const visibleDevices = computed(() =>
    showAll.value ? sortedDevices.value : sortedDevices.value.slice(0, 10)
);

function balanceClass(pct: number | null): string {
    if (pct == null) return '';
    if (pct < 15) return 'dpt-bal--ok';
    if (pct < 25) return 'dpt-bal--warn';
    return 'dpt-bal--bad';
}

function formatPower(w: number): string {
    return w.toLocaleString('en-US', {maximumFractionDigits: 0});
}
</script>

<style scoped>
.dash-phase-table {
    background: var(--color-surface-2);
    border-radius: var(--radius-xl);
    padding: var(--space-4);
}
.dpt-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--space-3);
}
.dpt-title { font-size: var(--type-body); font-weight: 500; color: var(--color-text-tertiary); }
.dpt-badge { font-size: var(--type-body); border-radius: var(--radius-xs); padding: 1px var(--space-1-5); }
.dpt-badge--warn { color: var(--color-warning-text); background: rgba(var(--color-warning-rgb),0.08); }

/* Aggregate */
.dpt-agg { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-3); margin-bottom: 14px; }
.dpt-agg-label { font-size: var(--type-body); color: var(--color-text-disabled); display: flex; align-items: center; gap: var(--space-1); }
.dpt-agg-dot { width: 6px; height: 6px; border-radius: 50%; }
.dpt-dot--0 { background: var(--color-primary); }
.dpt-dot--1 { background: var(--color-warning-text); }
.dpt-dot--2 { background: var(--color-danger-text); }
.dpt-agg-value { font-size: var(--type-subheading); font-weight: 500; color: var(--color-text-primary); font-variant-numeric: tabular-nums; margin-top: var(--space-0-5); }
.dpt-agg-unit { font-size: var(--type-body); color: var(--color-text-disabled); }
.dpt-agg-sub { font-size: var(--type-body); color: var(--color-text-disabled); margin-top: 1px; }

/* Table */
.dpt-table-wrap { max-height: 320px; overflow: auto; }
.dpt-table-wrap--expanded { max-height: none; }
.dpt-table { width: 100%; border-collapse: collapse; }
.dpt-table th {
    font-size: var(--type-body); font-weight: 500; text-transform: uppercase; letter-spacing: 0.04em;
    color: var(--color-text-disabled); padding: var(--space-1-5) var(--space-2); text-align: right;
}
.dpt-th--left { text-align: left; }
.dpt-table td {
    padding: 5px var(--space-2); font-size: var(--type-body); font-variant-numeric: tabular-nums;
    border-top: 1px solid var(--color-border-subtle); text-align: right; color: var(--color-text-tertiary);
}
.dpt-td--name { color: var(--color-text-primary); font-weight: 500; text-align: left; }
.dpt-td--total { color: var(--color-text-primary); }
.dpt-table tr:hover td { background: var(--state-hover-bg); }

.dpt-status-dot { width: 5px; height: 5px; border-radius: 50%; display: inline-block; vertical-align: middle; margin-right: var(--space-1-5); }
.dpt-status--on { background: var(--color-success-text); }
.dpt-status--off { background: var(--color-danger-text); }

/* Balance badge */
.dpt-bal { display: inline-block; font-size: var(--type-body); border-radius: var(--radius-xs); padding: 1px var(--space-1); }
.dpt-bal--ok { color: var(--color-success-text); background: rgba(var(--color-success-rgb),0.08); }
.dpt-bal--warn { color: var(--color-warning-text); background: rgba(var(--color-warning-rgb),0.08); }
.dpt-bal--bad { color: var(--color-danger-text); background: rgba(var(--color-danger-rgb),0.08); }

/* Distribution bar */
.dpt-dist { display: flex; gap: 1px; width: 44px; height: 8px; }
.dpt-dist-seg { height: 100%; border-radius: 1px; }
.dpt-seg--0 { background: var(--color-primary); opacity: 0.5; }
.dpt-seg--1 { background: var(--color-warning-text); opacity: 0.5; }
.dpt-seg--2 { background: var(--color-danger-text); opacity: 0.5; }

.dpt-show-all {
    display: block; margin: var(--space-2) auto 0; font-size: var(--type-body); color: var(--color-text-tertiary);
    background: none; border: none; cursor: pointer; text-decoration: underline;
}
.dpt-show-all:hover { color: var(--color-text-secondary); }
</style>
