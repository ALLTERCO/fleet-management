<template>
    <div class="bps">
        <div class="bps__intro">
            <h4 class="bps__heading">Pair a sensor</h4>
            <p class="bps__subheading">
                Scan, pair, add sensors and rename — all from this gateway.
                Sensors appear in the fleet immediately after they're added.
            </p>
        </div>

        <div v-if="!gatewayId" class="bps__missing">
            <i class="fas fa-circle-info" aria-hidden="true" />
            <span>Pick a gateway in the previous step first.</span>
        </div>

        <div v-else class="bps__panel">
            <BtHomeConfig :shelly-i-d="gatewayId" />
        </div>
    </div>
</template>

<script setup lang="ts">
import BtHomeConfig from '@/components/core/BtHomeConfig.vue';

defineProps<{gatewayId: string | null}>();
</script>

<style scoped>
.bps {
    display: grid;
    gap: var(--gap-lg);
}
.bps__intro {
    display: grid;
    gap: 6px;
}
.bps__eyebrow {
    font-size: var(--type-caption);
    text-transform: uppercase;
    letter-spacing: var(--tracking-caps);
    color: var(--brand-light);
    font-weight: var(--font-semibold);
}
.bps__heading {
    margin: 0;
    font-size: var(--type-subheading);
    line-height: var(--leading-tight);
    color: var(--color-text-primary);
    font-weight: var(--font-semibold);
}
.bps__subheading {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    max-width: 56ch;
}
.bps__missing {
    display: grid;
    place-items: center;
    gap: var(--gap-xs);
    padding: var(--gap-xl);
    color: var(--color-text-secondary);
    background: var(--color-surface-2);
    border: 1px dashed var(--color-border-subtle);
    border-radius: var(--radius-md);
}
.bps__missing i {
    color: var(--brand-light);
    font-size: var(--type-subheading);
}
.bps__panel {
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    padding: var(--gap-md);
}
</style>
