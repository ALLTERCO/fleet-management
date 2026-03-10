<template>
    <div class="h-full flex flex-col">
        <h1 class="text-lg font-semibold mb-1">Devices</h1>
        <TabPageSelector :tabs="visibleTabs" />
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import TabPageSelector from '@/components/core/TabPageSelector.vue';
import {useAuthStore} from '@/stores/auth';

const authStore = useAuthStore();

const allTabs: Array<{
    label: string;
    path: string;
    icon: string;
    component?: string;
    requiresExecute?: boolean;
}> = [
    {label: 'Devices', path: '/devices', icon: 'fas fa-microchip'},
    {label: 'Entities', path: '/devices/entities', icon: 'fas fa-cube'},
    {label: 'Groups', path: '/devices/groups', icon: 'fas fa-layer-group'},
    // Removed for now, bc we are foxusing on SaaS
    // { label: 'Discovered', path: '/devices/discovered', icon: 'fas fa-radar' },
    {
        label: 'Waiting Room',
        path: '/devices/waiting-room',
        icon: 'fas fa-hourglass-half',
        component: 'waiting_room'
    },
    {label: 'Firmware', path: '/devices/firmware', icon: 'fas fa-download', requiresExecute: true},
    {label: 'Backups', path: '/devices/backups', icon: 'fas fa-box-archive', requiresExecute: true}
];

const visibleTabs = computed<[string, string, string][]>(() => {
    return allTabs
        .filter((tab) => {
            // If no component specified and no execute required, always show
            if (!tab.component && !tab.requiresExecute) return true;
            // Check if user can read this component
            if (tab.component)
                return authStore.canReadComponent(tab.component as any);
            // Check if user has execute permission for devices
            if (tab.requiresExecute) return authStore.canExecuteActions();
            return true;
        })
        .map((tab) => [tab.label, tab.path, tab.icon]);
});
</script>
