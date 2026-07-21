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

// Navigation for the alerts pages lives in the settings sidebar — the
// sub-pages inject this for their PageTemplate; empty means no tab row.
provide('alertTabs', computed<RouteTab[]>(() => []));
</script>
