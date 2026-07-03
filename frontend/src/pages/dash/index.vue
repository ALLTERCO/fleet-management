<template>
    <div v-if="!redirected" class="flex items-center justify-center p-8 text-[var(--color-text-tertiary)]">
        Loading dashboards…
    </div>
</template>

<script setup lang="ts">
import {onMounted, ref, watchEffect} from 'vue';
import {useRouter} from 'vue-router';
import {useDashboardsStore} from '@/stores/dashboards';
import {DOMAIN_TYPES} from '@/types/dashboard';

const ROUTED_TYPES = new Set<string>(['analytics', ...DOMAIN_TYPES]);

const router = useRouter();
const redirected = ref(false);
const store = useDashboardsStore();

function routeFor(dash: {id: number | string; dashboardType: string}): string {
    return ROUTED_TYPES.has(dash.dashboardType)
        ? `/dash/${dash.dashboardType}/${dash.id}`
        : `/dash/${dash.id}`;
}

onMounted(() => {
    if (Object.keys(store.dashboards).length === 0) void store.fetchAll();
});

watchEffect(() => {
    if (redirected.value) return;
    if (store.loading) return;

    const all = Object.values(store.dashboards);
    if (all.length === 0) return;

    // Numeric IDs sort numerically; non-numeric (plugin UUIDs) fall back to
    // localeCompare so a NaN doesn't make the picked dashboard unpredictable.
    const first = all.sort((a, b) => {
        const an = Number(a.id);
        const bn = Number(b.id);
        if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
        return String(a.id).localeCompare(String(b.id));
    })[0];
    redirected.value = true;
    router.replace(routeFor(first));
});
</script>
