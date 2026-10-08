<template>
    <div class="rotated-pat">
        <div v-if="labelled" class="rotated-pat__head">
            <span class="rotated-pat__name">{{ name || 'Unnamed token' }}</span>
            <span class="rotated-pat__replaced">
                Replaced key ID {{ replacedTokenId }}
            </span>
        </div>
        <SecretReveal :token="token" copy-label="Copy" @copy="copy" />
    </div>
</template>

<script setup lang="ts">
import SecretReveal from '@/components/core/SecretReveal.vue';
import {useToastStore} from '@/stores/toast';

// The new value of one rotated API key, shown once. Labelled only when it is
// not shown inside its own list entry.
const props = defineProps<{
    token: string;
    replacedTokenId: string;
    name?: string;
    labelled?: boolean;
}>();

const toastStore = useToastStore();

function copy() {
    navigator.clipboard
        .writeText(props.token)
        .then(() => toastStore.success('Token copied'))
        .catch(() => toastStore.error('Copy failed'));
}
</script>

<style scoped>
.rotated-pat {
    display: flex;
    flex-direction: column;
    gap: var(--gap-xs);
    padding: var(--gap-sm);
    border: 1px solid rgba(var(--color-primary-rgb), 0.18);
    border-radius: var(--radius-md);
    background: rgba(var(--color-primary-rgb), 0.06);
}
.rotated-pat__head {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
}
.rotated-pat__name {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
}
.rotated-pat__replaced {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--color-text-quaternary);
    overflow-wrap: anywhere;
}
</style>
