<template>
    <CardShell
        type="ui_widget"
        name="State Timeline"
        icon="fas fa-timeline"
        :size="size"
        :edit-mode="editMode"
        @delete="$emit('delete')"
        @resize="(s: any) => $emit('resize', s)"
        @move="(d: any) => $emit('move', d)"
        @drag-start="(e: DragEvent) => $emit('drag-start', e)"
        @drag-end="(e: DragEvent) => $emit('drag-end', e)"
        @drag-over="(e: DragEvent) => $emit('drag-over', e)"
        @drag-leave="(e: DragEvent) => $emit('drag-leave', e)"
        @drop="(e: DragEvent) => $emit('drop', e)"
    >
        <div class="stl">
            <div class="stl-tabs">
                <button
                    v-for="opt in rangeOpts"
                    :key="opt.value"
                    class="stl-tab"
                    :class="{'stl-tab--active': range === opt.value}"
                    @click.stop="range = opt.value"
                >{{ opt.label }}</button>
            </div>
            <div v-if="anyLoading" class="stl-empty"><Spinner /></div>
            <div v-else-if="!config.entities?.length" class="stl-empty">No entities</div>
            <div v-else class="stl-rows">
                <div
                    v-for="(entry, i) in config.entities"
                    :key="i"
                    class="stl-row"
                >
                    <span class="stl-label" :title="entry.name">{{ entry.name }}</span>
                    <div class="stl-track" :ref="(el) => setTrackRef(el as HTMLElement, i)">
                        <canvas
                            :ref="(el) => setCanvasRef(el as HTMLCanvasElement, i)"
                            style="width:100%;height:100%"
                        />
                    </div>
                </div>
            </div>
        </div>
    </CardShell>
</template>

<script setup lang="ts">
import {computed, nextTick, onUnmounted, ref, watch} from 'vue';
import Spinner from '@/components/core/Spinner.vue';
import {useDashboardContext} from '@/composables/useDashboardContext';
import type {TimelineRange} from '@/composables/useStatusTimeline';
import {useStatusTimeline} from '@/composables/useStatusTimeline';
import {chartColors} from '@/helpers/chartUtils';
import CardShell from './CardShell.vue';

export interface StateTimelineEntity {
    shellyId: string;
    field: string;
    name: string;
    colorMap?: Record<string, string>;
}

export interface StateTimelineWidgetConfig {
    id: 'state_timeline_widget';
    entities: StateTimelineEntity[];
    range?: TimelineRange;
}

const DEFAULT_COLOR_MAP: Record<string, string> = {
    '1': '#4caf50',
    true: '#4caf50',
    on: '#4caf50',
    '0': '#616161',
    false: '#616161',
    off: '#616161',
    alarm: '#f44336',
    wet: '#2196f3'
};

const props = withDefaults(
    defineProps<{
        config: StateTimelineWidgetConfig;
        size?: '1x1' | '2x1' | '2x2';
        editMode?: boolean;
    }>(),
    {size: '2x2', editMode: false}
);

defineEmits<{
    delete: [];
    resize: [size: '1x1' | '2x1' | '2x2'];
    move: [direction: number];
    'drag-start': [e: DragEvent];
    'drag-end': [e: DragEvent];
    'drag-over': [e: DragEvent];
    'drag-leave': [e: DragEvent];
    drop: [e: DragEvent];
}>();

const rangeOpts: {label: string; value: TimelineRange}[] = [
    {label: '6h', value: '6h'},
    {label: '24h', value: '24h'}
];

const range = ref<TimelineRange>(props.config.range ?? '24h');

// One useStatusTimeline per entity
const timelineList = (props.config.entities ?? []).map((e) =>
    useStatusTimeline(
        computed(() => e.shellyId || undefined),
        computed(() => e.field || undefined),
        range
    )
);

const anyLoading = computed(() => timelineList.some((t) => t.loading.value));

