<template>
    <div class="infinite-grid-scroll-page overflow-clip relative flex flex-col h-full">
        <slot name="header" />
        <div ref="rootElement" class="overflow-y-scroll h-full">
            <slot v-if="items.length == 0" name="empty" />
            <div v-else ref="gridElem" :class="[small ? 'flex flex-col gap-2 pb-16' : 'widget-grid pb-2', customClass? customClass : '']">
                <template v-for="(item, index) in items">
                    <slot :item="item" :small="small" :item_index="index" />
                </template>
            </div>
            <div v-if="page < totalPages" class="my-4 flex justify-center h-8 pb-2">
                <Spinner />
            </div>
            <!-- Invisible sentinel — triggers load when it enters the viewport -->
            <div ref="sentinel" class="h-1" />
        </div>
    </div>
</template>

<script setup lang="ts" generic="T">
import {onMounted, onUnmounted, ref, toRefs} from 'vue';
import Spinner from '@/components/core/Spinner.vue';
import {small} from '@/helpers/ui';

const items = defineModel<T[]>('items', {required: true});
const page = defineModel<number>('page', {required: true});
const totalPages = defineModel<number>('totalPages', {required: true});
const props = defineProps<{customClass?: string}>();

const {customClass} = toRefs(props);

const emit = defineEmits<{
    'load-items': [];
}>();

const rootElement = ref<HTMLElement | null>(null);
const sentinel = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

onMounted(() => {
    if (!sentinel.value || !rootElement.value) return;
    observer = new IntersectionObserver(
        (entries) => {
            if (entries[0]?.isIntersecting && page.value < totalPages.value) {
                emit('load-items');
            }
        },
        {root: rootElement.value, rootMargin: '0px 0px 400px 0px'}
    );
    observer.observe(sentinel.value);
});

onUnmounted(() => {
    observer?.disconnect();
});

// Prevent scroll remembering
if (history.scrollRestoration) {
    history.scrollRestoration = 'manual';
}
</script>
