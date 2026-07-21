<template>
    <div class="board-tabs">
        <div v-if="$slots.header" class="board-tabs__header">
            <div class="min-w-0 flex-grow">
                <slot name="header" />
            </div>
        </div>
        <div class="board-tabs__frame">
            <div
                v-if="showNav || inSubView || $slots.title"
                class="board-tabs__title"
                :class="{'board-tabs__title--nav': showNav}"
            >
                <!-- One Back pill for both drill-down sub-views and pushed
                     boards (components). Title stays centered. -->
                <button
                    v-if="showNav"
                    type="button"
                    class="board-tabs__nav-back"
                    @click="onBack"
                >
                    <i class="fas fa-chevron-left" />
                    <span>Back</span>
                </button>
                <span v-if="inSubView" class="board-tabs__nav-title">
                    {{ activeTab }}
                </span>
                <slot v-else name="title" />
            </div>
            <div
                v-if="$slots.hero && !inSubView"
                class="board-tabs__hero"
            >
                <slot name="hero" :set-tab="setTab" />
            </div>
            <div v-if="tabs.length > 1 && !drillDown" class="board-tabs__tabbar">
                <button
                    v-for="tab in tabs"
                    :key="tab.name"
                    type="button"
                    class="board-tabs__tab"
                    :class="[activeTab === tab.name && 'board-tabs__tab--active']"
                    :data-track="'board_tab_' + tab.name"
                    :title="tab.name"
                    @click="activeTab = tab.name"
                >
                    <span class="board-tabs__tab-icon"><i :class="tab.icon" /></span>
                    <span class="board-tabs__tab-text">{{ tab.name }}</span>
                </button>
            </div>
            <div class="board-tabs__panel">
                <Transition name="tab-fade">
                    <div :key="activeTab" class="board-tabs__panel-inner">
                        <slot :name="activeTab" :set-tab="setTab" />
                    </div>
                </Transition>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';

interface Tab {
    name: string;
    icon: string;
}

type props_t = {
    tabs?: Tab[];
    showBack?: boolean;
    /** First tab is the default body; the rest open via hero buttons with a
     *  Back link. No tab bar is rendered. */
    drillDown?: boolean;
};

const props = withDefaults(defineProps<props_t>(), {
    tabs: () => [],
    showBack: false,
    drillDown: false
});

const emit = defineEmits<{
    back: [];
}>();

const tabs = computed<Tab[]>(() => {
    // Find a custom icon for the info tab if one was passed
    const infoTab = props.tabs.find((t) => t.name === 'info');
    const base: Tab[] = [
        {name: 'info', icon: infoTab?.icon ?? 'fas fa-microchip'}
    ];
    for (const tab of props.tabs) {
        if (tab.name !== 'info') base.push(tab);
    }
    return base;
});

const activeTab = ref(tabs.value[0].name);

// Drill-down sub-view = any tab other than the default (first) one.
const inSubView = computed(
    () => props.drillDown && activeTab.value !== tabs.value[0].name
);

// Show the Back pill for drill-down sub-views and for pushed boards.
const showNav = computed(() => inSubView.value || props.showBack);

// Let hero-slot content (e.g. a "Settings" button) jump to a tab.
function setTab(name: string) {
    if (tabs.value.some((t) => t.name === name)) activeTab.value = name;
}

// Back returns to the default tab when drilled in, else pops the board.
function onBack() {
    if (inSubView.value) setTab(tabs.value[0].name);
    else emit('back');
}
</script>

<style scoped>
.board-tabs {
    display: flex;
    height: 100%;
    min-height: 0;
    flex-direction: column;
    background-color: var(--color-surface-2);
    padding: var(--space-1);
    border-radius: var(--radius-xl);
}
.board-tabs__header {
    display: flex;
    height: var(--touch-target-min);
    width: 100%;
    flex-shrink: 0;
    flex-direction: row;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-3);
    border-bottom: 1px solid var(--color-border-default);
}
.board-tabs__frame {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    background-color: var(--color-surface-1);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    overflow: hidden;
}
.board-tabs__title {
    flex-shrink: 0;
    padding: var(--space-3) var(--space-4) var(--space-2);
    text-align: center;
}
.board-tabs__hero {
    flex-shrink: 0;
    padding: 0 var(--space-4) var(--space-2);
}
.board-tabs__tabbar {
    display: flex;
    flex-shrink: 0;
    gap: var(--space-px);
    margin: 0 var(--space-4) var(--space-2);
    background-color: var(--color-border-default);
    border-radius: var(--radius-md);
    overflow: hidden;
}
.board-tabs__tab {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    background-color: var(--color-surface-2);
    color: var(--color-text-disabled);
    font-size: var(--type-body);
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-default),
                color var(--duration-fast) var(--ease-default);
}
.board-tabs__tab:hover {
    background-color: var(--color-surface-3);
    color: var(--color-text-secondary);
}
.board-tabs__tab--active {
    background-color: var(--color-surface-2);
    color: var(--color-primary-text);
}
.board-tabs__tab-icon {
    font-size: var(--type-body);
}
.board-tabs__tab-text {
    text-transform: capitalize;
    letter-spacing: var(--tracking-wide);
}
.board-tabs__panel {
    min-height: 0;
    flex: 1;
    overflow-y: auto;
    padding: 0 var(--space-4) var(--space-4);
}
/* Drill-down header nav: Back pill pinned left, sub-view title centered. */
.board-tabs__title--nav {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
}
.board-tabs__nav-back {
    position: absolute;
    left: var(--space-4);
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    flex-shrink: 0;
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-full);
    background: var(--color-surface-2);
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-default),
                color var(--duration-fast) var(--ease-default),
                border-color var(--duration-fast) var(--ease-default);
}
.board-tabs__nav-back:hover {
    background-color: var(--color-surface-3);
    border-color: var(--color-border-medium);
    color: var(--color-text-primary);
}
.board-tabs__nav-title {
    font-size: var(--type-subheading);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    text-transform: capitalize;
}
.board-tabs__panel-inner {
    min-height: 100%;
}
</style>
