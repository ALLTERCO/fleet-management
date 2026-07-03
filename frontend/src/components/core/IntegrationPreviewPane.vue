<template>
    <aside class="ipp">
        <header class="ipp__hdr">
            <div class="ipp__hdr-text">
                <h3 class="ipp__title">
                    <i class="fas fa-eye ipp__title-icon" aria-hidden="true" />
                    Live preview
                </h3>
                <p class="ipp__desc">{{ descriptionFor(provider) }}</p>
            </div>
            <span v-if="loading" class="ipp__loading" aria-label="Rendering">
                <i class="fas fa-circle-notch fa-spin" />
                Rendering…
            </span>
        </header>

        <div class="ipp__stage" :class="{'ipp__stage--empty': !provider}">
            <div v-if="!provider" class="ipp__placeholder">
                <i class="fas fa-eye ipp__placeholder-icon" aria-hidden="true" />
                <p>Pick a provider to see how the alert will look.</p>
            </div>

            <PreviewSkeleton v-else-if="loading && !hasContent" :provider="provider" />

            <PreviewChrome_Email
                v-else-if="provider === 'email_smtp'"
                :endpoint-name="endpointName"
                :subject="subject"
                :html="emailHtml"
                :text="emailText"
                :attachments="emailAttachments"
            />
            <PreviewChrome_Slack
                v-else-if="provider === 'slack_webhook'"
                :endpoint-name="endpointName"
                :rendered="rendered"
            />
            <PreviewChrome_Teams
                v-else-if="provider === 'teams_workflow_webhook'"
                :endpoint-name="endpointName"
                :rendered="rendered"
            />
            <PreviewChrome_Telegram
                v-else-if="provider === 'telegram_bot'"
                :endpoint-name="endpointName"
                :rendered="rendered"
            />
            <PreviewChrome_Webhook
                v-else-if="provider === 'generic_webhook'"
                :url="webhookUrl"
                :rendered="rendered"
            />
        </div>
    </aside>
</template>

<script setup lang="ts">
import type {ChannelProvider} from '@api/channel';
import {computed} from 'vue';
import PreviewChrome_Email from '@/components/core/PreviewChrome_Email.vue';
import PreviewChrome_Slack from '@/components/core/PreviewChrome_Slack.vue';
import PreviewChrome_Teams from '@/components/core/PreviewChrome_Teams.vue';
import PreviewChrome_Telegram from '@/components/core/PreviewChrome_Telegram.vue';
import PreviewChrome_Webhook from '@/components/core/PreviewChrome_Webhook.vue';
import PreviewSkeleton from '@/components/core/PreviewSkeleton.vue';
import type {ProbedAttachment} from '@/stores/notifications';

const props = defineProps<{
    provider: ChannelProvider | null;
    endpointName?: string;
    subject?: string;
    rendered?: string;
    emailHtml?: string;
    emailText?: string;
    emailAttachments?: ProbedAttachment[];
    webhookUrl?: string;
    loading?: boolean;
}>();

// Short per-provider blurb shown under the pane title.
const DESCRIPTIONS: Record<ChannelProvider, string> = {
    email_smtp: 'Rendered with your HTML + text templates.',
    slack_webhook: 'How the message appears in your Slack channel.',
    teams_workflow_webhook: 'Adaptive card sent to the Teams channel.',
    telegram_bot: 'Message delivered by the bot to the chat.',
    generic_webhook: 'HTTP request body sent to your endpoint.',
    push_fcm: 'Mobile push payload delivered via Firebase Cloud Messaging.',
    sms_twilio: 'SMS body sent through Twilio Programmable Messaging.',
    voice_twilio: 'Voice call placed through Twilio with your TwiML.',
    webhook_signed: 'HMAC-signed HTTP request to your endpoint.'
};

function descriptionFor(p: ChannelProvider | null): string {
    if (!p) return 'Configure a provider to start.';
    return DESCRIPTIONS[p];
}

// Show the skeleton instead of the chrome on first render (no content yet).
const hasContent = computed(() => {
    if (props.provider === 'email_smtp') {
        return !!(props.emailHtml || props.emailText);
    }
    return !!props.rendered;
});
</script>

<style scoped>
.ipp {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
    height: 100%;
    min-width: 0;
}

.ipp__hdr {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--gap-sm);
}

.ipp__hdr-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
}

.ipp__title {
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    line-height: 1.2;
    display: inline-flex;
    align-items: center;
    gap: var(--gap-xs);
}

.ipp__title-icon {
    color: var(--color-primary-text);
    font-size: var(--type-caption);
}

.ipp__desc {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    line-height: 1.4;
    max-width: 40ch;
}

.ipp__loading {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    flex-shrink: 0;
}

/* The stage is purely a positioning surface — the chromes provide their
   own visual styling (background, radius, shadow). Removing the outer
   bordered box eliminates the double-nested-surface effect. */
.ipp__stage {
    flex: 1;
    min-height: 20rem;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: visible;
}

.ipp__stage--empty {
    align-items: center;
    justify-content: center;
    padding: var(--gap-lg);
    border-radius: var(--radius-lg);
    border: 1px dashed var(--color-border-medium);
    background: var(--color-surface-1);
    min-height: 20rem;
}

.ipp__placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--gap-sm);
    text-align: center;
    color: var(--color-text-tertiary);
}

.ipp__placeholder-icon {
    font-size: var(--icon-size-xl);
    opacity: 0.4;
}

.ipp__placeholder p {
    margin: 0;
    font-size: var(--type-body);
    max-width: 28ch;
}
</style>
