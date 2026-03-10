<template>
    <div class="board-tabs relative h-full w-full rounded px-1">
        <div class="board-tabs__header px-3 h-10 w-full flex flex-row gap-2 items-center">
            <button class="board-tabs__back" @click="emit('back')">
                <i class="fas fa-arrow-left"></i>
                <slot name="backText"/>
            </button>
            <div class="flex-grow min-w-0">
                <slot name="header" />
            </div>
            <button v-if="!rightSideMenu.detached" class="board-tabs__detach hidden lg:flex" @click="rightSideMenu.detached = true">
                <i class="fa-solid fa-up-right-and-down-left-from-center"></i>
            </button>
        </div>
        <div class="board-tabs__sidebar absolute flex flex-col gap-0 rounded-l">
            <button
                v-for="tab in tabs"
                :key="tab.name"
                class="board-tabs__tab relative w-11 h-11"
                :class="[activeTab == tab.name && 'board-tabs__tab--active']"
                :data-track="'board_tab_' + tab.name"
                :title="tab.name"
                @click="activeTab = tab.name"
            >
                <span class="board-tabs__tab-icon"><i :class="tab.icon" /></span>
            </button>
        </div>
        <div
            class="board-tabs__content min-h-fit h-[calc(100%-2.5rem)] ml-[45px] p-3 flex flex-col overflow-auto"
        >
            <div class="text-center pb-2">
                <slot name="title" />
                <span class="board-tabs__tab-label">{{ activeTab }}</span>
            </div>
            <Transition name="tab-fade" mode="out-in">
                <div :key="activeTab">
                    <slot :name="activeTab" />
                </div>
            </Transition>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import {useRightSideMenuStore} from '@/stores/right-side';

interface Tab {
    name: string;
    icon: string;
}

type props_t = {
    tabs?: Tab[];
};

const props = withDefaults(defineProps<props_t>(), {
    tabs: () => []
});

const emit = defineEmits<{
    back: [];
}>();

const rightSideMenu = useRightSideMenuStore();

const tabs = computed<Tab[]>(() => {
    return [
        {
            name: 'info',
            icon: 'fas fa-microchip'
        },
        ...props.tabs,
        {
            name: 'debug',
            icon: 'fas fa-code'
        }
    ];
});

const activeTab = ref(tabs.value[0].name);
</script>

<style scoped>
.board-tabs {
    background-color: var(--color-surface-2);
}
.board-tabs__header {
    border-bottom: 1px solid var(--color-border-default);
}
.board-tabs__back,
.board-tabs__detach {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-md);
    color: var(--color-text-tertiary);
    transition: background-color var(--duration-fast) var(--ease-default),
                color var(--duration-fast) var(--ease-default);
    cursor: pointer;
}
.board-tabs__back:hover,
.board-tabs__detach:hover {
    background-color: var(--color-surface-3);
    color: var(--color-text-primary);
}
.board-tabs__sidebar {
    background-color: var(--color-surface-1);
    border: 1px solid var(--color-border-default);
    border-right: none;
    overflow: hidden;
}
.board-tabs__tab {
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--color-surface-2);
    border-bottom: 1px solid var(--color-border-default);
    color: var(--color-text-disabled);
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-default),
                color var(--duration-fast) var(--ease-default);
}
.board-tabs__tab:last-child {
    border-bottom: none;
}
.board-tabs__tab:hover {
    background-color: var(--color-surface-3);
    color: var(--color-text-secondary);
}
.board-tabs__tab--active {
    background-color: var(--color-surface-1);
    color: var(--color-primary-text);
    box-shadow: inset 3px 0 0 var(--color-primary);
}
.board-tabs__tab-icon {
    font-size: var(--text-lg);
}
.board-tabs__tab-label {
    display: block;
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
    text-transform: capitalize;
    letter-spacing: var(--tracking-wide);
}
.board-tabs__content {
    background-color: var(--color-surface-1);
    border: 1px solid var(--color-border-default);
    border-left: none;
    border-radius: 0 var(--radius-lg) var(--radius-lg) 0;
}

/* Tab content crossfade */
.tab-fade-enter-active {
    transition: opacity 120ms ease-out;
}
.tab-fade-leave-active {
    transition: opacity 60ms ease-in;
}
.tab-fade-enter-from,
.tab-fade-leave-to {
    opacity: 0;
}
</style>
