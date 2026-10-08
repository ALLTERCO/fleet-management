<template>
    <p class="rra">
        Fires when <strong class="rra__part">{{ trigger }}</strong
        ><template v-if="scopeLabel">
            on <strong class="rra__part">{{ scopeLabel }}</strong></template
        ><template v-if="channelLabel">
            , notifying <strong class="rra__part">{{ channelLabel }}</strong></template
        >.
    </p>
</template>

<script setup lang="ts">
import type {AlertRuleKind} from '@api/alert';
import {computed} from 'vue';
import {describeRuleConfig} from '@/helpers/ruleSentence';

const props = defineProps<{
    kind: AlertRuleKind;
    config: Record<string, unknown>;
    /** Omit until the user has actually chosen. The sentence then states only
     *  what has been decided, instead of asserting "every device" and "nobody
     *  yet" on a step where neither has been asked. */
    scopeLabel?: string;
    channelLabel?: string;
}>();

const trigger = computed(() => describeRuleConfig(props.kind, props.config));
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
