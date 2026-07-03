<template>
    <DetailTabs
        :tabs="props.tabs"
        :active="props.active"
        :scrollable="props.scrollable"
        v-slots="forwardedSlots"
        @change="handleChange"
    />
</template>

<script setup lang="ts">
import type {Slot} from 'vue';
import {computed, useSlots} from 'vue';
import DetailTabs from '@/components/core/DetailTabs.vue';

const props = withDefaults(
    defineProps<{
        tabs: string[];
        active?: string;
        scrollable?: boolean;
    }>(),
    {
        scrollable: true
    }
);

const emit = defineEmits<{
    change: [tab: string];
}>();

const slots = useSlots();

function normalizeTabName(tab: string) {
    return tab.toLowerCase().replace(/\s+/g, '-');
}

function legacySlotName(tab: string) {
    return tab.replace(/\s+/g, '');
}

const forwardedSlots = computed<Record<string, Slot>>(() => {
    const mappedSlots: Record<string, Slot> = {};

    for (const tab of props.tabs) {
        const normalizedName = normalizeTabName(tab);
        const slot =
            slots[normalizedName] ?? slots[tab] ?? slots[legacySlotName(tab)];

        if (!slot) continue;

        mappedSlots[normalizedName] = slot;
    }

    return mappedSlots;
});

function handleChange(tabId: string) {
    const originalTab =
        props.tabs.find((tab) => normalizeTabName(tab) === tabId) ?? tabId;
    emit('change', originalTab);
}
</script>
