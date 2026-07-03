<template>
    <div class="boot-stage">
        <div class="boot-stage__glow" aria-hidden="true" />
        <section class="boot-card" role="status" aria-live="polite">
            <div class="boot-halo" aria-hidden="true">
                <Spinner size="lg" />
            </div>
            <p class="boot-title">Verifying session…</p>
        </section>
    </div>
</template>

<script setup lang="ts">
import Spinner from '@/components/core/Spinner.vue';
</script>

<style scoped>
.boot-stage {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    background: #08090b;
    color: rgba(255, 255, 255, 0.92);
    font-family: 'Instrument Sans', -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
    z-index: 9999;
}
.boot-stage__glow {
    position: absolute;
    inset: 0;
    background: radial-gradient(
        circle at 50% 40%,
        rgba(var(--color-primary-rgb), 0.12) 0%,
        rgba(var(--color-primary-rgb), 0.04) 35%,
        transparent 70%
    );
    pointer-events: none;
}
.boot-card {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-5);
    padding: var(--space-6) var(--space-8);
}
.boot-halo {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 72px;
    height: 72px;
    border-radius: 50%;
    background: radial-gradient(
        circle,
        rgba(var(--color-primary-rgb), 0.22) 0%,
        rgba(var(--color-primary-rgb), 0.06) 60%,
        transparent 100%
    );
}
.boot-title {
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    letter-spacing: -0.005em;
    color: rgba(255, 255, 255, 0.92);
}
</style>
