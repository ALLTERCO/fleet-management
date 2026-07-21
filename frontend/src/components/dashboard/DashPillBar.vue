<template>
    <div ref="barRef" class="dash-bar">
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
                :class="{active: dash.id === activeId}"
                :aria-pressed="dash.id === activeId"
                @click="$emit('select', dash.id)"
            >
                <div
                    v-if="dotStyle(dash.color)"
                    class="dot"
                    :style="dotStyle(dash.color)"
                />
                {{ dash.name }}
                <i
                    v-if="dash.isDefault"
                    class="fas fa-star dash-pill__star"
                    aria-label="Default dashboard"
                    title="Default dashboard"
                />
            </button>
        </div>

        <!-- Full-screen / present mode — puts the whole dash surface into the
             browser's fullscreen so the dashboard fills the display. -->
        <button
            type="button"
            class="dash-more"
            :title="isFullscreen ? 'Exit full screen' : 'Full screen'"
            :aria-label="isFullscreen ? 'Exit full screen' : 'Enter full screen'"
            :aria-pressed="isFullscreen"
            @click="toggleFullscreen"
        >
            <i
                class="fas"
                :class="isFullscreen ? 'fa-compress' : 'fa-expand'"
                aria-hidden="true"
            />
        </button>

        <!-- Overflow (⋮): always present for Create / Manage. Pages register
             per-dashboard actions (edit / set default / duplicate) via the
             chrome store; the menu contents branch on dashboard kind. -->
        <DashViewActions :actions="chrome.actions" />
    </div>
</template>

<script setup lang="ts">
import {onBeforeUnmount, onMounted, ref} from 'vue';
import DashViewActions from '@/components/dashboard/DashViewActions.vue';
import {useDashboardChromeStore} from '@/stores/dashboardChrome';

export interface DashPillItem {
    id: number | string;
    name: string;
    color?: string;
    subtitle?: string;
    isDefault?: boolean;
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
    select: [id: number | string];
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

// ── Full screen / present mode ──
// Target the whole dash surface (this bar is its header), not the bar alone.
const barRef = ref<HTMLElement | null>(null);
const isFullscreen = ref(false);

function surfaceEl(): Element | null {
    return barRef.value?.closest('.dash-surface') ?? null;
}

async function toggleFullscreen(): Promise<void> {
    const el = surfaceEl();
    if (!el) return;
    // The Fullscreen API rejects when the browser blocks the request (no user
    // gesture, permissions policy); surface it instead of leaving an unhandled
    // promise rejection.
    try {
        if (document.fullscreenElement) {
            await document.exitFullscreen();
        } else {
            await el.requestFullscreen?.();
        }
    } catch (err) {
        console.warn('[DashPillBar] full-screen toggle failed', err);
    }
}

function onFullscreenChange(): void {
    isFullscreen.value = Boolean(document.fullscreenElement);
}

onMounted(() =>
    document.addEventListener('fullscreenchange', onFullscreenChange)
);
onBeforeUnmount(() =>
    document.removeEventListener('fullscreenchange', onFullscreenChange)
);
</script>
