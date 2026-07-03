<template>
    <div
        class="route-tabs"
        :class="`route-tabs--${tabs.length}`"
        :style="{'--slider-count': String(tabs.length)}"
    >
        <div
            class="route-tabs__track"
            :style="{transform: `translateX(${activeIndex * 100}%)`}"
        />
        <button
            v-for="(tab, idx) in tabs"
            :key="tab.path"
            type="button"
            class="route-tabs__btn"
            :class="{'route-tabs__btn--active': idx === activeIndex}"
            @click="onClick(tab)"
        >
            <i v-if="tab.icon" :class="tab.icon" />
            {{ tab.label }}
        </button>
    </div>
</template>

<script setup lang="ts">
import {type ComputedRef, computed, inject} from 'vue';
import {useRoute, useRouter} from 'vue-router';
import type {RouteTab} from '@/types/page-template';

const tabsRef = inject<ComputedRef<RouteTab[]>>(
    'deviceAuthTabs',
    computed(() => [])
);
const tabs = computed(() => tabsRef.value);
const route = useRoute();
const router = useRouter();

const activeIndex = computed(() => {
    const idx = tabs.value.findIndex((t) => t.path === route.path);
    return idx >= 0 ? idx : 0;
});

function onClick(tab: RouteTab) {
    if (tab.path !== route.path) void router.push(tab.path);
}
</script>