const dashCtx = useDashboardContext();
watch(
    () => dashCtx.value.refreshSignal.value,
    () => {
        for (const tl of timelineList) tl.refresh();
    }
);

// Canvas refs per row
const canvasRefs: (HTMLCanvasElement | null)[] = [];
const trackRefs: (HTMLElement | null)[] = [];

function setCanvasRef(el: HTMLCanvasElement | null, i: number) {
    canvasRefs[i] = el;
}
function setTrackRef(el: HTMLElement | null, i: number) {
    trackRefs[i] = el;
}

function stateToColor(
    val: number | null,
    colorMap?: Record<string, string>
): string {
    if (val == null) return chartColors.overlayFaint;
    const key = String(val);
    const map = {...DEFAULT_COLOR_MAP, ...colorMap};
    return map[key] ?? map[val > 0.5 ? '1' : '0'] ?? '#616161';
}

function drawTimeline(index: number) {
    const canvas = canvasRefs[index];
    const track = trackRefs[index];
    if (!canvas || !track) return;
    const events = timelineList[index]?.data.value ?? [];
    const colorMap = props.config.entities[index]?.colorMap;

    const dpr = window.devicePixelRatio || 1;
    const W = track.offsetWidth || 100;
    const H = track.offsetHeight || 12;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    if (!events.length) {
        ctx.fillStyle = chartColors.overlayFaint;
        ctx.fillRect(0, 0, W, H);
        return;
    }

    const now = new Date();
    const msBack = range.value === '6h' ? 6 * 3600000 : 24 * 3600000;
    const fromMs = now.getTime() - msBack;
    const toMs = now.getTime();
    const span = toMs - fromMs;

    // Build segments: each event defines start of a new state until next event
    for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        const startMs = Math.max(new Date(ev.ts).getTime(), fromMs);
        const endMs =
            i + 1 < events.length
                ? Math.min(new Date(events[i + 1].ts).getTime(), toMs)
                : toMs;

        const x1 = ((startMs - fromMs) / span) * W;
        const x2 = ((endMs - fromMs) / span) * W;
        ctx.fillStyle = stateToColor(ev.value, colorMap);
        ctx.fillRect(x1, 0, Math.max(x2 - x1, 1), H);
    }
}

async function redrawAll() {
    await nextTick();
    for (let i = 0; i < (props.config.entities ?? []).length; i++) {
        drawTimeline(i);
    }
}

watch(
    [anyLoading, range],
    async () => {
        if (!anyLoading.value) await redrawAll();
    },
    {immediate: true}
);

watch(
    () => props.config.entities?.length,
    (newLen = 0, oldLen = 0) => {
        // Clear stale refs beyond the new length so drawTimeline() doesn't operate
        // on detached canvas/track elements left over from when the list was longer.
        for (let i = newLen; i < oldLen; i++) {
            canvasRefs[i] = null;
            trackRefs[i] = null;
        }
        redrawAll();
    }
);

onUnmounted(() => {
    canvasRefs.fill(null);
    trackRefs.fill(null);
});
</script>

<style scoped>
.stl {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: 100%;
    height: 100%;
    min-height: 0;
}

.stl-tabs {
    display: flex;
    gap: var(--space-0-5);
    flex-shrink: 0;
}

.stl-tab {
    padding: var(--space-0-5) 7px;
    font-size: var(--type-body);
    border-radius: var(--radius-xs);
    border: none;
    background: var(--state-hover-bg-strong);
    color: var(--color-text-tertiary);
    cursor: pointer;
}

.stl-tab--active {
    background: var(--color-border-strong);
    color: var(--color-text-primary);
}

.stl-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}

.stl-rows {
    flex: 1;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-height: 0;
}

.stl-row {
    display: grid;
    grid-template-columns: 60px 1fr;
    align-items: center;
    gap: var(--space-1);
    flex-shrink: 0;
}

.stl-label {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.stl-track {
    height: 12px;
    border-radius: var(--radius-xs);
    overflow: hidden;
    background: var(--state-hover-bg);
}
</style>
