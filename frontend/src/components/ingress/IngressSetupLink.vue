<template>
    <div class="ig-form">
        <p class="igsl-warn">
            <i class="fas fa-triangle-exclamation" aria-hidden="true" />
            Copy now — the token is shown only once.
            <template v-if="expiresAt"> Expires {{ expiresLabel }}.</template>
        </p>

        <div class="ig-field">
            <span>Outbound WebSocket server</span>
            <div class="igsl-row">
                <input class="igsl-text" :value="url" readonly />
                <Button type="blue-hollow" size="sm" @click="copy(url)">
                    <i class="fas fa-copy" aria-hidden="true" /> Copy
                </Button>
            </div>
            <p class="ig-hint">On the device: Outbound WebSocket → server. Enable it.</p>
        </div>

        <div v-if="token" class="ig-field">
            <span>Token</span>
            <div class="igsl-row">
                <input class="igsl-text" :value="token" readonly />
                <Button type="blue-hollow" size="sm" @click="copy(token ?? '')">
                    <i class="fas fa-copy" aria-hidden="true" /> Copy
                </Button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import Button from '@/components/core/Button.vue';
import {formatRelativeTime} from '@/helpers/relativeTime';

const props = defineProps<{
    url: string;
    token?: string;
    expiresAt?: string;
}>();

const expiresLabel = computed(() =>
    props.expiresAt ? formatRelativeTime(new Date(props.expiresAt).getTime()) : ''
);

function copy(text: string): void {
    void navigator.clipboard?.writeText(text);
}
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
.igsl-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
.igsl-text {
    flex: 1;
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: var(--glass-input);
    border: 1px solid var(--glass-border);
    color: var(--color-text-primary);
    font-family: var(--font-mono);
    font-size: var(--type-caption);
}
</style>
