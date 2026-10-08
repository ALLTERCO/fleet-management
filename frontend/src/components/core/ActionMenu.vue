<template>
    <MenuPopover align="right">
        <template #trigger="{toggle, open}">
            <Button
                type="green"
                size="sm"
                :title="title"
                :aria-label="title"
                @click="toggle"
            >
                <i class="fas fa-plus" aria-hidden="true" />
                <i
                    class="fas fa-chevron-down acm__caret"
                    :class="{'acm__caret--open': open}"
                    aria-hidden="true"
                />
            </Button>
        </template>
        <template #default="{close}">
            <div class="acm" role="group" :aria-label="menuLabel">
                <button
                    v-for="option in options"
                    :key="option.key"
                    type="button"
                    class="acm__item"
                    :class="{'acm__item--disabled': option.disabled}"
                    role="menuitem"
                    :disabled="option.disabled"
                    :aria-disabled="option.disabled ? 'true' : undefined"
                    :data-key="option.key"
                    @click="onPick(option, close)"
                >
                    <span class="acm__icon">
                        <ShellyDeviceGlyph
                            v-if="option.icon === 'glyph:shelly-device'"
                        />
                        <i v-else :class="option.icon" aria-hidden="true" />
                    </span>
                    <span class="acm__text">
                        <span class="acm__label">{{ option.label }}</span>
                        <span class="acm__hint">{{ option.hint }}</span>
                    </span>
                    <span v-if="option.badge" class="acm__badge">
                        {{ option.badge }}
                    </span>
                </button>
            </div>
        </template>
    </MenuPopover>
</template>

<script setup lang="ts">
// One "+" button that opens a short list of ways to add something. The
// Devices tab and the alerts list share it, so a new kind of "add" looks the
// same everywhere.
import Button from '@/components/core/Button.vue';
import MenuPopover from '@/components/core/MenuPopover.vue';
import ShellyDeviceGlyph from '@/components/core/ShellyDeviceGlyph.vue';

export interface ActionMenuOption {
    key: string;
    label: string;
    hint: string;
    /** A Font Awesome class, or `glyph:shelly-device` for the Shelly mark. */
    icon: string;
    badge?: string;
    disabled?: boolean;
}

defineProps<{
    /** Button title, e.g. "New device". */
    title: string;
    /** Accessible name of the list, e.g. "Device kind". */
    menuLabel: string;
    options: readonly ActionMenuOption[];
}>();

const emit = defineEmits<{pick: [key: string]}>();

function onPick(option: ActionMenuOption, close: () => void): void {
    if (option.disabled) return;
    close();
    emit('pick', option.key);
}
</script>

<style scoped>
.acm {
    display: flex;
    flex-direction: column;
    min-width: var(--floating-w-sm);
    padding: var(--gap-2xs);
}

.acm__item {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    width: 100%;
    padding: var(--gap-xs) var(--gap-sm);
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text-secondary);
    text-align: left;
    cursor: pointer;
    transition:
        background var(--motion-hover),
        color var(--motion-hover),
        box-shadow var(--motion-hover);
}

.acm__item:hover:not(.acm__item--disabled) {
    background: var(--state-hover-bg);
    color: var(--color-text-primary);
    box-shadow: var(--selection-glow);
}

.acm__item:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: calc(-1 * var(--focus-ring-width));
    background: var(--state-hover-bg);
    color: var(--color-text-primary);
}

.acm__item:active:not(.acm__item--disabled) {
    background: var(--state-hover-bg-strong);
}

.acm__item--disabled {
    cursor: not-allowed;
    opacity: 0.55;
}

/* Leading mark, stretched to the label plus hint block height. */
.acm__icon {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    align-self: stretch;
    width: var(--icon-size-row);
    font-size: var(--icon-size-lg);
    line-height: 1;
    color: var(--color-text-tertiary);
    transition: color var(--motion-hover);
}

.acm__icon .sdg {
    height: var(--icon-size-lg);
    width: auto;
}

.acm__item:hover:not(.acm__item--disabled) .acm__icon,
.acm__item:focus-visible .acm__icon {
    color: var(--color-primary);
}

.acm__text {
    display: flex;
    flex-direction: column;
    gap: var(--gap-2xs);
    min-width: 0;
    flex: 1;
}

.acm__label {
    font-weight: var(--font-semibold);
    font-size: var(--type-body);
    line-height: var(--leading-tight);
}

.acm__hint {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    line-height: var(--leading-snug);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.acm__badge {
    flex-shrink: 0;
    padding: var(--space-0-5) var(--gap-xs);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--color-text-tertiary);
    background: var(--color-surface-3);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-full);
}

.acm__caret {
    margin-left: var(--gap-2xs);
    font-size: var(--type-caption);
    opacity: 0.75;
    transition: transform var(--motion-hover);
}

.acm__caret--open {
    transform: rotate(180deg);
}
</style>
