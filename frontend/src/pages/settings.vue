<template>
    <div class="h-full flex flex-col settings-page">
        <h2 class="sr-only">Settings</h2>
        <RouterView v-slot="{Component}">
            <Transition name="tab-fade">
                <component :is="Component" :key="$route.path" />
            </Transition>
        </RouterView>
    </div>
</template>

<script setup lang="ts">
import {computed, provide} from 'vue';
import {useRoute} from 'vue-router';
import {canAccessPage} from '@/auth/pageAccess';
import {PROFILE_PATH, SETTINGS_PATH} from '@/constants';
import {useAuthStore} from '@/stores/auth';
import type {RouteTab} from '@/types/page-template';

// Tabs are rendered by PageTemplate inside each sub-page. We provide a single
// `settingsTabs` list whose contents depend on the active route:
//   - Inside the access section → "← Settings" (back to App) + the secondary
//     access tabs (Users, Groups, Personas, …).
//   - Anywhere else → the primary settings tabs (App, Profile, Users &
//     Access, Plugins, Configurations).

const ACCESS_LANDING = '/settings/users';
const ACCESS_ROUTES = new Set<string>([
    '/settings/users',
    '/settings/user-groups',
    '/settings/personas',
    '/settings/authz-simulator',
    '/settings/identity-policies',
    '/settings/identity-smtp'
]);

const GENERAL: RouteTab = {
    label: 'General',
    path: SETTINGS_PATH,
    icon: 'fas fa-cog'
};
const USER_SETTINGS: RouteTab = {
    label: 'User Settings',
    path: PROFILE_PATH,
    icon: 'fas fa-user-cog'
};
const USERS_ACCESS: RouteTab = {
    label: 'Users & Access',
    path: ACCESS_LANDING,
    icon: 'fas fa-users'
};
const PLUGINS: RouteTab = {
    label: 'Plugins',
    path: '/settings/plugins',
    icon: 'fas fa-puzzle-piece'
};
const CONFIGURATIONS: RouteTab = {
    label: 'Configurations',
    path: '/settings/configurations',
    icon: 'fas fa-wrench'
};
const API_REFERENCE: RouteTab = {
    label: 'API Reference',
    path: '/api/docs',
    icon: 'fas fa-code',
    external: true
};

// Inside Users & Access. First entry is the explicit way back to Settings.
const SECONDARY_BASE: RouteTab[] = [
    {label: 'Settings', path: SETTINGS_PATH, icon: 'fas fa-arrow-left'},
    {label: 'Users', path: '/settings/users', icon: 'fas fa-users'},
    {
        label: 'Groups',
        path: '/settings/user-groups',
        icon: 'fas fa-user-friends'
    },
    {label: 'Personas', path: '/settings/personas', icon: 'fas fa-id-badge'}
];

const IDENTITY_POLICIES_TAB: RouteTab = {
    label: 'Identity Policies',
    path: '/settings/identity-policies',
    icon: 'fas fa-id-card-clip'
};
const IDENTITY_SMTP_TAB: RouteTab = {
    label: 'Identity SMTP',
    path: '/settings/identity-smtp',
    icon: 'fas fa-envelope'
};

const route = useRoute();
const authStore = useAuthStore();

const inAccessSection = computed(() => ACCESS_ROUTES.has(route.path));

function visibleTabs(tabs: RouteTab[]): RouteTab[] {
    return tabs.filter((tab) => canAccessPage(tab.path, authStore));
}

// Tabs are filtered through the same page-access registry as router/nav.
const settingsTabs = computed<RouteTab[]>(() => {
    if (inAccessSection.value) {
        return visibleTabs([
            ...SECONDARY_BASE,
            {
                label: 'Simulator',
                path: '/settings/authz-simulator',
                icon: 'fas fa-bolt'
            },
            IDENTITY_POLICIES_TAB,
            IDENTITY_SMTP_TAB
        ]);
    }
    return visibleTabs([
        GENERAL,
        USER_SETTINGS,
        USERS_ACCESS,
        PLUGINS,
        CONFIGURATIONS,
        API_REFERENCE
    ]);
});

provide('settingsTabs', settingsTabs);
</script>

<style scoped>
.settings-page {
    padding: 0;
}
</style>
