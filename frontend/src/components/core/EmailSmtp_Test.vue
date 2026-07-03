<template>
    <div class="est">
        <section class="est__section">
            <header class="est__section-hdr">
                <h3 class="est__section-title">Send a test</h3>
                <p class="est__section-desc">
                    Dry-run validates auth + TLS without sending anything.
                    Live send deposits a real message into the first
                    <b>To</b> recipient's inbox.
                    <span v-if="!endpointId" class="est__section-hint">
                        Save the endpoint first &mdash; the test runs against
                        the stored config.
                    </span>
                </p>
            </header>

            <div class="est__control-row">
                <Checkbox
                    v-model="liveSendModel"
                    label="Live send"
                    hint="Deliver a real test email instead of a dry-run"
                    :disabled="!endpointId"
                />
                <Button
                    type="blue"
                    :disabled="!endpointId || testing"
                    :loading="testing"
                    @click="$emit('run-test', liveSendModel)"
                >
                    {{ liveSendModel ? 'Send test email' : 'Run dry-run' }}
                </Button>
            </div>

            <div
                v-if="result"
                class="est__result"
                :class="result.state === 'success'
                    ? 'est__result--ok'
                    : 'est__result--err'"
            >
                <i
                    class="fas"
                    :class="result.state === 'success'
                        ? 'fa-circle-check'
                        : 'fa-circle-xmark'"
                />
                <div class="est__result-body">
                    <div class="est__result-headline">
                        {{ result.state === 'success'
                            ? 'Test succeeded'
                            : 'Test failed' }}
                        <span class="est__result-ts">
                            {{ formatTestedAt(result.testedAt) }}
                        </span>
                    </div>
                    <p v-if="result.errorMessage" class="est__result-error">
                        {{ result.errorMessage }}
                    </p>
                </div>
            </div>
            <div v-else-if="endpointId" class="est__result est__result--idle">
                <i class="fas fa-clock" />
                <div class="est__result-body">
                    <div class="est__result-headline">No test run yet</div>
                    <p class="est__result-error">
                        Click <b>Run dry-run</b> to verify the credentials
                        without sending anything.
                    </p>
                </div>
            </div>
        </section>
    </div>
</template>

<script setup lang="ts">
import type {ChannelTestResult} from '@api/channel';
import {ref} from 'vue';
import Button from '@/components/core/Button.vue';
import Checkbox from '@/components/core/Checkbox.vue';

const props = defineProps<{
    endpointId?: number | null;
    testing: boolean;
    result: ChannelTestResult | null;
}>();

defineEmits<{'run-test': [liveSend: boolean]}>();

const liveSendModel = ref(false);

function formatTestedAt(iso: string): string {
    try {
        return new Date(iso).toLocaleTimeString();
    } catch {
        return iso;
    }
}

// Keep reference to prevent unused-var warnings in template type check
void props;
</script>

<style scoped>
.est {
    display: flex;
    flex-direction: column;
    gap: var(--form-section-gap);
}

.est__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.est__section-hdr {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}

.est__section-title {
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.est__section-desc {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    line-height: 1.45;
    max-width: 64ch;
}

.est__section-hint {
    display: block;
    margin-top: var(--space-1);
    color: var(--color-warning-text);
}

.est__control-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
    padding: var(--space-3);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-md);
}

.est__result {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    border: 1px solid transparent;
}

.est__result--ok {
    background: var(--color-success-subtle);
    color: var(--color-success-text);
    border-color: var(--color-success);
}

.est__result--err {
    background: var(--color-danger-subtle);
    color: var(--color-danger-text);
    border-color: var(--color-danger);
}

.est__result--idle {
    background: var(--color-surface-1);
    color: var(--color-text-tertiary);
    border-color: var(--color-border-medium);
}

.est__result > i {
    margin-top: var(--space-0-5);
    font-size: var(--icon-size-md);
    flex-shrink: 0;
}

.est__result-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
}

.est__result-headline {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
}

.est__result-ts {
    font-weight: var(--font-normal);
    opacity: 0.75;
}

.est__result-error {
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-normal);
    line-height: 1.5;
    word-break: break-word;
}
</style>
