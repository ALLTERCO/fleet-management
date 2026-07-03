<template>
    <div v-if="children.length > 0" class="ov-child-grid">
        <button
            v-for="c in children"
            :key="c.id"
            type="button"
            class="ov-child-card"
            :title="`Open ${c.name}`"
            @click="$emit('open', c.id)"
        >
            <span
                class="ov-child-card__dot"
                :style="{background: c.dotColor}"
                aria-hidden="true"
            />
            <span class="ov-child-card__body">
                <span class="ov-child-card__name">{{ c.name }}</span>
                <span class="ov-child-card__meta">
                    <span>{{ c.kindLabel }}</span>
                    <span v-if="c.deviceCount != null" class="ov-child-card__meta-dot">
                        {{ c.deviceCount }} device{{ c.deviceCount === 1 ? '' : 's' }}
                    </span>
                    <span
                        v-if="c.alertCount != null && c.alertCount > 0"
                        class="ov-child-card__alert"
                    >
                        <i class="fas fa-triangle-exclamation" aria-hidden="true" />
                        {{ c.alertCount }}
                    </span>
                </span>
            </span>
            <i class="fas fa-arrow-right ov-child-card__chev" aria-hidden="true" />
        </button>
    </div>
    <p v-else class="ov-child-grid__empty">{{ emptyHint ?? 'No children yet.' }}</p>
</template>

<script setup lang="ts">
export interface OverviewChild {
    readonly id: number;
    readonly name: string;
    readonly kindLabel: string;
    readonly dotColor: string;
    readonly deviceCount?: number;
    readonly alertCount?: number;
}

defineProps<{
    children: readonly OverviewChild[];
    emptyHint?: string;
}>();

defineEmits<{
    open: [id: number];
}>();
</script>

<style scoped>
.ov-child-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: var(--space-3);
}

.ov-child-card {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    background: var(--color-surface-3);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
    cursor: pointer;
    text-align: left;
    transition:
        border-color var(--duration-fast),
        transform var(--duration-fast),
        background var(--duration-fast);
}

.ov-child-card:hover,
.ov-child-card:focus-visible {
    border-color: var(--color-border-strong);
    background: var(--color-surface-4);
    transform: translateY(-1px);
    outline: none;
}

.ov-child-card__dot {
    width: 10px;
    height: 10px;
    border-radius: var(--radius-full);
    flex-shrink: 0;
}

.ov-child-card__body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
}

.ov-child-card__name {
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.ov-child-card__meta {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    display: inline-flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
}

.ov-child-card__meta-dot::before {
    content: '·';
    margin-right: var(--space-2);
    color: var(--color-text-quaternary);
}

.ov-child-card__alert {
    color: var(--color-status-warn);
    display: inline-flex;
    align-items: center;
    gap: var(--space-0-5);
    font-variant-numeric: tabular-nums;
}

.ov-child-card__alert i {
    font-size: var(--icon-size-2xs);
}

.ov-child-card__chev {
    color: var(--color-text-quaternary);
    font-size: var(--icon-size-2xs);
    flex-shrink: 0;
}

.ov-child-grid__empty {
    margin: 0;
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
</style>
