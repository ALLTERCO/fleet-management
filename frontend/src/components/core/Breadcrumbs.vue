<template>
    <nav aria-label="Breadcrumb" class="breadcrumbs flex items-center gap-1 text-xs font-mono px-1 py-1.5">
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
import {RouterLink, useRoute} from 'vue-router';

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
        // `in` preserves explicit null (means: hide this segment).
        // `??` would treat null as nullish and fall through.
        const override =
            path in props.overrides
                ? props.overrides[path]
                : seg in props.overrides
                    ? props.overrides[seg]
                    : undefined;
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
