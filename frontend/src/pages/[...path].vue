<template>
    <BasicLayout>
        <div class="flex flex-col items-center justify-center min-h-screen gap-4 text-center px-4">
            <span class="text-6xl font-bold text-[var(--color-text-disabled)]">404</span>
            <h1 class="text-xl font-semibold text-[var(--color-text-secondary)]">Page not found</h1>
            <p class="text-[var(--color-text-tertiary)] max-w-md">
                The page you're looking for doesn't exist or has been moved.
            </p>
            <router-link
                to="/"
                class="mt-4 px-4 py-2 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded-lg text-sm font-medium"
            >
                Go to Dashboard
            </router-link>
        </div>
    </BasicLayout>
</template>

<script setup lang="ts">
import BasicLayout from '@/layouts/BasicLayout.vue';
</script>
