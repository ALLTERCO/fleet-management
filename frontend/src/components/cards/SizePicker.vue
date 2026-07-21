<template>
    <div class="sp">
        <button
            v-for="opt in options"
            :key="opt.value"
            type="button"
            class="sp-btn"
            :class="{'sp-btn--active': size === opt.value}"
            @click="$emit('change', opt.value)"
        >
            <div class="sp-grid" :class="`sp-grid--${opt.value}`">
                <div class="sp-cell sp-cell--filled" />
                <div v-if="opt.value !== '1x1'" class="sp-cell sp-cell--filled" />
                <div v-if="opt.value === '2x2'" class="sp-cell sp-cell--filled" />
                <div v-if="opt.value === '2x2'" class="sp-cell sp-cell--filled" />
            </div>
            <span class="sp-label">{{ opt.label }}</span>
        </button>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import type {CardSize} from '@/helpers/widgetCatalog';

const props = defineProps<{
    size: CardSize;
    allowedSizes?: CardSize[];
}>();

defineEmits<{
    change: [size: CardSize];
}>();

const ALL_OPTIONS = [
    {value: '1x1' as const, label: '1×1'},
    {value: '2x1' as const, label: '2×1'},
    {value: '2x2' as const, label: '2×2'}
];

// Show only the sizes the entity allows, the same cap the dashboard enforces on
// render — so the picker never offers a size that silently clamps back.
const options = computed(() => {
    const allowed = props.allowedSizes;
    return allowed
        ? ALL_OPTIONS.filter((o) => allowed.includes(o.value))
        : ALL_OPTIONS;
});
</script>
