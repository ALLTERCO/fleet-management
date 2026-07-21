<template>
    <MenuPopover align="right">
        <template #trigger="{toggle, open}">
            <Button
                type="green"
                size="sm"
                title="New device"
                aria-label="New device"
                @click="toggle"
            >
                <i class="fas fa-plus" />
                <i
                    class="fas fa-chevron-down adm__caret"
                    :class="{'adm__caret--open': open}"
                    aria-hidden="true"
                />
            </Button>
        </template>

        <template #default="{close}">
            <div class="adm" role="menu" aria-label="Device kind">
                <button
                    v-for="option in KIND_OPTIONS"
                    :key="option.kind"
                    type="button"
                    class="adm__item"
                    :class="{'adm__item--disabled': option.disabled}"
                    role="menuitem"
                    :disabled="option.disabled"
                    :aria-disabled="option.disabled ? 'true' : undefined"
                    :data-kind="option.kind"
                    @click="onPick(option, close)"
                >
                    <span class="adm__icon">
                        <ShellyDeviceGlyph
                            v-if="option.icon === 'glyph:shelly-device'"
                        />
                        <i v-else :class="option.icon" aria-hidden="true" />
                    </span>
                    <span class="adm__text">
                        <span class="adm__label">{{ option.label }}</span>
                        <span class="adm__hint">{{ option.hint }}</span>
                    </span>
                    <span v-if="option.badge" class="adm__badge">
                        {{ option.badge }}
                    </span>
                </button>
            </div>
        </template>
    </MenuPopover>
</template>

<script setup lang="ts">
import Button from '@/components/core/Button.vue';
import MenuPopover from '@/components/core/MenuPopover.vue';
import ShellyDeviceGlyph from '@/components/core/ShellyDeviceGlyph.vue';
import {
    DEVICE_KIND_META,
    DEVICE_KIND_ORDER,
    type DeviceKindMeta
} from '@/helpers/deviceKindMeta';
import type {WizardKind} from '@/stores/virtualDeviceDraftStore';

type ConcreteKind = Exclude<WizardKind, null>;

interface KindOption extends DeviceKindMeta {
    kind: ConcreteKind;
}

const KIND_OPTIONS: readonly KindOption[] = DEVICE_KIND_ORDER.map((kind) => ({
    kind,
    ...DEVICE_KIND_META[kind]
}));

const emit = defineEmits<{pick: [ConcreteKind]}>();

function onPick(option: KindOption, close: () => void): void {
    if (option.disabled) return;
    close();
    emit('pick', option.kind);
}
</script>

<style scoped>
.adm {
    display: flex;
    flex-direction: column;
    min-width: var(--floating-w-sm);
    padding: var(--space-1);
}
.adm__item {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    width: 100%;
    padding: var(--space-2) var(--space-3);
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
.adm__item:hover:not(.adm__item--disabled) {
    background: var(--state-hover-bg);
    color: var(--color-text-primary);
    box-shadow: var(--selection-glow);
}
.adm__item:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: calc(-1 * var(--focus-ring-width));
    background: var(--state-hover-bg);
    color: var(--color-text-primary);
}
.adm__item:active:not(.adm__item--disabled) {
    background: var(--state-hover-bg-strong);
}
.adm__item--disabled {
    cursor: not-allowed;
    opacity: 0.55;
}
/* Leading mark — stretches to the label + gap + hint block height. */
.adm__icon {
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
.adm__icon .sdg {
    height: var(--icon-size-lg);
    width: auto;
}
.adm__item:hover:not(.adm__item--disabled) .adm__icon,
.adm__item:focus-visible .adm__icon {
    color: var(--color-primary);
}
.adm__text {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
    flex: 1;
}
.adm__label {
    font-weight: var(--font-semibold);
    font-size: var(--type-body);
    line-height: var(--leading-tight);
}
.adm__hint {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    line-height: var(--leading-snug);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.adm__badge {
    flex-shrink: 0;
    padding: var(--space-0-5) var(--space-2);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--color-text-tertiary);
    background: var(--color-surface-3);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-full);
}
.adm__caret {
    margin-left: var(--space-1);
    font-size: var(--type-caption);
    opacity: 0.75;
    transition: transform var(--motion-hover);
}
.adm__caret--open {
    transform: rotate(180deg);
}
</style>
