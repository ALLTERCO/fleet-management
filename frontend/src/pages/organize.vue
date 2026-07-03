<template>
    <div class="h-full flex flex-col organize-page">
        <h2 class="sr-only">Organize</h2>
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
import {ORGANIZE_PATH} from '@/constants';
import {useAuthStore} from '@/stores/auth';
import type {RouteTab} from '@/types/page-template';

const authStore = useAuthStore();

const baseTabs: RouteTab[] = [
    {
        label: 'Locations',
        path: '/organize/locations',
        icon: 'fas fa-location-dot'
    },
    {label: 'Groups', path: '/organize/groups', icon: 'fas fa-folder-tree'},
    {label: 'Tags', path: '/organize/tags', icon: 'fas fa-tag'}
];

const organizeTabs = computed<RouteTab[]>(() =>
    baseTabs.filter((tab) => canAccessPage(tab.path, authStore))
);

provide('organizeTabs', organizeTabs);
</script>

<style scoped>
.organize-page {
    padding: 0;
}
</style>
