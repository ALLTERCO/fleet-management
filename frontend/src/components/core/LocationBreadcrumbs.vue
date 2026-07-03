<template>
    <nav class="lbc" aria-label="Location breadcrumb">
        <ol class="lbc__list">
            <li v-for="(item, idx) in items" :key="item.id" class="lbc__item">
                <RouterLink
                    v-if="idx < items.length - 1"
                    :to="`/organize/locations/${item.id}`"
                    class="lbc__link"
                >
                    {{ item.name }}
                </RouterLink>
                <span v-else class="lbc__current" aria-current="page">
                    {{ item.name }}
                </span>
                <i
                    v-if="idx < items.length - 1"
                    class="fas fa-chevron-right lbc__sep"
                    aria-hidden="true"
                />
            </li>
        </ol>
    </nav>
</template>

<script setup lang="ts">
import type {LocationBreadcrumbEntry} from '@api/location';
import {RouterLink} from 'vue-router';

defineProps<{items: LocationBreadcrumbEntry[]}>();
</script>

<style scoped>
.lbc__list {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    list-style: none;
    padding: 0;
    margin: 0;
}
.lbc__item {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--type-body);
}
.lbc__link {
    color: var(--color-text-tertiary);
    text-decoration: none;
}
.lbc__link:hover {
    color: var(--color-text-primary);
}
.lbc__link:hover, .lbc__link:focus-visible {
    text-decoration: underline;
}
.lbc__current {
    color: var(--color-text-primary);
    font-weight: 600;
}
.lbc__sep {
    color: var(--color-text-disabled);
    font-size: var(--type-body);
}
</style>
