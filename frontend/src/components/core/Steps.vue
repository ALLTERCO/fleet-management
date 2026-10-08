<template>
    <div>
        <ol class="steps" aria-label="Wizard steps">
            <li
                v-for="(_, id) in Array(steps)"
                :key="id"
                class="steps__item"
                :class="{'steps__item--reachable': isReachable(id + 1)}"
            >
                <component
                    :is="isReachable(id + 1) ? 'button' : 'div'"
                    class="steps__target"
                    :type="isReachable(id + 1) ? 'button' : undefined"
                    :aria-current="current === id + 1 ? 'step' : undefined"
                    :aria-disabled="isReachable(id + 1) ? undefined : 'true'"
                    @click="isReachable(id + 1) && emit('click', id + 1)"
                >
                    <span
                        class="steps__label"
                        :class="{'steps__label--inactive': current !== id + 1}"
                    >
                        <slot :id="id + 1" name="stepTitle">Step {{ id + 1 }}</slot>
                    </span>
                    <span
                        class="steps__bar"
                        :class="{'steps__bar--active': current === id + 1}"
                    />
                </component>
            </li>
        </ol>
    </div>
</template>

<script setup lang="ts">
const props = withDefaults(
    defineProps<{
        steps: number;
        current: number;
        /** Highest step the user may jump to. Defaults to backward-only. */
        maxReachable?: number;
    }>(),
    {maxReachable: undefined}
);

const emit = defineEmits<{
    click: [number];
}>();

// A step styled and announced as a button that does nothing is the clearest
// possible broken promise, so only truly reachable steps become buttons.
function isReachable(step: number): boolean {
    return step < (props.maxReachable ?? props.current);
}
</script>

<style scoped>
.steps {
    display: flex;
    flex-direction: row;
    gap: var(--gap-xs);
    width: 100%;
    margin: 0;
    padding: 0;
    list-style: none;
    text-align: center;
}

.steps__item {
    flex: 1;
    min-width: 0;
}

.steps__target {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--gap-xs);
    width: 100%;
    min-height: var(--touch-target-min);
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
}

.steps__item--reachable .steps__target {
    cursor: pointer;
}

.steps__target:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
    border-radius: var(--radius-sm);
}

.steps__label {
    font-weight: var(--font-semibold);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.steps__label--inactive {
    color: var(--color-text-disabled);
}

.steps__item--reachable .steps__label--inactive {
    color: var(--color-text-secondary);
}

/* The fill alone carries the state. A zero-offset glow was decoration, and it
   made the one element whose job is progress teleport between steps. */
.steps__bar {
    height: var(--space-1);
    border-radius: var(--radius-full);
    background: var(--color-surface-4);
    transition: background var(--duration-normal) var(--ease-out);
}

.steps__bar--active {
    background: var(--color-primary);
}
</style>
