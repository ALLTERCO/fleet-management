<template>
    <div class="psk" :class="`psk--${provider}`" role="status" aria-label="Rendering preview">
        <template v-if="provider === 'email_smtp'">
            <!-- Email: header rows + body -->
            <div class="psk__row psk__row--label" />
            <div class="psk__row psk__row--label" />
            <div class="psk__row psk__row--label" />
            <div class="psk__divider" />
            <div class="psk__body" />
        </template>

        <template v-else-if="provider === 'slack_webhook'">
            <!-- Slack: channel header + avatar + message lines -->
            <div class="psk__row psk__row--small" />
            <div class="psk__slack-msg">
                <div class="psk__avatar" />
                <div class="psk__slack-text">
                    <div class="psk__row psk__row--meta" />
                    <div class="psk__row" />
                    <div class="psk__row psk__row--short" />
                </div>
            </div>
        </template>

        <template v-else-if="provider === 'teams_workflow_webhook'">
            <!-- Teams: card-on-paper feel -->
            <div class="psk__teams-card">
                <div class="psk__teams-accent" />
                <div class="psk__teams-body">
                    <div class="psk__row psk__row--meta" />
                    <div class="psk__row" />
                    <div class="psk__row psk__row--short" />
                </div>
            </div>
        </template>

        <template v-else-if="provider === 'telegram_bot'">
            <!-- Telegram: bubble-shaped shimmer -->
            <div class="psk__row psk__row--small" />
            <div class="psk__tg-bubble">
                <div class="psk__row psk__row--meta" />
                <div class="psk__row" />
                <div class="psk__row psk__row--short" />
            </div>
        </template>

        <template v-else>
            <!-- Webhook / fallback: header + large body block -->
            <div class="psk__row psk__row--small" />
            <div class="psk__body psk__body--tall" />
        </template>
    </div>
</template>

<script setup lang="ts">
import type {ChannelProvider} from '@api/channel';

defineProps<{
    provider: ChannelProvider;
}>();
</script>

<style scoped>
.psk {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-subtle);
}

.psk__row {
    position: relative;
    height: 0.9rem;
    border-radius: var(--radius-sm);
    background: var(--skeleton-bg);
    overflow: hidden;
}

.psk__row::after {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--skeleton-shimmer);
    animation: psk-shimmer 1.4s ease-in-out infinite;
}

.psk__row--label {
    width: 60%;
}

.psk__row--short {
    width: 40%;
}

.psk__row--small {
    height: 0.75rem;
    width: 30%;
}

.psk__row--meta {
    height: 0.75rem;
    width: 50%;
}

.psk__divider {
    height: 1px;
    background: var(--color-border-subtle);
    margin: var(--space-2) 0;
}

.psk__body {
    min-height: 12rem;
    border-radius: var(--radius-md);
    background: var(--skeleton-bg);
    overflow: hidden;
    position: relative;
}

.psk__body::after {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--skeleton-shimmer);
    animation: psk-shimmer 1.4s ease-in-out infinite;
}

.psk__body--tall {
    min-height: 16rem;
}

/* Slack layout */
.psk__slack-msg {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-3);
    margin-top: var(--space-2);
}

.psk__avatar {
    width: 2.25rem;
    height: 2.25rem;
    border-radius: var(--radius-md);
    background: var(--skeleton-bg);
    position: relative;
    overflow: hidden;
}

.psk__avatar::after {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--skeleton-shimmer);
    animation: psk-shimmer 1.4s ease-in-out infinite;
}

.psk__slack-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

/* Teams layout */
.psk__teams-card {
    display: grid;
    grid-template-columns: auto 1fr;
    background: var(--color-surface-0);
    border-radius: var(--radius-md);
    overflow: hidden;
    margin-top: var(--space-2);
}

.psk__teams-accent {
    width: 4px;
    background: var(--color-border-medium);
}

.psk__teams-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
}

/* Telegram bubble */
.psk__tg-bubble {
    align-self: flex-start;
    max-width: 85%;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border-radius: 12px 12px 12px var(--radius-sm);
    background: var(--color-surface-0);
}

@keyframes psk-shimmer {
    0% {
        transform: translateX(-100%);
    }
    100% {
        transform: translateX(100%);
    }
}
</style>
