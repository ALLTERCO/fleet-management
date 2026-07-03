<template>
    <BasicLayout>
        <div class="nf">
            <span class="nf__code">404</span>
            <h1 class="nf__title">Page not found</h1>
            <p class="nf__desc">The page you're looking for doesn't exist or has been moved.</p>
            <Button type="blue" size="sm" @click="$router.push('/')">
                Go to Dashboard
            </Button>
        </div>
    </BasicLayout>
</template>

<script setup lang="ts">
import Button from '@/components/core/Button.vue';
import BasicLayout from '@/layouts/BasicLayout.vue';
</script>

<style scoped>
.nf {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    gap: var(--gap-sm);
    text-align: center;
    padding: var(--gap-md);
}
.nf__code {
    font-size: var(--type-display);
    font-weight: 700;
    color: var(--color-text-tertiary);
    line-height: 1;
}
.nf__title {
    font-size: var(--type-heading);
    font-weight: 700;
    color: var(--color-text-primary);
}
.nf__desc {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    max-width: 28rem;
}
</style>
