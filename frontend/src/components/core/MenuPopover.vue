<template>
    <div ref="rootRef" class="mp">
        <slot name="trigger" :open="open" :toggle="toggle" :close="close" />
        <div v-if="open" class="mp__menu" :class="alignClass" role="menu">
            <slot :close="close" />
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref} from 'vue';

const props = withDefaults(
    defineProps<{
        align?: 'left' | 'right';
    }>(),
    {align: 'right'}
);

const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);

const alignClass = computed(() =>
    props.align === 'left' ? 'mp__menu--left' : 'mp__menu--right'
);

function toggle() {
    open.value = !open.value;
}

function close() {
    open.value = false;
}

function onDocClick(e: MouseEvent) {
    if (!open.value) return;
    const t = e.target as Node | null;
    if (rootRef.value && t && !rootRef.value.contains(t)) close();
}

function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && open.value) close();
}

onMounted(() => {
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onKey);
});

defineExpose({close});
</script>

<style scoped>
.mp {
    position: relative;
    display: inline-block;
}
.mp__menu {
    position: absolute;
    top: calc(100% + var(--space-1));
    z-index: 100;
    background: var(--dropdown-bg);
    backdrop-filter: var(--dropdown-filter);
    -webkit-backdrop-filter: var(--dropdown-filter);
    border: 1px solid var(--dropdown-border);
    border-radius: var(--dropdown-radius);
    box-shadow: var(--dropdown-shadow), inset 0 1px 0 var(--glass-highlight);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-width: var(--floating-w-xs);
}
.mp__menu--right {
    right: 0;
}
.mp__menu--left {
    left: 0;
}
</style>
