<template>
    <main>
        <SessionBootScreen v-if="showBootScreen" />
        <DefaultLayout v-else-if="!isBasicLayout">
            <ErrorBoundary>
                <router-view v-slot="{ Component }">
                    <Transition name="page" :duration="160">
                        <component :is="Component" :key="$route.matched[0]?.path" />
                    </Transition>
                </router-view>
            </ErrorBoundary>
        </DefaultLayout>
        <BasicLayout v-else>
            <router-view />
        </BasicLayout>
        <Toast />
        <HeatmapOverlay />
    </main>
</template>

<script setup lang="ts">
import {computed, defineAsyncComponent, onMounted, onUnmounted, watch} from 'vue';
import {useRoute} from 'vue-router';
import ErrorBoundary from '@/components/core/ErrorBoundary.vue';
import SessionBootScreen from '@/components/core/SessionBootScreen.vue';
import Toast from '@/components/core/Toast.vue';
import {
    applyBackgroundStyle,
    backgroundStyleState
} from '@/helpers/backgroundAssets';
import BasicLayout from '@/layouts/BasicLayout.vue';
import DefaultLayout from '@/layouts/DefaultLayout.vue';
import {useAuthStore} from '@/stores/auth';
import {useDevicesStore} from '@/stores/devices';
import {useGeneralStore} from '@/stores/general';
import {useJobsStore} from '@/stores/jobs';
import {useNavStore} from '@/stores/nav';
import {useScopeModelStore} from '@/stores/scopeModel';
import {debugWarn} from '@/tools/debug';
import {getObsLevel, trackClick} from '@/tools/observability';
import {setPreloadedRpc} from '@/tools/websocket';

const HeatmapOverlay = defineAsyncComponent(
    () => import('@/components/core/HeatmapOverlay.vue')
);

// Kiosk mode — activate via ?kiosk=1 URL parameter
if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    if (params.get('kiosk') === '1') {
        document.body.classList.add('kiosk');
    }
}

// Pause all CSS animations when tab is hidden to save CPU/battery.
// Lifecycle-bound so HMR / test mounts don't stack listeners.
function onVisibilityChange() {
    document.body.classList.toggle('tab-hidden', document.hidden);
}
onMounted(() => document.addEventListener('visibilitychange', onVisibilityChange));
onUnmounted(() =>
    document.removeEventListener('visibilitychange', onVisibilityChange)
);

const generalStore = useGeneralStore();
const authStore = useAuthStore();
const scopeModelStore = useScopeModelStore();
const navStore = useNavStore();
const route = useRoute();

// Layout = route.meta.layout. Auth-state flips no longer trigger a swap.
const isBasicLayout = computed(() => route.meta?.layout === 'basic');

// Default-deny: render the authenticated layout only with positive proof.
const showBootScreen = computed(
    () => !isBasicLayout.value && authStore.status !== 'authenticated'
);

// ── Global click listener for heatmap data (Tier 2+) ──
function onGlobalClick(e: MouseEvent) {
    if (getObsLevel() >= 2) trackClick(e, route.path);
}
onMounted(() => document.addEventListener('click', onGlobalClick, true));
onUnmounted(() => document.removeEventListener('click', onGlobalClick, true));

watch(
    () => generalStore.background,
    (newValue) => {
        applyBackgroundStyle({
            state: backgroundStyleState(newValue),
            style: document.documentElement.style
        });
    },
    {immediate: true}
);

// Only fetch UI settings after WebSocket is connected and permissions are loaded.
// authStore.permissionsLoaded becomes true AFTER handleLoginChanged() completes
// (which awaits ws.connect() + fetchUserPermissions()), so the websocket is
// guaranteed to be open by the time generalStore.setup() issues RPC calls.
const devicesStore = useDevicesStore();
const jobsStore = useJobsStore();
watch(
    () => authStore.permissionsLoaded,
    (loaded) => {
        if (loaded) {
            generalStore.setup();
            void scopeModelStore.fetch();
            void navStore.init();
            // Seed devices store from launch bootstrap for instant first paint;
            // pages still call fetchDevices() for the full chunked list.
            const items = authStore.launchBootstrap?.devices?.items;
            if (items && Array.isArray(items)) {
                devicesStore.seedFromBootstrap(items as never[]);
            }
            // Prime the WaitingRoom.GetPending RPC cache so the page renders
            // instantly without firing its own first-paint RPC.
            const pending = authStore.launchBootstrap?.waitingRoom?.pending;
            if (pending && Object.keys(pending).length > 0) {
                setPreloadedRpc('WaitingRoom.GetPending', pending);
            }
            restoreActiveJobsSafely();
        } else {
            // Logout / user switch — drop per-user nav cache so next login refetches.
            navStore.reset();
            jobsStore.clear();
        }
    },
    {immediate: true}
);

async function restoreActiveJobsSafely(): Promise<void> {
    try {
        await jobsStore.restoreActive();
    } catch (error) {
        debugWarn('[jobs] active restore failed:', error);
    }
}
</script>
