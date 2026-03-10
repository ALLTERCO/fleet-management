<template>
    <div class="h-full">
        <div
            class="flex flex-nowrap gap-0 text-sm font-medium text-center mb-3 whitespace-nowrap overflow-x-scroll no-scrollbar md:px-4"
        >
            <template v-for="tab in tabs">
                <a
                    v-if="active === tab"
                    :key="'active' + normalizeTabName(tab)"
                    class="tab tab--active inline-block p-3 rounded-t-lg font-semibold select-none max-w-xs"
                    >{{ tab }}
                </a>
                <a
                    v-else
                    :key="normalizeTabName(tab)"
                    class="tab tab--inactive inline-block p-3 rounded-t-lg select-none hover:cursor-pointer"
                    :data-track="'tab_' + normalizeTabName(tab)"
                    @click="tabClicked(tab)"
                    >{{ tab }}
                </a>
            </template>
            <div class="tab-border-fill w-full" />
        </div>
        <div class="overflow-y-scroll h-full md:px-4 pb-[8rem] lg:pb-[3rem]">
            <slot :name="active" />
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, ref, toRef} from 'vue';

const props = defineProps<{
    tabs: string[];
    active?: string;
}>();

const emit = defineEmits<{
    change: [tab: string];
}>();

const external = toRef(props, 'active');
const internal = ref(props.tabs[0]);

const active = computed(() => {
    return external.value ?? internal.value;
});

function tabClicked(tab: string) {
    internal.value = tab.replace(' ', '');
    emit('change', tab);
}

function normalizeTabName(tab: string) {
    return tab.toLowerCase().replace(/\s+/g, '-');
}
</script>

<style scoped>
.tab--active {
    border-top: 1px solid var(--color-border-focus);
    border-left: 1px solid var(--color-border-focus);
    border-right: 1px solid var(--color-border-focus);
}
.tab--inactive {
    color: var(--color-text-secondary);
    border-bottom: 1px solid var(--color-border-focus);
}
.tab--inactive:hover {
    background-color: var(--color-surface-2);
    color: var(--color-text-secondary);
}
.tab-border-fill {
    border-bottom: 1px solid var(--color-border-focus);
}
</style>
