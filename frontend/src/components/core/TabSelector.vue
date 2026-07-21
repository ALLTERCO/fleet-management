<template>
    <DetailTabs
        :tabs="props.tabs"
        :active="props.active"
        :scrollable="props.scrollable"
        @change="handleChange"
    >
        <template
            v-for="fwd in slotForwards"
            :key="fwd.to"
            #[fwd.to]="scope"
        >
            <slot :name="fwd.from" v-bind="scope ?? {}" />
        </template>
    </DetailTabs>
</template>

<script setup lang="ts">
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

// DetailTabs renders its panel via <slot :name="normalizedId">. Forward each
// caller slot — which may use the normalized, original, or space-stripped name —
// under the normalized id DetailTabs expects.
const slotForwards = computed(() => {
    const forwards: {to: string; from: string}[] = [];

    for (const tab of props.tabs) {
        const to = normalizeTabName(tab);
        const from = [to, tab, legacySlotName(tab)].find((name) => slots[name]);

        if (from) forwards.push({to, from});
    }

    return forwards;
});

function handleChange(tabId: string) {
    const originalTab =
        props.tabs.find((tab) => normalizeTabName(tab) === tabId) ?? tabId;
    emit('change', originalTab);
}
</script>
