<template>
    <div class="h-full flex flex-col">
        <h2 class="sr-only">Operations</h2>
        <RouterView v-slot="{Component}">
            <Transition name="tab-fade">
                <component :is="Component" :key="$route.path" />
            </Transition>
        </RouterView>
    </div>
</template>

<script setup lang="ts">
import {provide} from 'vue';
import type {RouteTab} from '@/types/page-template';

const operationsTabs: RouteTab[] = [
    {label: 'Firmware', path: '/operations/firmware', icon: 'fas fa-microchip'},
    {label: 'Backups', path: '/operations/backups', icon: 'fas fa-box-archive'},
    {label: 'Jobs', path: '/operations/jobs', icon: 'fas fa-list-check'},
    {
        label: 'Device Auth',
        path: '/operations/device-auth',
        icon: 'fas fa-key'
    }
];

provide('operationsTabs', operationsTabs);
</script>
