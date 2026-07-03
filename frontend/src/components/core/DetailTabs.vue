<template>
    <div v-if="normalizedTabs.length" class="flex min-h-0 flex-col">
        <div
            class="mb-3 flex flex-nowrap gap-0 overflow-x-scroll whitespace-nowrap text-center text-sm font-medium no-scrollbar md:px-4"
            role="tablist"
        >
            <template v-for="tab in normalizedTabs" :key="tab.id">
                <button
                    :ref="(el) => setTabButton(tab.id, el)"
                    type="button"
                    role="tab"
                    :aria-selected="activeId === tab.id"
                    :aria-controls="tabPanelId(tab.id)"
                    :tabindex="activeId === tab.id ? 0 : -1"
                    class="tab inline-flex max-w-xs select-none items-center gap-2 rounded-t-lg p-3"
                    :class="
                        activeId === tab.id
                            ? 'tab--active font-semibold'
                            : 'tab--inactive hover:cursor-pointer'
                    "
                    :data-track="`detail_tab_${tab.id}`"
                    @click="selectTab(tab.id)"
                    @keydown="onTabKeydown($event, tab.id)"
                >
                    <i v-if="tab.icon" :class="tab.icon" aria-hidden="true" />
                    <span>{{ tab.label }}</span>
                </button>
            </template>
            <div class="tab-border-fill w-full" />
        </div>

        <div
            :id="tabPanelId(activeId)"
            role="tabpanel"
            class="min-h-0 flex-1 md:px-4"
            :class="
                props.scrollable
                    ? 'overflow-y-auto pb-[8rem] lg:pb-[3rem]'
                    : 'overflow-visible pb-6'
            "
        >
            <slot :name="activeId" />
        </div>
    </div>
</template>

<script setup lang="ts">
import type {ComponentPublicInstance} from 'vue';
import {computed, ref, watch} from 'vue';

type DetailTab = string | {id: string; label: string; icon?: string};

const props = withDefaults(
    defineProps<{
        tabs: DetailTab[];
        active?: string;
        scrollable?: boolean;
    }>(),
    {
        scrollable: true
    }
);

const emit = defineEmits<{
    change: [tabId: string];
}>();

const tabButtons = ref<Record<string, HTMLButtonElement | null>>({});
const internal = ref('');

const normalizedTabs = computed(() => {
    return props.tabs.map((tab) => {
        if (typeof tab === 'string') {
            return {
                id: normalizeTabName(tab),
                label: tab
            };
        }

        return {
            id: tab.id || normalizeTabName(tab.label),
            label: tab.label,
            icon: tab.icon
        };
    });
});

const activeId = computed(() => {
    return (
        resolveTabId(props.active) ??
        internal.value ??
        normalizedTabs.value[0]?.id ??
        ''
    );
});

function normalizeTabName(tab: string) {
    return tab.trim().toLowerCase().replace(/\s+/g, '-');
}

function tabPanelId(tabId: string) {
    return `detail-tab-panel-${tabId}`;
}

function resolveTabId(value?: string) {
    if (!value) return undefined;

    const exactMatch = normalizedTabs.value.find(
        (tab) => tab.id === value || tab.label === value
    );
    if (exactMatch) return exactMatch.id;

    const normalizedMatch = normalizeTabName(value);
    return normalizedTabs.value.find((tab) => tab.id === normalizedMatch)?.id;
}

function selectTab(tabId: string) {
    internal.value = tabId;
    emit('change', tabId);
}

function setTabButton(
    tabId: string,
    element: Element | ComponentPublicInstance | null
) {
    tabButtons.value[tabId] = element as HTMLButtonElement | null;
}

function focusTab(tabId: string) {
    tabButtons.value[tabId]?.focus();
}

function onTabKeydown(event: KeyboardEvent, currentId: string) {
    if (
        ![
            'ArrowLeft',
            'ArrowRight',
            'ArrowUp',
            'ArrowDown',
            'Home',
            'End'
        ].includes(event.key)
    ) {
        return;
    }

    event.preventDefault();

    const ids = normalizedTabs.value.map((tab) => tab.id);
    if (!ids.length) return;

    const currentIndex = Math.max(ids.indexOf(currentId), 0);

    if (event.key === 'Home') {
        selectTab(ids[0]);
        focusTab(ids[0]);
        return;
    }

    if (event.key === 'End') {
        const lastId = ids[ids.length - 1];
        selectTab(lastId);
        focusTab(lastId);
        return;
    }

    const direction =
        event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    const nextIndex = (currentIndex + direction + ids.length) % ids.length;
    const nextId = ids[nextIndex];
    selectTab(nextId);
    focusTab(nextId);
}

watch(
    [normalizedTabs, () => props.active],
    ([tabs, externalActive]) => {
        if (!tabs.length) {
            internal.value = '';
            return;
        }

        const resolvedActive = resolveTabId(externalActive);
        if (externalActive && !resolvedActive) {
            const fallbackTab = tabs[0];
            internal.value = fallbackTab.id;
            emit('change', fallbackTab.id);
            return;
        }

        const nextActive = resolvedActive ?? internal.value;
        if (!tabs.some((tab) => tab.id === nextActive)) {
            internal.value = tabs[0].id;
        }
    },
    {immediate: true}
);
</script>

<style scoped>
.tab--active {
    border-top: 1px solid var(--color-border-focus);
    border-left: 1px solid var(--color-border-focus);
    border-right: 1px solid var(--color-border-focus);
}
.tab--inactive {
    color: var(--color-text-secondary);
    border-bottom: 1px solid var(--tab-inactive-border);
}
.tab--inactive:hover {
    background-color: var(--color-surface-2);
    color: var(--color-text-secondary);
}
.tab-border-fill {
    border-bottom: 1px solid var(--tab-inactive-border);
}
</style>
