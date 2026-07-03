<template>
    <div class="dash-bar">
        <!-- Pills navigate between dashboards; the active page IS the
             tabpanel (the whole route renders below). Without an explicit
             tabpanel element to bind aria-controls to, the toggle-button
             pattern is more accurate than role=tab. -->
        <div
            v-if="loading && dashboards.length === 0"
            class="dash-bar-scroll dash-bar-scroll--skeleton"
            aria-hidden="true"
        >
            <span
                v-for="i in skeletonCount"
                :key="i"
                class="dash-pill dash-pill--skeleton"
            />
        </div>
        <div v-else class="dash-bar-scroll" role="group" aria-label="Dashboards">
            <button
                v-for="dash in dashboards"
                :key="dash.id"
                type="button"
                class="dash-pill"
                :class="{ active: dash.id === activeId }"
                :aria-pressed="dash.id === activeId"
                @click="$emit('select', dash.id)"
            >
                <div
                    class="dot"
                    :style="dotStyle(dash.color)"
                />
                {{ dash.name }}
            </button>
        </div>

        <!-- Single management trigger — opens the dashboard palette,
             which absorbs the previous dropdown + modal. -->
        <button
            type="button"
            class="dash-more"
            title="All dashboards (⌘K)"
            aria-label="Open dashboard switcher"
            @click="$emit('open-palette')"
        >
            <i class="fas fa-bars" aria-hidden="true" />
        </button>

        <!-- Per-dashboard view-mode actions live inline next to the
             hamburger. Pages register handlers via the chrome store. -->
        <DashViewActions
            v-if="chrome.actions"
            :actions="chrome.actions"
        />
    </div>
</template>

<script setup lang="ts">
import DashViewActions from '@/components/dashboard/DashViewActions.vue';
import {useDashboardChromeStore} from '@/stores/dashboardChrome';

export interface DashPillItem {
    id: number | string;
    name: string;
    color?: string;
    subtitle?: string;
}

withDefaults(
    defineProps<{
        dashboards: DashPillItem[];
        activeId: number | string;
        loading?: boolean;
        skeletonCount?: number;
    }>(),
    {loading: false, skeletonCount: 4}
);

const chrome = useDashboardChromeStore();

defineEmits<{
    (e: 'select', id: number | string): void;
    (e: 'open-palette'): void;
}>();

// Block style injection via the color prop.
function isSafeColor(color: string | undefined): boolean {
    if (!color) return false;
    return /^#[0-9a-fA-F]{3,8}$/.test(color);
}

function dotStyle(color: string | undefined): string {
    if (!isSafeColor(color)) return '';
    return `background:${color};color:${color}`;
}
</script>
