<template>
    <div class="h-full flex flex-col">
        <h2 class="sr-only">Automations</h2>
        <RouterView v-slot="{Component}">
            <Transition name="tab-fade">
                <component :is="Component" :key="$route.path" />
            </Transition>
        </RouterView>
    </div>
</template>

<script setup lang="ts">
import {computed, provide} from 'vue';
import {canAccessPage} from '@/auth/pageAccess';
import {NODE_RED_ENABLED} from '@/constants';
import {useAuthStore} from '@/stores/auth';
import {useSystemStore} from '@/stores/system';
import type {RouteTab} from '@/types/page-template';

const authStore = useAuthStore();
const systemStore = useSystemStore();
// Grafana gates on runtime config (not a build flag) like the nav did.
const grafanaEnabled = computed(() => {
    const cfg = systemStore.config.grafana;
    return Boolean(cfg && Object.keys(cfg).length > 0);
});

const allTabs = computed<RouteTab[]>(() => [
    {label: 'Actions', path: '/automations/actions', icon: 'fas fa-bolt'},
    {
        label: 'Variables',
        path: '/automations/variables',
        icon: 'fas fa-dollar-sign'
    },
    ...(NODE_RED_ENABLED
        ? [
              {
                  label: 'Node-RED',
                  path: '/automations/node-red',
                  icon: 'fas fa-diagram-project'
              }
          ]
        : []),
    ...(grafanaEnabled.value
        ? [
              {
                  label: 'Grafana',
                  path: '/automations/grafana',
                  icon: 'fas fa-chart-mixed'
              }
          ]
        : [])
]);

const automationsTabs = computed<RouteTab[]>(() =>
    allTabs.value.filter((tab) => canAccessPage(tab.path, authStore))
);

provide('automationsTabs', automationsTabs);
</script>
