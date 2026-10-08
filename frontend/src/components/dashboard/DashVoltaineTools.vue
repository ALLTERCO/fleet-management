<template>
    <div class="tools">
        <div ref="rangeWrap" class="ed-tool-wrap">
            <button
                type="button"
                class="range num"
                title="Change date range"
                @click.stop="rangeOpen = !rangeOpen"
            >
                {{ chipLabel }} <span style="opacity: 0.6">▾</span>
            </button>
            <div v-if="rangeOpen" class="rmenu" @click.stop>
                <button
                    v-for="r in RANGES"
                    :key="r.key"
                    type="button"
                    @click="pickRange(r.key)"
                >
                    {{ r.label }}
                </button>
                <div class="rmenu-custom">
                    <div class="rmenu-clabel">Custom range</div>
                    <div class="rmenu-crow">
                        <input
                            v-model="customFrom"
                            type="date"
                            class="rmenu-cinput"
                            aria-label="From date"
                        />
                        <input
                            v-model="customTo"
                            type="date"
                            class="rmenu-cinput"
                            aria-label="To date"
                        />
                    </div>
                    <button
                        type="button"
                        class="rmenu-apply"
                        :disabled="!customFrom || !customTo"
                        @click="applyCustom"
                    >
                        Apply
                    </button>
                </div>
            </div>
        </div>

        <button
            v-if="showFilter"
            type="button"
            class="ic"
            title="Filter devices"
            aria-label="Filter devices"
            @click="emit('open-filter')"
        >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18l-7 8v5l-4 2v-7z" /></svg>
        </button>

        <button
            type="button"
            class="ic"
            title="Refresh"
            aria-label="Refresh"
            @click="emit('refresh')"
        >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
        </button>

        <button
            type="button"
            class="ic"
            title="Dashboard settings"
            aria-label="Dashboard settings"
            @click="emit('open-settings')"
        >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
        </button>

        <button
            type="button"
            class="rep-btn"
            title="Download report"
            @click="emit('open-report')"
        >
            <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11M8 10l4 4 4-4M5 20h14" /></svg> Report
        </button>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref} from 'vue';

// The Voltaine toolbar's right-hand cluster — one source for every dashboard's
// date-range chip, filter/refresh/settings/report controls. Styling comes from
// the global .evolt rules in voltaine.css, so this must render inside a .evolt
// ancestor. Each dashboard handles the emits its own way. (Auto-refresh moved
// to the shell ⋮ menu — DashViewActions.)
const props = withDefaults(
    defineProps<{
        rangeLabel: string;
        // Preset key of the current range ('24h', '7d', …). When it matches a
        // preset the chip shows that label; dates are the custom-range fallback.
        rangeKey?: string;
        showFilter?: boolean;
    }>(),
    {rangeKey: '', showFilter: false}
);

const emit = defineEmits<{
    'pick-range': [range: {key: string; from?: string; to?: string}];
    'open-filter': [];
    refresh: [];
    'open-settings': [];
    'open-report': [];
}>();

// Presets shared by every Voltaine dashboard toolbar.
const RANGES = [
    {key: '24h', label: 'Last 24 hours'},
    {key: '7d', label: 'Last 7 days'},
    {key: '30d', label: 'Last 30 days'},
    {key: '90d', label: 'Last 90 days'},
    {key: 'month', label: 'This month'},
    {key: 'last_month', label: 'Last month'},
    {key: 'ytd', label: 'Year to date'},
    {key: 'last_year', label: 'Last year'}
] as const;

const rangeWrap = ref<HTMLElement | null>(null);
const rangeOpen = ref(false);
const customFrom = ref('');
const customTo = ref('');

// Preset picks read as their own words ("Last 7 days"); only custom ranges
// fall back to the concrete date span the page computed.
const chipLabel = computed(
    () =>
        RANGES.find((r) => r.key === props.rangeKey)?.label ?? props.rangeLabel
);

function pickRange(key: string) {
    emit('pick-range', {key});
    rangeOpen.value = false;
}
function applyCustom() {
    if (!customFrom.value || !customTo.value) return;
    emit('pick-range', {key: 'custom', from: customFrom.value, to: customTo.value});
    rangeOpen.value = false;
}

function onDocClick(e: MouseEvent) {
    if (rangeOpen.value && !rangeWrap.value?.contains(e.target as Node))
        rangeOpen.value = false;
}
function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') rangeOpen.value = false;
}
onMounted(() => {
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
});
onUnmounted(() => {
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onKey);
});
</script>
