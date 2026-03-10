<template>
    <main>
        <DefaultLayout v-if="authStore.permissionsLoaded">
            <ErrorBoundary>
                <router-view v-slot="{ Component }">
                    <Transition name="page" mode="out-in" :duration="160">
                        <component :is="Component" :key="$route.matched[0]?.path" />
                    </Transition>
                </router-view>
            </ErrorBoundary>
        </DefaultLayout>
        <BasicLayout v-else>
            <router-view />
        </BasicLayout>
        <Toast />
    </main>
</template>

<script setup lang="ts">
import {watch} from 'vue';
import ErrorBoundary from '@/components/core/ErrorBoundary.vue';
import Toast from '@/components/Toast.vue';
import {FLEET_MANAGER_HTTP} from '@/constants';
import BasicLayout from '@/layouts/BasicLayout.vue';
import DefaultLayout from '@/layouts/DefaultLayout.vue';
import {useAuthStore} from '@/stores/auth';
import {useGeneralStore} from './stores/general';

const generalStore = useGeneralStore();

const authStore = useAuthStore();

watch(
    () => generalStore.background,
    (newValue) => {
        if (!newValue || newValue === 'undefined') {
            return;
        } else if (newValue.startsWith('#')) {
            document.documentElement.style.setProperty(
                '--background-color',
                newValue
            );
            document.documentElement.style.removeProperty('--background-image');
        } else {
            // Image path — resolve relative paths to full URL using current host
            const url = newValue.startsWith('/') ? FLEET_MANAGER_HTTP + newValue : newValue;
            document.documentElement.style.setProperty(
                '--background-image',
                `url(${url})`
            );
            document.documentElement.style.removeProperty('--background-color');
        }
    },
    {immediate: true}
);

// Only fetch UI settings after WebSocket is connected and permissions are loaded.
// authStore.permissionsLoaded becomes true AFTER handleLoginChanged() completes
// (which awaits ws.connect() + fetchUserPermissions()), so the websocket is
// guaranteed to be open by the time generalStore.setup() issues RPC calls.
watch(
    () => authStore.permissionsLoaded,
    (loaded) => {
        if (loaded) {
            generalStore.setup();
        }
    },
    {immediate: true}
);
</script>

<style>
#script .background {
    background-image: v-bind('generalStore.background');
    background-color: v-bind('generalStore.background');
}
</style>
