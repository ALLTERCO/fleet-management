<template>
    <div class="ig-form">
        <p class="igsl-warn">
            <i class="fas fa-triangle-exclamation" aria-hidden="true" />
            Copy now. The token is shown only once.
            <template v-if="expiresSentence"> {{ expiresSentence }}</template>
        </p>

        <!-- One field: the URL already carries the token, shown in full. -->
        <div class="igsl-card">
            <div class="igsl-card__head">
                <span class="igsl-card__label">Outbound WebSocket server</span>
                <Button
                    type="blue-hollow"
                    size="xs"
                    :title="copied ? 'Copied' : 'Copy link'"
                    @click="copy"
                >
                    <i
                        :class="copied ? 'fas fa-check' : 'fas fa-copy'"
                        aria-hidden="true"
                    />
                    {{ copied ? 'Copied' : 'Copy' }}
                </Button>
            </div>
            <code class="igsl-card__link">{{ url }}</code>
        </div>
        <p class="ig-hint">
            On the device: Outbound WebSocket, paste as server, enable.
        </p>
    </div>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, ref} from 'vue';
import Button from '@/components/core/Button.vue';
import {SECOND_TICK_MS, useNowTicker} from '@/composables/useNowTicker';
import {formatUntil} from '@/helpers/format';

const COPIED_RESET_MS = 2_000;

const props = defineProps<{
    url: string;
    expiresAt?: string;
}>();

const {now, release} = useNowTicker(SECOND_TICK_MS);
onBeforeUnmount(release);

const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

const expiresSentence = computed(() => {
    if (!props.expiresAt) return '';
    const label = formatUntil(props.expiresAt, now.value);
    return label === 'expired' ? 'Expired.' : `Expires ${label}.`;
});

function copy(): void {
    void navigator.clipboard?.writeText(props.url);
    copied.value = true;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
        copied.value = false;
    }, COPIED_RESET_MS);
}

onBeforeUnmount(() => {
    if (copiedTimer) clearTimeout(copiedTimer);
});
</script>

<style scoped>
.igsl-warn {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    font-size: var(--type-caption);
    color: var(--color-warning-text);
}

/* The link lives in its own card — full value, no truncation. */
.igsl-card {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
    overflow: hidden;
}
.igsl-card__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-sm);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--divider-hairline);
    background: var(--color-surface-2);
}
.igsl-card__label {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-caps);
}
.igsl-card__link {
    display: block;
    padding: var(--space-3);
    color: var(--color-text-primary);
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    line-height: var(--leading-normal);
    word-break: break-all;
    user-select: all;
}
</style>
