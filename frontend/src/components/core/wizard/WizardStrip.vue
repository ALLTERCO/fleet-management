<template>
    <nav class="wzs" :aria-label="label">
        <ol class="wzs__run">
            <li
                v-for="(segment, index) in segments"
                :key="segment.id"
                class="wzs__slot"
            >
                <i
                    v-if="index > 0"
                    class="fas fa-chevron-right wzs__joint"
                    aria-hidden="true"
                />
                <button
                    type="button"
                    class="wzs__seg"
                    :class="`wzs__seg--${segment.state}`"
                    :disabled="!segment.reachable"
                    :aria-current="segment.state === 'current' ? 'step' : undefined"
                    :title="segment.text"
                    @click="emit('go', index)"
                >
                    {{ segment.text }}
                </button>
            </li>
        </ol>
    </nav>
</template>

<script setup lang="ts">
// The commissioning strip. Runs along the top of the flow, where a reader
// looks first, and keeps the same shape however many steps a flow has.
//
// A finished segment carries the value the user chose, so the strip assembles
// into the sentence the rule will become. That is why there is no review step:
// the review has been on screen the whole time.
import type {WizardSegment} from '@/helpers/wizardFlow';

defineProps<{
    segments: readonly WizardSegment[];
    /** Names the run for screen readers, e.g. "New alert steps". */
    label: string;
}>();

const emit = defineEmits<{go: [index: number]}>();
</script>

<style scoped>
.wzs {
    min-width: 0;
}

.wzs__run {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--gap-2xs);
    margin: 0;
    padding: 0;
    list-style: none;
}

.wzs__slot {
    display: flex;
    align-items: center;
    gap: var(--gap-2xs);
    min-width: 0;
}

.wzs__joint {
    font-size: var(--icon-size-2xs);
    color: var(--color-text-tertiary);
}

/* A printed label sitting on the panel: one level up from the bed, edge
   defined by a low-opacity border rather than a shadow. */
.wzs__seg {
    max-width: 14ch;
    overflow: hidden;
    padding: var(--gap-2xs) var(--gap-xs);
    border: var(--space-px) solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
    white-space: nowrap;
    text-overflow: ellipsis;
    cursor: pointer;
    transition:
        color var(--duration-fast) var(--ease-out-expo),
        border-color var(--duration-fast) var(--ease-out-expo);
}

.wzs__seg:disabled {
    cursor: default;
}

/* Answered. The value earns full-strength text; the chrome stays quiet. */
.wzs__seg--done {
    color: var(--color-text-primary);
}

.wzs__seg--done:not(:disabled):hover {
    border-color: var(--color-border-strong);
}

/* Standing in it. The only place the accent appears in the strip. */
.wzs__seg--current {
    color: var(--color-primary-text);
    border-color: color-mix(
        in srgb,
        var(--color-primary-text) 45%,
        transparent
    );
    background: color-mix(
        in srgb,
        var(--color-primary-text) 8%,
        var(--color-surface-2)
    );
    font-weight: var(--font-semibold);
}

/* Not yet. Reads as unprinted tape. */
.wzs__seg--pending {
    border-style: dashed;
    background: transparent;
}

.wzs__seg:focus-visible {
    outline: var(--space-0-5) solid var(--color-primary-text);
    outline-offset: var(--space-px);
}

@media (max-width: 640px) {
    .wzs__seg {
        max-width: 9ch;
    }
}
</style>
