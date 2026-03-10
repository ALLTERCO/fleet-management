<template>
    <div>
        <div
            class="basic-block rounded-lg h-full"
            :class="{
                'basic-block--glass': blurred,
                'basic-block--bordered': bordered,
                'basic-block--darker': darker,
                'basic-block--default': !blurred && !darker,
                'p-4': padding === 'md',
                'p-2': padding === 'sm',
                'p-1': padding === 'xs',
            }"
        >
            <div class="flex flex-row justify-between">
            <span v-if="title" class="font-semibold">{{ title }}</span>
            <div class="flex flex-row">
                <slot name="buttons"></slot>
            </div>
            </div>
            <div :class="{ 'pt-4': titlePadding }">
                <slot />
            </div>
        </div>
        <div v-if="loading" class="relative pt-4">
            <div class="basic-block__overlay absolute top-0 left-0 !p-0 !m-0 w-full h-full z-20"></div>
            <div class="absolute top-1/2 left-1/2 !p-0 !m-0 -translate-x-1/2 -translate-y-1/2 z-50">
                <Spinner size="sm" />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import Spinner from './Spinner.vue';

type props_t = {
    title?: string;
    bordered?: boolean;
    darker?: boolean;
    loading?: boolean;
    padding?: 'xs' | 'sm' | 'md' | 'none';
    blurred?: boolean;
    titlePadding?: boolean;
};

withDefaults(defineProps<props_t>(), {
    title: '',
    bordered: false,
    padding: 'md'
});
</script>

<style scoped>
.basic-block {
    color: var(--color-text-secondary);
}
.basic-block--default {
    background-color: var(--color-surface-2);
    box-shadow: var(--shadow-md);
}
.basic-block--darker {
    background-color: var(--color-surface-1);
    box-shadow: var(--shadow-md);
}
.basic-block--glass {
    background: var(--glass-bg);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    border: 1px solid var(--glass-border);
    box-shadow: var(--glass-shadow);
}
.basic-block--bordered {
    border: 1px solid var(--color-border-default);
}
.basic-block__overlay {
    background-color: var(--color-overlay);
    border-radius: inherit;
}
</style>
