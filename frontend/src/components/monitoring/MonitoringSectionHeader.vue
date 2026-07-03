<template>
    <div class="mon-head">
        <div class="mon-head__main">
            <span v-if="icon || status" class="mon-head__badge" :data-status="status">
                <HealthDot v-if="status" :status="status" />
                <i v-else-if="icon" :class="icon" aria-hidden="true" />
            </span>
            <div class="mon-head__copy">
                <h3>{{ title }}</h3>
                <p v-if="description">{{ description }}</p>
            </div>
            <span v-if="status" class="mon-head__pill" :data-status="status">
                {{ statusLabel }}
            </span>
        </div>
        <div v-if="$slots.actions" class="mon-head__actions">
            <slot name="actions" />
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import type {FlowStatus} from '@/stores/monitoring';
import HealthDot from './HealthDot.vue';

const props = defineProps<{
    title: string;
    status?: FlowStatus;
    description?: string;
    icon?: string;
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
.mon-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-sm);
    padding-bottom: var(--gap-sm);
    border-bottom: 1px solid var(--color-border-subtle);
}
.mon-head__main {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: var(--gap-sm);
}
.mon-head__badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    flex: 0 0 auto;
    border-radius: var(--radius-md, 8px);
    background: var(--color-primary-subtle);
    color: var(--color-primary-text, var(--color-primary));
    font-size: var(--type-caption);
}
.mon-head__copy {
    min-width: 0;
}
.mon-head h3,
.mon-head p {
    margin: 0;
}
.mon-head h3 {
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}
.mon-head p {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.mon-head__pill {
    display: inline-flex;
    align-items: center;
    padding: 2px 10px;
    border-radius: var(--radius-full, 999px);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    background: var(--color-surface-2);
    color: var(--color-text-secondary);
    border: 1px solid var(--color-border-subtle);
}
.mon-head__pill[data-status='warning'] {
    background: var(--color-warning-subtle, var(--color-orange-subtle));
    color: var(--color-warning-text, var(--color-orange-text));
    border-color: transparent;
}
.mon-head__pill[data-status='critical'] {
    background: var(--color-danger-subtle);
    color: var(--color-danger-text);
    border-color: transparent;
}
.mon-head__actions {
    flex: 0 0 auto;
}
@media (max-width: 640px) {
    .mon-head {
        align-items: flex-start;
        flex-direction: column;
    }
}
</style>
