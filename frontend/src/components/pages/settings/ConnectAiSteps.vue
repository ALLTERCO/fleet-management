<template>
    <div class="cai-steps-block">
        <p v-if="block.blocked" class="cai-steps-block__blocked" role="note">
            <i class="fas fa-circle-info" aria-hidden="true" />
            <span>{{ block.blocked }}</span>
        </p>
        <ol v-if="block.steps.length" class="cai-steps-block__steps">
            <li v-for="step in block.steps" :key="step">{{ step }}</li>
        </ol>
        <div v-if="block.snippet" class="cai-snippet">
            <div class="cai-snippet__head">
                <span class="cai-snippet__label">
                    {{ block.snippet.label }}
                </span>
                <CopyButton
                    :text="block.snippet.text"
                    label="Copy"
                    :title="`Copy ${block.snippet.label}`"
                />
            </div>
            <pre class="cai-snippet__code"><code>{{ block.snippet.text }}</code></pre>
        </div>
        <p v-if="block.after" class="cai-steps-block__after">
            {{ block.after }}
        </p>
        <p v-if="block.caveat" class="cai-steps-block__caveat" role="note">
            <i class="fas fa-triangle-exclamation" aria-hidden="true" />
            <span>{{ block.caveat }}</span>
        </p>
    </div>
</template>

<script setup lang="ts">
import CopyButton from '@/components/core/CopyButton.vue';

export interface ConnectAiStepBlock {
    steps: string[];
    snippet?: {label: string; text: string};
    after?: string;
    // Set when this way cannot work for the client; shown instead of steps.
    blocked?: string;
    // Set when the client's docs do not confirm a step.
    caveat?: string;
}

defineProps<{block: ConnectAiStepBlock}>();
</script>

<style scoped>
.cai-steps-block {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.cai-steps-block__steps {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding-left: var(--space-6);
    list-style: decimal;
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    line-height: var(--leading-normal);
}
.cai-steps-block__blocked,
.cai-steps-block__caveat {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    margin: 0;
    color: var(--color-warning-text);
    font-size: var(--type-body);
    line-height: var(--leading-normal);
}
.cai-steps-block__after {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--type-body);
}

.cai-snippet {
    border: var(--space-px) solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
    overflow: hidden;
}
.cai-snippet__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-sm);
    padding: var(--space-2) var(--space-3);
    border-bottom: var(--space-px) solid var(--divider-hairline);
    background: var(--color-surface-2);
}
.cai-snippet__label {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-caps);
}
.cai-snippet__code {
    margin: 0;
    padding: var(--space-3);
    color: var(--color-text-primary);
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    line-height: var(--leading-normal);
    white-space: pre-wrap;
    word-break: break-all;
}
</style>
