<template>
    <div class="rcv">
        <p class="rcv__plain">{{ plain }}</p>

        <details v-if="hasConfig" class="rcv__raw">
            <summary class="rcv__raw-summary">Show raw config</summary>
            <pre class="rcv__json">{{ rawJson }}</pre>
        </details>
    </div>
</template>

<script setup lang="ts">
import type {AlertRuleKind} from '@api/alert';
import {computed} from 'vue';
import {describeRuleConfig} from '@/helpers/ruleSentence';

const props = defineProps<{
    kind: AlertRuleKind;
    config: Record<string, unknown>;
}>();

const plain = computed(() => describeRuleConfig(props.kind, props.config));
const hasConfig = computed(() => Object.keys(props.config).length > 0);
const rawJson = computed(() => JSON.stringify(props.config, null, 2));
</script>

<style scoped>
.rcv {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.rcv__plain {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-primary);
}

.rcv__raw-summary {
    cursor: pointer;
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

.rcv__raw-summary:hover {
    color: var(--color-text-secondary);
}

.rcv__json {
    margin: var(--space-2) 0 0;
    padding: var(--space-3);
    background: var(--color-surface-0);
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    line-height: var(--leading-normal);
    white-space: pre-wrap;
    overflow-x: auto;
}
</style>
