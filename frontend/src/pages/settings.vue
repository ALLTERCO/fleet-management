<template>
    <div>
        <h1 class="text-lg font-semibold mb-1">Settings</h1>
        <TabPageSelector :tabs="displayedTabs" />
    </div>
</template>

<script setup lang="ts">
import {storeToRefs} from 'pinia';
import {computed} from 'vue';
import TabPageSelector from '@/components/core/TabPageSelector.vue';
import {useAuthStore} from '@/stores/auth';
import {useSystemStore} from '@/stores/system';

const systemStore = useSystemStore();
const {devMode} = storeToRefs(systemStore);
const authStore = useAuthStore();
const {isAdmin} = storeToRefs(authStore);

const baseTabs: [string, string, string][] = [
    ['App Settings', '/settings/app', 'fas fa-cog'],
    ['User Settings', '/settings/user', 'fas fa-user-cog'],
    ['Plugins', '/settings/plugins', 'fas fa-puzzle-piece'],
    ['Configurations', '/settings/configurations', 'fas fa-wrench'],
    ['Action Variables', '/settings/action_variables', 'fas fa-code']
];

const displayedTabs = computed(() => {
    const tabs = [...baseTabs];
    if (isAdmin.value) {
        tabs.splice(2, 0, ['Users', '/settings/users', 'fas fa-users']);
    }
    if (devMode.value) {
        tabs.splice(isAdmin.value ? 3 : 2, 0, [
            'Accounts',
            '/settings/accounts',
            'fas fa-id-card'
        ]);
    }
    return tabs;
});
</script>
