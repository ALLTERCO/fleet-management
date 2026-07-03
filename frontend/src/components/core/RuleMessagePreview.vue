<template>
    <div class="rmp">
        <p v-if="channels.length === 0" class="rmp__hint">
            Pick a channel above to preview the alert.
        </p>

        <template v-else>
            <div class="rmp__channels">
                <span class="rmp__goes-to">Goes to</span>
                <span
                    v-for="c in channels"
                    :key="c.label"
                    class="rmp__chip"
                >
                    {{ c.label }}
                </span>
            </div>

            <div class="rmp__card">
                <p class="rmp__headline">{{ renderedHeadline || '—' }}</p>
                <p class="rmp__message">{{ renderedMessage || '—' }}</p>
            </div>

            <p v-if="hasRichChannel" class="rmp__note">
                Email, Slack, and Teams use this text unless you attach a
                template with richer per-channel formatting.
            </p>
        </template>
    </div>
</template>

<script setup lang="ts">
import type {AlertRuleKind} from '@api/alert';
import {ref, watch} from 'vue';
import type {ChannelSummary} from '@/helpers/endpointChannels';
import {useNotificationsStore} from '@/stores/notifications';

const props = defineProps<{
    channels: ChannelSummary[];
    summary: string;
    message: string;
    ruleKind?: AlertRuleKind;
    ruleName?: string;
}>();

const notifications = useNotificationsStore();

const renderedHeadline = ref('');
const renderedMessage = ref('');
const hasRichChannel = ref(false);

// Render one body, skipping empty strings (RenderTemplate requires a
// non-empty template, and the default inline wording is blank).
async function renderOne(template: string): Promise<string> {
    if (!template.trim()) return '';
    const res = await notifications.renderTemplate({
        template,
        ruleKind: props.ruleKind,
        ruleName: props.ruleName
    });
    return res?.rendered ?? '';
}

async function render(): Promise<void> {
    hasRichChannel.value = props.channels.some((c) => c.bodyKind !== 'fallback');
    if (props.channels.length === 0) return;
    const [h, m] = await Promise.all([
        renderOne(props.summary),
        renderOne(props.message)
    ]);
    renderedHeadline.value = h;
    renderedMessage.value = m;
}

watch(
    () => [props.channels, props.summary, props.message],
    () => void render(),
    {immediate: true, deep: true}
);
</script>

<style scoped>
.rmp {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.rmp__hint {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}

.rmp__channels {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
}

.rmp__goes-to {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
}

.rmp__chip {
    padding: var(--space-0-5) var(--space-2);
    background: var(--color-surface-3);
    border-radius: var(--radius-full);
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
}

.rmp__card {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
}

.rmp__headline {
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.rmp__message {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-secondary);
}

.rmp__note {
    margin: 0;
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    line-height: var(--leading-normal);
}
</style>
