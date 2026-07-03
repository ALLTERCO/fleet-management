<template>
    <BottomSheet
        :visible="!!site"
        v-model:snap="snap"
        :aria-label="`${site?.name ?? 'Site'} details`"
    >
        <header v-if="site" class="mfs__head">
            <span class="mfs__pip" :class="`mfs__pip--${site.status}`" aria-hidden="true" />
            <div class="mfs__head-body">
                <div class="mfs__name">{{ site.name }}</div>
                <div class="mfs__sub">{{ site.city }} · last seen {{ relativeLastSeen }}</div>
            </div>
            <button type="button" class="mfs__close" aria-label="Close" @click="emit('close')">
                <i class="fas fa-xmark" aria-hidden="true" />
            </button>
        </header>
        <dl v-if="kpis" class="mfs__kpis">
            <div class="mfs__kpi">
                <dt>Devices</dt>
                <dd>{{ kpis.online }}/{{ kpis.total }}</dd>
            </div>
            <div class="mfs__kpi">
                <dt>Load</dt>
                <dd>{{ kpis.powerKW.toFixed(1) }} kW</dd>
            </div>
            <div class="mfs__kpi">
                <dt>Alerts</dt>
                <dd :class="{'mfs__kpi-val--alert': kpis.alerts > 0}">{{ kpis.alerts }}</dd>
            </div>
        </dl>
        <div class="mfs__actions">
            <button type="button" class="mfs__btn mfs__btn--primary" @click="emit('openSite')">
                Open site
            </button>
            <button type="button" class="mfs__btn" @click="emit('openFloorPlan')">
                Floor plan
            </button>
        </div>
    </BottomSheet>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import BottomSheet, {type SheetSnap} from '@/components/core/BottomSheet.vue';
import {formatRelativeTime} from '@/helpers/relativeTime';

export interface MobileSiteSummary {
    readonly name: string;
    readonly city: string;
    readonly status: 'on' | 'warn' | 'off';
}

export interface MobileSiteKpis {
    readonly online: number;
    readonly total: number;
    readonly powerKW: number;
    readonly alerts: number;
    readonly lastSeenTs: number;
}

const props = defineProps<{
    site: MobileSiteSummary | null;
    kpis: MobileSiteKpis | null;
}>();
const emit = defineEmits<{
    close: [];
    openSite: [];
    openFloorPlan: [];
}>();

const snap = ref<SheetSnap>('half');
const relativeLastSeen = computed(() =>
    props.kpis ? formatRelativeTime(props.kpis.lastSeenTs) : '—'
);
</script>

<style scoped>
.mfs__head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--color-border-default);
}
.mfs__pip {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    flex-shrink: 0;
}
.mfs__pip--on {
    background: var(--color-status-on);
    box-shadow: 0 0 8px var(--color-status-on);
}
.mfs__pip--warn {
    background: var(--color-status-warn);
    box-shadow: 0 0 8px var(--color-status-warn);
}
.mfs__pip--off {
    background: var(--color-status-off);
    box-shadow: 0 0 8px var(--color-status-off);
}
.mfs__head-body {
    flex: 1;
    min-width: 0;
}
.mfs__name {
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
}
.mfs__sub {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    margin-top: 2px;
}
.mfs__close {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: transparent;
    border: 1px solid var(--color-border-default);
    color: var(--color-text-tertiary);
    cursor: pointer;
}
.mfs__kpis {
    margin: var(--space-3) 0;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-2);
}
.mfs__kpi {
    background: var(--state-hover-bg);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
}
.mfs__kpi dt {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.mfs__kpi dd {
    margin: var(--space-1) 0 0;
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
}
.mfs__kpi-val--alert {
    color: var(--color-status-off);
}
.mfs__actions {
    display: flex;
    gap: var(--space-2);
}
.mfs__btn {
    flex: 1;
    height: 44px;
    border-radius: var(--radius-md);
    background: var(--glass-2-bg);
    border: 1px solid var(--glass-border);
    color: var(--color-text-primary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    cursor: pointer;
}
.mfs__btn--primary {
    background: var(--color-primary);
    color: var(--color-text-inverse);
    border-color: transparent;
}
</style>
