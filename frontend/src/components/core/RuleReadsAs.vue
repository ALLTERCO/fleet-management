<template>
    <p class="rra">
        When <strong class="rra__part">{{ trigger }}</strong>
        on <strong class="rra__part">{{ scope }}</strong>,
        notify <strong class="rra__part">{{ channel }}</strong>.
    </p>
</template>

<script setup lang="ts">
import type {AlertRuleKind} from '@api/alert';
import {computed} from 'vue';
import {describeRuleConfig} from '@/helpers/ruleSentence';

const props = defineProps<{
    kind: AlertRuleKind;
    config: Record<string, unknown>;
    scopeLabel?: string;
    channelLabel?: string;
}>();

const trigger = computed(() => describeRuleConfig(props.kind, props.config));
const scope = computed(() => props.scopeLabel || 'these devices');
const channel = computed(() => props.channelLabel || 'your channels');
</script>

<style scoped>
.rra {
    margin: 0;
    padding: var(--space-3) var(--space-4);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    line-height: var(--leading-normal);
}

.rra__part {
    color: var(--color-text-primary);
    font-weight: var(--font-semibold);
}
</style>
