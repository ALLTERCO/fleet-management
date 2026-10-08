<template>
    <RouterView v-slot="{Component}">
        <Transition name="tab-fade">
            <component :is="Component" :key="$route.path" />
        </Transition>
    </RouterView>
</template>

<script setup lang="ts">
// One stylesheet for all six pages, loaded once here instead of in each
// of them. Navigation for these pages lives in the settings sidebar.
import '@/styles/utility-accounting.css';
</script>
