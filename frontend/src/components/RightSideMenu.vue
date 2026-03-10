<template>
    <Transition name="slide-fade">
        <aside
            class="right-side-menu border rounded-tl-xl rounded-bl-xl overflow-y-scroll"
            :class="myClass"
        >
            <template v-if="rightSideStore.component">
                <component :is="rightSideStore.component" v-bind="rightSideStore.props" />
            </template>
            <!-- Default -->
            <DefaultBoard v-else />
        </aside>
    </Transition>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {useRightSideMenuStore} from '@/stores/right-side';
import DefaultBoard from './boards/DefaultBoard.vue';

const rightSideStore = useRightSideMenuStore();

const active = computed(() => {
    return rightSideStore.mobileVisible;
});

const myClass = computed(() => {
    return active.value ? 'fixed right-0 max-w-[400px]' : 'hidden';
});
</script>

<style scoped>
.right-side-menu {
    border-color: var(--color-border-strong);
    background-color: var(--color-surface-2);
}

.slide-fade-enter-active,
.slide-fade-leave-active {
    transition: opacity var(--duration-fast) var(--ease-out);
}

.slide-fade-enter-from,
.slide-fade-leave-to {
    opacity: 0;
}
</style>
