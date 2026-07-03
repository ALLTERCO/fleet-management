<template>
    <button
        type="button"
        class="ppt"
        :class="{
            'ppt--active': active,
            'ppt--advanced': variant === 'advanced'
        }"
        :aria-pressed="active"
        @click="$emit('select')"
    >
        <ProviderLogo
            :provider="provider"
            :size="variant === 'advanced' ? 'md' : 'xl'"
            class="ppt__logo"
        />
        <span class="ppt__body">
            <span class="ppt__label">{{ label }}</span>
            <span v-if="description" class="ppt__desc">{{ description }}</span>
        </span>
        <span v-if="active" class="ppt__check" aria-hidden="true">
            <i class="fas fa-circle-check" />
        </span>
    </button>
</template>

<script setup lang="ts">
import type {ChannelProvider} from '@api/channel';
import ProviderLogo from '@/components/core/ProviderLogo.vue';

// Provider picker tile. Two variants:
//   - tile     (default) vertical, used in the top-row 4-up grid
//   - advanced          horizontal, used below the primary 4 for webhook etc
// Brand identity comes from ProviderLogo (Slack purple, Teams blue, Telegram
// cyan, Email neutral, Webhook primary). Active state uses brand-glow shadow.
withDefaults(
    defineProps<{
        provider: ChannelProvider;
        label: string;
        description?: string;
        active?: boolean;
        variant?: 'tile' | 'advanced';
    }>(),
    {
        description: '',
        active: false,
        variant: 'tile'
    }
);

defineEmits<{select: []}>();
</script>

<style scoped>
.ppt {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    min-height: var(--provider-tile-min-height);
    padding: var(--space-5) var(--space-4);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--provider-tile-radius);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    text-align: center;
    cursor: pointer;
    /* 3-layer rest state — contact shadow + diffuse elevation.
       Brand-tinted perspective appears on hover/active. */
    box-shadow:
        0 1px 1px rgba(0, 0, 0, 0.2),
        0 4px 10px -2px rgba(0, 0, 0, 0.25);
    transition:
        border-color var(--motion-hover),
        background var(--motion-hover),
        transform var(--motion-press),
        box-shadow var(--motion-state);
}

.ppt:hover {
    border-color: rgba(var(--color-primary-rgb), 0.5);
    background: var(--color-surface-2);
    transform: translateY(-2px);
    /* 3-layer hover — contact deepens, elevation grows, brand glow added */
    box-shadow:
        0 1px 2px rgba(0, 0, 0, 0.25),
        0 8px 20px -4px rgba(0, 0, 0, 0.3),
        0 12px 28px -10px rgba(var(--color-primary-rgb), 0.25);
}

.ppt:hover .ppt__logo {
    transform: translateY(-2px);
}

.ppt:active:not(:disabled) {
    transform: scale(var(--press-scale));
}

.ppt:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
}

.ppt--active {
    border-color: rgba(var(--color-primary-rgb), 0.6);
    background: color-mix(
        in srgb,
        var(--color-primary) 8%,
        var(--color-surface-2)
    );
    /* 3-layer active — contact + elevation + strong brand ring */
    box-shadow:
        0 1px 2px rgba(0, 0, 0, 0.3),
        0 6px 16px -2px rgba(0, 0, 0, 0.35),
        0 0 0 2px rgba(var(--color-primary-rgb), 0.45),
        0 16px 32px -10px rgba(var(--color-primary-rgb), 0.35);
}

.ppt--active .ppt__logo {
    box-shadow: var(--shadow-brand-ring);
    background: var(--color-surface-1);
}

.ppt__body {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
    width: 100%;
}

.ppt__label {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    line-height: 1.25;
}

.ppt__desc {
    font-size: var(--type-body);
    font-weight: var(--font-normal);
    color: var(--color-text-secondary);
    line-height: 1.4;
}

.ppt__check {
    position: absolute;
    top: var(--space-3);
    right: var(--space-3);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--color-primary-text);
    font-size: var(--type-body);
}

/* Advanced variant — horizontal row, less visual weight, left-aligned */
.ppt--advanced {
    flex-direction: row;
    align-items: center;
    justify-content: flex-start;
    gap: var(--space-4);
    min-height: calc(var(--provider-tile-min-height) * 0.45);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-lg);
    text-align: left;
}
.ppt--advanced .ppt__body {
    align-items: flex-start;
}

@media (max-width: 640px) {
    .ppt {
        min-height: calc(var(--provider-tile-min-height) * 0.8);
        padding: var(--space-4);
    }
}
</style>
