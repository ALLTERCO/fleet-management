<template>
    <RouterView v-slot="{Component}">
        <Transition name="tab-fade">
            <component :is="Component" :key="$route.path" />
        </Transition>
    </RouterView>
</template>

<script setup lang="ts">
import {computed, provide} from 'vue';
import type {RouteTab} from '@/types/page-template';

// One security area: token bookkeeping, device credentials, PKI. The
// pages share the sub-tab row; the settings sidebar holds the entry.
const deviceAuthTabs = computed<RouteTab[]>(() => [
    {label: 'Tokens', path: '/settings/security'},
    {label: 'Credentials', path: '/settings/security/credentials'},
    {label: 'Certificates', path: '/settings/security/certificates'}
]);

provide('deviceAuthTabs', deviceAuthTabs);
</script>
