<template>
    <div class="page-skeleton" role="status" aria-label="Loading page">
        <!-- Heading skeleton -->
        <Skeleton variant="text" width="30%" height="1.5rem" />

        <!-- Cards variant: grid of card placeholders -->
        <div v-if="variant === 'cards'" class="page-skeleton-grid">
            <Skeleton v-for="i in count" :key="i" variant="card" />
        </div>

        <!-- Table variant: header + rows -->
        <template v-else-if="variant === 'table'">
            <Skeleton variant="row" width="100%" height="2rem" />
            <Skeleton v-for="i in count" :key="i" variant="row" />
        </template>

        <!-- Form variant: label + input pairs -->
        <template v-else-if="variant === 'form'">
            <div v-for="i in count" :key="i" class="page-skeleton-field">
                <Skeleton variant="text" width="25%" />
                <Skeleton variant="rect" height="2.5rem" />
            </div>
        </template>

        <span class="sr-only">Loading...</span>
    </div>
</template>

<script setup lang="ts">
import Skeleton from '@/components/core/Skeleton.vue';

withDefaults(
    defineProps<{
        variant?: 'cards' | 'table' | 'form';
        count?: number;
    }>(),
    {
        variant: 'cards',
        count: 6
    }
);
</script>

<style scoped>
.page-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
    min-height: 256px;
}

.page-skeleton-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: var(--space-4);
}

.page-skeleton-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
</style>
