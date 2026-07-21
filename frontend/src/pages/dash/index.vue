<template>
    <div v-if="!redirected" class="flex items-center justify-center p-8 text-[var(--color-text-tertiary)]">
        Loading dashboards…
    </div>
</template>

<script setup lang="ts">
import {onMounted, ref, watch} from 'vue';
import {useRouter} from 'vue-router';
import {type Dashboard, useDashboardsStore} from '@/stores/dashboards';
import {DOMAIN_TYPES} from '@/types/dashboard';

const ROUTED_TYPES = new Set<string>([...DOMAIN_TYPES]);

const router = useRouter();
const store = useDashboardsStore();

// This index route is the single owner of "where does /dash land". No other
// component redirects off /dash. `redirected` blocks a second navigation;
// `resolving` guards the async getDefault() window against re-entry.
const redirected = ref(false);
const resolving = ref(false);

function routeFor(dash: {id: number | string; dashboardType: string}): string {
    return ROUTED_TYPES.has(dash.dashboardType)
        ? `/dash/${dash.dashboardType}/${dash.id}`
        : `/dash/${dash.id}`;
}

// Numeric IDs sort numerically; non-numeric (plugin UUIDs) fall back to
// localeCompare so a NaN doesn't make the picked dashboard unpredictable.
function firstOf(all: Dashboard[]): Dashboard | undefined {
    return [...all].sort((a, b) => {
        const an = Number(a.id);
        const bn = Number(b.id);
        if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
        return String(a.id).localeCompare(String(b.id));
    })[0];
}

// Resolve order: backend-configured default → first dashboard → empty state
// (stay on /dash). With no dashboards we return without arming `resolving`, so
// the watch retries once dashboards arrive.
async function resolveLanding(): Promise<void> {
    if (redirected.value || resolving.value) return;
    if (store.loading) return;
    if (Object.keys(store.dashboards).length === 0) return;

    resolving.value = true;
    const defaultId = await store.getDefault();
    if (redirected.value) return;

    const def = defaultId != null ? store.dashboards[defaultId] : undefined;
    const target = def ?? firstOf(Object.values(store.dashboards));
    if (!target) {
        resolving.value = false;
        return;
    }
    redirected.value = true;
    router.replace(routeFor(target));
}

onMounted(() => {
    if (Object.keys(store.dashboards).length === 0) void store.fetchAll();
});

watch(
    () => [store.loading, Object.keys(store.dashboards).length] as const,
    () => void resolveLanding(),
    {immediate: true}
);
</script>
