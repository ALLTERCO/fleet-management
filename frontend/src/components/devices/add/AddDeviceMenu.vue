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
                        <i :class="option.icon" aria-hidden="true" />
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
    min-width: var(--floating-w-md);
    padding: var(--space-1);
}
.adm__item {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    width: 100%;
    padding: var(--gap-sm) var(--space-2);
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text-secondary);
    text-align: left;
    cursor: pointer;
    transition:
        background var(--motion-hover),
        color var(--motion-hover);
}
.adm__item:hover:not(.adm__item--disabled) {
    background: var(--state-hover-bg);
    color: var(--color-text-primary);
}
.adm__item--disabled {
    cursor: not-allowed;
    opacity: 0.55;
}
.adm__icon {
    flex-shrink: 0;
    width: var(--icon-size-sm);
    text-align: center;
    color: var(--color-text-tertiary);
}
.adm__item:hover:not(.adm__item--disabled) .adm__icon {
    color: inherit;
}
.adm__text {
    display: flex;
    flex-direction: column;
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
}
.adm__badge {
    flex-shrink: 0;
    padding: 2px 8px;
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
