<template>
    <router-link v-if="to" :to="to" class="ops-job__open">
        Open <i class="fas fa-arrow-up-right-from-square" />
    </router-link>
</template>

<script setup lang="ts">
// A job whose kind this build has no page for gets no link, rather than a link
// to nowhere. The check lives here so the optional route has one place where it
// is actually narrowed — at a call site the compiler cannot follow `v-if` back
// through a function call, which is what invites a "trust me" assertion.
defineProps<{to?: string}>();
</script>

<style scoped>
.ops-job__open {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-height: var(--btn-h-sm);
    padding: 0 var(--space-3);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    color: var(--color-primary);
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
    text-decoration: none;
    margin-left: var(--space-2);
    transition: background-color var(--motion-hover);
}

.ops-job__open:hover {
    background: var(--state-hover-bg);
}

.ops-job__open:hover,
.ops-job__open:focus-visible {
    text-decoration: underline;
}
</style>
