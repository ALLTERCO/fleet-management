<template>
    <component
        :is="interactive ? 'button' : 'div'"
        class="pick-row"
        :class="{
            'pick-row--interactive': interactive,
            'pick-row--selected': selected,
            'pick-row--dense': dense,
            'pick-row--flat': flat
        }"
        :type="interactive ? 'button' : undefined"
        :disabled="interactive ? disabled : undefined"
        :aria-pressed="interactive && selected !== undefined ? selected : undefined"
    >
        <span v-if="$slots.lead" class="pick-row__lead">
            <slot name="lead" />
        </span>

        <span class="pick-row__body">
            <span
                class="pick-row__title"
                :class="{'pick-row__title--control': control}"
            ><slot /></span>
            <span v-if="$slots.meta" class="pick-row__meta"><slot name="meta" /></span>
        </span>

        <span v-if="$slots.trail" class="pick-row__trail">
            <slot name="trail" />
        </span>

        <i
            v-else-if="selected"
            class="fas fa-check pick-row__check"
            aria-hidden="true"
        />
    </component>
</template>

<script setup lang="ts">
// One row shape for every list in a wizard step: gateways, templates, parts,
// candidates. `interactive` is false when the row carries its own controls —
// a button inside a button is invalid markup.
withDefaults(
    defineProps<{
        selected?: boolean;
        disabled?: boolean;
        interactive?: boolean;
        dense?: boolean;
        /** Drop the border and fill when the row already sits inside a card. */
        flat?: boolean;
        /** The title area holds a form control, so it must not clamp to one line. */
        control?: boolean;
    }>(),
    {interactive: true}
);
</script>

<style scoped>
.pick-row {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    width: 100%;
    min-height: var(--touch-target-min);
    padding: var(--gap-sm) var(--gap-md);
    border: var(--space-px) solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    font-size: var(--type-body);
    text-align: left;
    transition:
        background var(--duration-fast) var(--ease-default),
        border-color var(--duration-fast) var(--ease-default);
}

.pick-row--dense {
    padding: var(--gap-xs) var(--gap-sm);
}

/* A bordered row inside a bordered section is a card in a card. Inside one,
   the row is just a row: the section already draws the edge. */
.pick-row--flat {
    border-color: transparent;
    background: transparent;
}

.pick-row--flat.pick-row--interactive:hover:not(:disabled) {
    background: var(--state-hover-bg);
    border-color: transparent;
}

.pick-row--flat .pick-row__lead {
    background: var(--color-surface-3);
}

.pick-row--interactive {
    cursor: pointer;
}

.pick-row--interactive:hover:not(:disabled) {
    background: var(--color-surface-3);
    border-color: var(--color-border-medium);
}

.pick-row--interactive:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: calc(-1 * var(--focus-ring-width));
}

/* Press reads on pointer-down, so the row answers before the handler does. */
.pick-row--interactive:active:not(:disabled) {
    transform: scale(var(--press-scale));
    transition-duration: var(--duration-fast);
}

.pick-row--interactive:disabled {
    cursor: not-allowed;
    opacity: 0.55;
}

/* Selection is the one place colour appears in a row. */
.pick-row--selected {
    background: color-mix(in srgb, var(--color-primary) 12%, transparent);
    border-color: color-mix(in srgb, var(--color-primary) 55%, transparent);
}

.pick-row--interactive.pick-row--selected:hover {
    background: color-mix(in srgb, var(--color-primary) 18%, transparent);
    border-color: var(--color-primary);
}

.pick-row__lead {
    flex-shrink: 0;
    display: grid;
    place-items: center;
    width: var(--pick-row-lead);
    height: var(--pick-row-lead);
    border-radius: var(--radius-md);
    background: var(--color-surface-3);
    color: var(--color-text-secondary);
    font-size: var(--icon-size-md);
    overflow: hidden;
    transition: color var(--duration-fast) var(--ease-default);
}

.pick-row--dense .pick-row__lead {
    width: var(--pick-row-lead-sm);
    height: var(--pick-row-lead-sm);
    font-size: var(--icon-size-sm);
}

.pick-row--selected .pick-row__lead {
    color: var(--color-primary-text);
}

.pick-row__lead :deep(img) {
    width: 100%;
    height: 100%;
    object-fit: contain;
}

.pick-row__body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--gap-2xs);
    min-width: 0;
}

.pick-row__title {
    font-weight: var(--font-semibold);
    line-height: var(--leading-snug);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.pick-row__title--control {
    font-weight: var(--font-normal);
    overflow: visible;
    white-space: normal;
}

.pick-row__meta {
    font-variant-numeric: tabular-nums;
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    line-height: var(--leading-snug);
    overflow: hidden;
    text-overflow: ellipsis;
}

.pick-row__trail {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
}

.pick-row__check {
    flex-shrink: 0;
    width: var(--pick-row-check);
    color: var(--color-primary);
    text-align: center;
}
</style>
