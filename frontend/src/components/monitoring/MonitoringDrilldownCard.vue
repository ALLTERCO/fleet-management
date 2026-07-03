<template>
    <RouterLink :to="to" class="svc-card" :data-status="status">
        <div class="svc-card__top">
            <div class="svc-card__icon">
                <i :class="icon" aria-hidden="true" />
            </div>
            <span class="svc-card__status" :data-status="status">
                <HealthDot :status="status" />
                {{ statusLabel }}
            </span>
        </div>

        <div class="svc-card__body">
            <h4 class="svc-card__title">{{ title }}</h4>
            <p v-if="description" class="svc-card__desc">{{ description }}</p>
        </div>

        <div v-if="items.length" class="svc-card__metrics">
            <div v-for="item in items" :key="item.label" class="svc-card__metric">
                <span class="svc-card__metric-value">{{ item.value }}</span>
                <span class="svc-card__metric-label">{{ item.label }}</span>
            </div>
        </div>

        <div class="svc-card__foot">
            <span>Open</span>
            <i class="fas fa-arrow-right" aria-hidden="true" />
        </div>
    </RouterLink>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {RouterLink} from 'vue-router';
import type {FlowStatus} from '@/stores/monitoring';
import HealthDot from './HealthDot.vue';

const props = defineProps<{
    title: string;
    icon: string;
    to: string;
    status: FlowStatus;
    items: Array<{label: string; value: string | number}>;
    description?: string;
}>();

const statusLabel = computed(() => {
    switch (props.status) {
        case 'critical':
            return 'Critical';
        case 'warning':
            return 'Warning';
        default:
            return 'Healthy';
    }
});
</script>

<style scoped>
.svc-card {
    display: flex;
    flex-direction: column;
    gap: var(--gap-md);
    padding: var(--gap-md);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg, 12px);
    background: var(--color-surface-1);
    color: inherit;
    text-decoration: none;
    transition:
        border-color 0.15s ease,
        box-shadow 0.15s ease,
        transform 0.15s ease;
}
.svc-card:hover {
    border-color: var(--color-primary);
    box-shadow: var(--shadow-md, 0 6px 20px rgba(0, 0, 0, 0.18));
    transform: translateY(-2px);
}

/* ── header row: icon tile + status pill ── */
.svc-card__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
}
.svc-card__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: var(--radius-md, 8px);
    background: var(--color-primary-subtle);
    color: var(--color-primary-text, var(--color-primary));
    font-size: var(--icon-size-md, 18px);
}
.svc-card__status {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-xs);
    padding: 2px 10px;
    border-radius: var(--radius-full, 999px);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    background: var(--color-surface-2);
    color: var(--color-text-secondary);
    border: 1px solid var(--color-border-subtle);
}
.svc-card__status[data-status='warning'] {
    background: var(--color-warning-subtle, var(--color-orange-subtle));
    color: var(--color-warning-text, var(--color-orange-text));
    border-color: transparent;
}
.svc-card__status[data-status='critical'] {
    background: var(--color-danger-subtle);
    color: var(--color-danger-text);
    border-color: transparent;
}

/* ── title + description ── */
.svc-card__body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
}
.svc-card__title {
    margin: 0;
    color: var(--color-text-primary);
    font-size: var(--type-subtitle, var(--type-body));
    font-weight: var(--font-semibold);
}
.svc-card__desc {
    margin: 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    line-height: 1.4;
}

/* ── key metrics: 2-col value-over-label tiles ── */
.svc-card__metrics {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--gap-xs) var(--gap-md);
    padding-top: var(--gap-sm);
    border-top: 1px solid var(--color-border-subtle);
    margin-top: auto;
}
.svc-card__metric {
    display: flex;
    flex-direction: column;
    min-width: 0;
}
.svc-card__metric-value {
    color: var(--color-text-primary);
    font-family: var(--font-mono);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.svc-card__metric-label {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}

/* ── footer "Open →" ── */
.svc-card__foot {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    color: var(--color-primary-text, var(--color-primary));
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
}
.svc-card__foot i {
    transition: transform 0.15s ease;
}
.svc-card:hover .svc-card__foot i {
    transform: translateX(3px);
}
</style>
