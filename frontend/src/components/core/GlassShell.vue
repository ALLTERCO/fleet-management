<template>
    <section
        :class="[
            'gs',
            `gs--tier-${tier}`,
            {'gs--padded': padded, 'gs--fill': fill}
        ]"
    >
        <slot />
    </section>
</template>

<script setup lang="ts">
// Glass surface. Content-sized by default; `fill` grows to viewport.
withDefaults(
    defineProps<{
        tier?: 1 | 2 | 3 | 4 | 5;
        padded?: boolean;
        fill?: boolean;
    }>(),
    {tier: 1, padded: false, fill: false}
);
</script>

<style scoped>
.gs {
    margin: 0 var(--space-2);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-lg);
    box-shadow: inset 0 1px 0 var(--glass-highlight);
    display: flex;
    flex-direction: column;
}
.gs--fill {
    flex: 0 1 auto;
    min-height: 0;
    overflow: hidden;
}
.gs--padded {
    padding: var(--space-4);
}
.gs--padded.gs--fill {
    overflow-y: auto;
    overscroll-behavior: contain;
}
.gs--tier-1 {
    background: var(--glass-1-bg);
    backdrop-filter: var(--glass-1-filter);
    -webkit-backdrop-filter: var(--glass-1-filter);
}
.gs--tier-2 {
    background: var(--glass-2-bg);
    backdrop-filter: var(--glass-2-filter);
    -webkit-backdrop-filter: var(--glass-2-filter);
}
.gs--tier-3 {
    background: var(--glass-3-bg);
    backdrop-filter: var(--glass-3-filter);
    -webkit-backdrop-filter: var(--glass-3-filter);
}
.gs--tier-4 {
    background: var(--glass-4-bg);
    backdrop-filter: var(--glass-4-filter);
    -webkit-backdrop-filter: var(--glass-4-filter);
}
.gs--tier-5 {
    background: var(--glass-5-bg);
    backdrop-filter: var(--glass-5-filter);
    -webkit-backdrop-filter: var(--glass-5-filter);
}
@media (max-width: 640px) {
    .gs {
        margin: 0;
    }
    .gs--padded {
        padding: var(--space-3);
    }
}
</style>
