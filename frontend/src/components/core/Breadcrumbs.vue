<template>
    <!-- Breadcrumbs hidden — re-enable by removing v-if="false" -->
    <nav v-if="false" aria-label="Breadcrumb" class="breadcrumbs flex items-center gap-1 text-xs font-mono px-1 py-1.5">
        <template v-for="(crumb, i) in crumbs" :key="crumb.path">
            <span v-if="i > 0" class="breadcrumb-sep" aria-hidden="true">/</span>
            <RouterLink
                v-if="i < crumbs.length - 1"
                :to="crumb.path"
                class="breadcrumb-link"
            >{{ crumb.label }}</RouterLink>
            <span v-else class="breadcrumb-current">{{ crumb.label }}</span>
        </template>
    </nav>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {RouterLink, useRoute} from 'vue-router/auto';

const route = useRoute();

const props = withDefaults(
    defineProps<{
        overrides?: Record<string, string | null>;
    }>(),
    {
        overrides: () => ({})
    }
);

const crumbs = computed(() => {
    const segments = route.path.split('/').filter(Boolean);
    const result: {label: string; path: string}[] = [];

    let path = '';
    for (const seg of segments) {
        path += `/${seg}`;
        const override = props.overrides[path] ?? props.overrides[seg];
        // null override = skip this segment entirely
        if (override === null) continue;
        const label = override ?? formatSegment(seg);
        result.push({label, path});
    }

    return result;
});

function formatSegment(seg: string): string {
    // Convert kebab-case/snake_case to Title Case
    return seg.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
</script>

<style scoped>
.breadcrumb-sep { color: var(--color-text-disabled); }
.breadcrumb-link { color: var(--color-text-tertiary); }
.breadcrumb-link:hover { color: var(--color-text-secondary); }
.breadcrumb-current { color: var(--color-text-primary); }
</style>
