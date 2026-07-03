<template>
    <div class="rp" role="status" aria-live="polite">
        <div
            class="rp__track"
            :class="{'rp__track--indeterminate': percent == null}"
        >
            <div
                class="rp__fill"
                :style="percent != null ? {width: `${clampedPercent}%`} : undefined"
            />
        </div>

        <div class="rp__row">
            <span class="rp__phase">{{ label || 'Working…' }}</span>
            <span v-if="percent != null" class="rp__pct">
                {{ Math.round(clampedPercent) }}%
            </span>
        </div>

        <div v-if="hasStats" class="rp__stats">
            <span v-if="rowsWritten != null" class="rp__stat">
                <i class="fas fa-table-list" aria-hidden="true" />
                {{ formatRows(rowsWritten) }}<template
                    v-if="estimatedRows"
                > / {{ formatRows(estimatedRows) }}</template> rows
            </span>
            <span v-if="bytesWritten != null" class="rp__stat">
                <i class="fas fa-database" aria-hidden="true" />
                {{ formatBytes(bytesWritten) }}
            </span>
        </div>

        <button type="button" class="rp__cancel" @click="$emit('cancel')">
            <i class="fas fa-xmark" aria-hidden="true" /> Cancel
        </button>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {formatBytes} from '@/helpers/format';

const props = defineProps<{
    label: string;
    percent: number | null;
    rowsWritten: number | null;
    bytesWritten: number | null;
    estimatedRows: number | null;
}>();

defineEmits<{cancel: []}>();

const clampedPercent = computed(() =>
    Math.max(0, Math.min(100, props.percent ?? 0))
);

const hasStats = computed(
    () => props.rowsWritten != null || props.bytesWritten != null
);

function formatRows(n: number): string {
    return n.toLocaleString();
}
</script>

<style scoped>
.rp {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-default);
}

.rp__track {
    position: relative;
    height: var(--space-1-5);
    border-radius: var(--radius-full);
    background: var(--color-surface-3);
    overflow: hidden;
}
.rp__fill {
    height: 100%;
    border-radius: var(--radius-full);
    background: var(--color-primary);
    transition: width var(--duration-normal) var(--ease-out-expo);
}
.rp__track--indeterminate .rp__fill {
    width: 40%;
    animation: rp-indeterminate 1.2s ease-in-out infinite;
}
@keyframes rp-indeterminate {
    0% {
        transform: translateX(-120%);
    }
    100% {
        transform: translateX(320%);
    }
}

.rp__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
}
.rp__phase {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}
.rp__pct {
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
}

.rp__stats {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
}
.rp__stat {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    font-variant-numeric: tabular-nums;
}

.rp__cancel {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-default);
    background: transparent;
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    cursor: pointer;
    transition: background var(--motion-state), color var(--motion-state);
}
.rp__cancel:hover {
    background: var(--color-danger-subtle);
    color: var(--color-danger-text);
    border-color: var(--color-danger-text);
}

@media (prefers-reduced-motion: reduce) {
    .rp__track--indeterminate .rp__fill {
        animation-duration: 0ms;
    }
}
</style>
