<template>
    <span class="plg" :class="`plg--${size}`" :title="title" :aria-label="title">
        <i :class="iconClass" :style="{color}" />
    </span>
</template>

<script setup lang="ts">
import type {ChannelProvider} from '@api/channel';
import {computed} from 'vue';

// Backend owns the enum; this only maps each value to a UI icon + tint.
// Brand icons are deliberate brand reproductions — scoped to this
// component; never leak into the system palette.
const META: Record<
    ChannelProvider,
    {label: string; icon: string; color: string}
> = {
    email_smtp: {
        label: 'SMTP email',
        icon: 'fas fa-envelope',
        color: 'var(--color-text-secondary)'
    },
    generic_webhook: {
        label: 'Generic webhook',
        icon: 'fas fa-code',
        color: 'var(--color-primary)'
    },
    slack_webhook: {
        label: 'Slack',
        icon: 'fab fa-slack',
        color: '#4a154b'
    },
    teams_workflow_webhook: {
        label: 'Microsoft Teams',
        icon: 'fab fa-microsoft',
        color: '#464eb8'
    },
    telegram_bot: {
        label: 'Telegram',
        icon: 'fab fa-telegram',
        color: '#229ed9'
    },
    push_fcm: {
        label: 'Push (FCM)',
        icon: 'fas fa-mobile-screen',
        color: '#6366f1'
    },
    sms_twilio: {
        label: 'SMS (Twilio)',
        icon: 'fas fa-comment-sms',
        color: '#10b981'
    },
    voice_twilio: {
        label: 'Voice (Twilio)',
        icon: 'fas fa-phone-volume',
        color: '#f59e0b'
    },
    webhook_signed: {
        label: 'Signed webhook',
        icon: 'fas fa-shield-halved',
        color: '#ef4444'
    }
};

const props = withDefaults(
    defineProps<{
        provider: ChannelProvider;
        /**
         * Visual size of the logo wrapper.
         * sm  - 32px (list rows, chips)   - default
         * md  - 44px (toolbar, header)
         * lg  - 56px (dialog header)
         * xl  - 72px (provider-picker tile)
         */
        size?: 'sm' | 'md' | 'lg' | 'xl';
    }>(),
    {size: 'sm'}
);

const iconClass = computed(() => META[props.provider].icon);
const color = computed(() => META[props.provider].color);
const title = computed(() => META[props.provider].label);
</script>

<style scoped>
.plg {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-md);
    flex-shrink: 0;
    transition:
        transform var(--motion-hover),
        box-shadow var(--motion-state);
}

.plg--sm {
    width: var(--space-8);
    height: var(--space-8);
    font-size: var(--type-body);
    border-radius: var(--radius-md);
}

.plg--md {
    width: 2.75rem;
    height: 2.75rem;
    font-size: var(--icon-size-md);
    border-radius: var(--radius-md);
}

.plg--lg {
    width: 3.5rem;
    height: 3.5rem;
    font-size: var(--icon-size-lg);
    border-radius: var(--radius-lg);
}

.plg--xl {
    width: 4.5rem;
    height: 4.5rem;
    font-size: var(--icon-size-xl);
    border-radius: var(--radius-lg);
}
</style>
