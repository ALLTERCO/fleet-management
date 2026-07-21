<template>
    <div ref="rootRef" class="mp">
        <slot name="trigger" :open="open" :toggle="toggle" :close="close" />
        <FloatingPanel
            :open="open"
            :anchor="rootRef"
            :placement="placement"
            :offset="4"
            :panel-class="`floating-panel--glass overflow-hidden ${panelClass}`"
            @close="close"
        >
            <div class="mp__menu" role="menu">
                <slot :close="close" />
            </div>
        </FloatingPanel>
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import FloatingPanel from '@/components/core/FloatingPanel.vue';

const props = withDefaults(
    defineProps<{
        align?: 'left' | 'right';
        /** Extra class on the floating panel (it teleports to body, so
         *  scoped styles cannot reach it). */
        panelClass?: string;
    }>(),
    {align: 'right', panelClass: ''}
);

const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);

const placement = computed(() =>
    props.align === 'left' ? 'bottom-start' : 'bottom-end'
);

function toggle() {
    open.value = !open.value;
}

function close() {
    open.value = false;
}

defineExpose({close});
</script>

<style scoped>
.mp {
    position: relative;
    display: inline-block;
}
.mp__menu {
    display: flex;
    flex-direction: column;
    min-width: var(--floating-w-xs);
}
</style>
