<template>
    <div class="sp">
        <button
            v-for="opt in options"
            :key="opt.value"
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
defineProps<{
    size: '1x1' | '2x1' | '2x2';
}>();

defineEmits<{
    change: [size: '1x1' | '2x1' | '2x2'];
}>();

const options = [
    {value: '1x1' as const, label: '1×1'},
    {value: '2x1' as const, label: '2×1'},
    {value: '2x2' as const, label: '2×2'}
];
</script>
