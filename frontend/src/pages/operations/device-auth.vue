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

// Sub-tabs live next to their pages — they're operationally distinct
// (data model vs outbound jobs vs PKI material) but share the
// device-auth context, so collapsing them into one parent keeps the
// top nav lean and deep-links still work.
const deviceAuthTabs = computed<RouteTab[]>(() => [
    {label: 'Credentials', path: '/operations/device-auth'},
    {label: 'Certificates', path: '/operations/device-auth/certificates'}
]);

provide('deviceAuthTabs', deviceAuthTabs);
</script>
