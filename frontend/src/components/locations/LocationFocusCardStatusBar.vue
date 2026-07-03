<template>
    <div class="lsb" aria-hidden="true">
        <div class="lsb__track">
            <div
                v-if="onPct > 0"
                class="lsb__seg lsb__seg--on"
                :style="{flexBasis: `${onPct}%`}"
            />
            <div
                v-if="warnPct > 0"
                class="lsb__seg lsb__seg--warn"
                :style="{flexBasis: `${warnPct}%`}"
            />
            <div
                v-if="offPct > 0"
                class="lsb__seg lsb__seg--off"
                :style="{flexBasis: `${offPct}%`}"
            />
        </div>
        <span class="lsb__counts">
            {{ on }} on · {{ warn }} warn · {{ off }} off
        </span>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';

const props = defineProps<{
    total: number;
    on: number;
    warn: number;
    off: number;
}>();

const onPct = computed(() =>
    props.total > 0 ? (props.on / props.total) * 100 : 0
);
const warnPct = computed(() =>
    props.total > 0 ? (props.warn / props.total) * 100 : 0
);
const offPct = computed(() =>
    props.total > 0 ? (props.off / props.total) * 100 : 0
);
</script>

<style scoped>
.lsb {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}

.lsb__track {
    display: flex;
    height: 4px;
    border-radius: var(--radius-full);
    overflow: hidden;
    background: var(--state-hover-bg-strong);
}

.lsb__seg {
    height: 100%;
    transition: flex-basis 0.3s ease;
}

.lsb__seg--on {
    background: var(--color-status-on);
}

.lsb__seg--warn {
    background: var(--color-status-warn);
}

.lsb__seg--off {
    background: var(--color-status-off);
}

.lsb__counts {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    letter-spacing: 0.02em;
}
</style>
