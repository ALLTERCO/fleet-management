<template>
    <main class="fm-client-shell">
        <ErrorBoundary>
            <router-view />
        </ErrorBoundary>
        <Toast />
    </main>
</template>

<script setup lang="ts">
import ErrorBoundary from '@/components/core/ErrorBoundary.vue';
import Toast from '@/components/core/Toast.vue';
</script>
