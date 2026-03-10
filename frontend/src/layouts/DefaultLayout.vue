<template>
    <BasicLayout>
        <a href="#main-content" class="skip-to-content">Skip to content</a>
        <div class="flex flex-row">
            <SideMenu />
            <div id="main-content" class="pt-2 px-2 flex-grow max-h-screen overflow-y-auto overflow-x-hidden" tabindex="-1">
                <slot />
            </div>
            <RightSideMenu
                v-if="!rightSideStore.detached"
                class="w-[500px] max-w-full mt-5 h-[calc(100vh-1.25rem)] z-20"
            />
        </div>
        <!-- Modal background -->
        <div v-if="active" class="layout-overlay fixed top-0 left-0 w-screen h-screen z-10" @click="bgClicked" />
        <!-- Expanded right side -->
        <Modal
            v-if="rightSideStore.detached"
            :visible="!!rightSideStore.component"
            @close="rightSideStore.clearActiveComponent()"
        >
            <template #title> Control device </template>
            <template #default>
                <component :is="rightSideStore.component" v-bind="rightSideStore.props" />
            </template>
        </Modal>
    </BasicLayout>
</template>

<script setup lang="ts">
import {computed, onMounted, onUnmounted} from 'vue';
import Modal from '@/components/modals/Modal.vue';
import RightSideMenu from '@/components/RightSideMenu.vue';
import SideMenu from '@/components/SideMenu.vue';
import BasicLayout from '@/layouts/BasicLayout.vue';
import {useRightSideMenuStore} from '@/stores/right-side';

const rightSideStore = useRightSideMenuStore();

const active = computed(() => {
    return rightSideStore.mobileVisible;
});

function handleEscape(event: KeyboardEvent) {
    if (event.key === 'Escape') {
        bgClicked();
    }
}

onMounted(() => {
    document.addEventListener('keydown', handleEscape);
});

onUnmounted(() => {
    document.removeEventListener('keydown', handleEscape);
});

function bgClicked() {
    if (!active.value) return;
    rightSideStore.clearActiveComponent();
}
</script>

<!-- <style>
* {
    outline: 1px solid purple;
}
</style> -->

<style scoped>
.skip-to-content {
    position: absolute;
    left: -9999px;
    top: 0;
    z-index: var(--z-tooltip);
    padding: var(--space-2) var(--space-4);
    background-color: var(--color-primary);
    color: var(--color-text-primary);
    border-radius: 0 0 var(--radius-md) 0;
    font-weight: var(--font-semibold);
}
.skip-to-content:focus {
    left: 0;
}
.layout-overlay {
    background-color: var(--color-overlay);
}
</style>
