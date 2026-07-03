<template>
    <div class="h-full flex flex-col alerts-page">
        <h2 class="sr-only">Alerts</h2>
        <RouterView v-slot="{ Component }">
            <Transition name="tab-fade">
                <component :is="Component" :key="$route.path" />
            </Transition>
        </RouterView>
    </div>
</template>

<script setup lang="ts">
import {computed, provide} from 'vue';
import {canAccessPage} from '@/auth/pageAccess';
import {useAuthStore} from '@/stores/auth';
import type {RouteTab} from '@/types/page-template';

// 4 tabs:
// - Alerts is the single alert-instances list at /alerts (Active by default,
//   Active/Resolved toggle + filters inside). No "Mine | All" mode — "mine"
//   is just a filter and the list is already permission-scoped.
// - Channels unites Destinations + Integrations (toggle inside page)
// - Templates is the message-template library (per-provider tabs inside)
// - Deliveries is now a drill-down inside /alerts/[id]
const authStore = useAuthStore();

const allAlertTabs: RouteTab[] = [
    {label: 'Alerts', path: '/alerts', icon: 'fas fa-bolt'},
    {label: 'Rules', path: '/alerts/rules', icon: 'fas fa-sliders'},
    {label: 'Channels', path: '/alerts/channels', icon: 'fas fa-bullhorn'},
    {
        label: 'Templates',
        path: '/alerts/templates',
        icon: 'fas fa-envelope-open-text'
    }
];

const alertTabs = computed<RouteTab[]>(() =>
    allAlertTabs.filter((tab) => canAccessPage(tab.path, authStore))
);

provide('alertTabs', alertTabs);
</script>

<style scoped>
.alerts-page {
    padding: 0;
}
</style>
