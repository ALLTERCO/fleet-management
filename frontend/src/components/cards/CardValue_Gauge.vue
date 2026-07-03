<template>
    <CardShell
        type="ui_widget"
        :name="config.label || 'Gauge'"
        icon="fas fa-tachometer-alt"
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
        <div class="gauge-wrap">
            <svg class="gauge-svg" viewBox="0 0 100 60" preserveAspectRatio="xMidYMid meet">
                <!-- Track arc -->
                <path :d="trackPath" class="gauge-track" />
                <!-- Threshold arcs -->
                <path
                    v-for="(seg, i) in thresholdSegments"
                    :key="i"
                    :d="seg.d"
                    :stroke="seg.color"
                    class="gauge-segment"
                />
                <!-- Value arc -->
                <path v-if="valueArcD" :d="valueArcD" :stroke="valueColor" class="gauge-value-arc" />
                <!-- Needle -->
                <line
                    :x1="50"
                    :y1="50"
                    :x2="needleTip.x"
                    :y2="needleTip.y"
                    class="gauge-needle"
                />
                <circle cx="50" cy="50" r="3" class="gauge-pivot" />
            </svg>
            <div class="gauge-readout">
                <span class="gauge-val">{{ displayValue }}</span>
                <span class="gauge-unit">{{ config.unit }}</span>
            </div>
        </div>
    </CardShell>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {useEntityStore} from '@/stores/entities';
import CardShell from './CardShell.vue';

export interface GaugeWidgetConfig {
    id: 'gauge_widget';
    entityId: string;
    field: string;
    label: string;
    unit: string;
    min: number;
    max: number;
    thresholds: Array<{value: number; color: string}>;
}

const props = withDefaults(
    defineProps<{
        config: GaugeWidgetConfig;
        size?: '1x1' | '2x1' | '2x2';
        editMode?: boolean;
    }>(),
    {size: '1x1', editMode: false}
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

const entityStore = useEntityStore();

const liveValue = computed<number | null>(() => {
    const entity = entityStore.entities[props.config.entityId] as any;
    if (!entity?.status) return null;
    const v = entity.status[props.config.field];
    return v != null ? Number(v) : null;
});

const displayValue = computed(() =>
    liveValue.value != null ? liveValue.value.toFixed(1) : '--'
);

// Gauge arc helpers — 180° semicircle, left to right
// SVG coords: centre (50,50), radius 40, arc from 180° to 0°
const R = 40;
const CX = 50;
const CY = 50;

function polarToXY(angleDeg: number): {x: number; y: number} {
    const rad = (angleDeg * Math.PI) / 180;
    return {
        x: CX + R * Math.cos(rad),
        y: CY + R * Math.sin(rad)
    };
}

function arcPath(startDeg: number, endDeg: number): string {
    const s = polarToXY(startDeg);
    const e = polarToXY(endDeg);
    const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${R} ${R} 0 ${largeArc} 1 ${e.x} ${e.y}`;
}

// 180° arc goes from angle 180 (left) to 0 (right)
const START_DEG = 180;
const END_DEG = 0;

const trackPath = computed(() => arcPath(START_DEG, END_DEG));

function valueToDeg(v: number): number {
    const {min, max} = props.config;
    const clamped = Math.min(Math.max(v, min), max);
    const pct = (clamped - min) / (max - min || 1);
    // 180° → 0° as value goes min→max (sweep clockwise = decreasing angle in standard coords)
    return START_DEG - pct * 180;
}

const thresholdSegments = computed(() => {
    const {thresholds, max} = props.config;
    if (!thresholds?.length) return [];
    const sorted = [...thresholds].sort((a, b) => a.value - b.value);
    const segments: {d: string; color: string}[] = [];
    let prevDeg = START_DEG;
    for (let i = 0; i < sorted.length; i++) {
        const endVal = sorted[i + 1]?.value ?? max;
        const endDeg = valueToDeg(endVal);
        segments.push({
            d: arcPath(prevDeg, endDeg),
            color: sorted[i].color
        });
        prevDeg = endDeg;
    }
    return segments;
});

const valueArcD = computed(() => {
    if (liveValue.value == null) return null;
    const endDeg = valueToDeg(liveValue.value);
    return arcPath(START_DEG, endDeg);
});

const valueColor = computed(() => {
    if (liveValue.value == null) return 'rgba(255,255,255,0.3)';
    const {thresholds} = props.config;
    if (!thresholds?.length) return 'var(--color-primary)';
    const sorted = [...thresholds].sort((a, b) => b.value - a.value);
    for (const t of sorted) {
        if (liveValue.value >= t.value) return t.color;
    }
    return sorted[sorted.length - 1]?.color ?? 'var(--color-primary)';
});

const needleTip = computed(() => {
    const deg =
        liveValue.value != null ? valueToDeg(liveValue.value) : START_DEG;
    const needleR = R - 6;
    const rad = (deg * Math.PI) / 180;
    return {
        x: CX + needleR * Math.cos(rad),
        y: CY + needleR * Math.sin(rad)
    };
});
</script>

<style scoped>
.gauge-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    gap: var(--space-0-5);
}

.gauge-svg {
    width: 100%;
    max-width: 110px;
    overflow: visible;
}

.gauge-track {
    fill: none;
    stroke: var(--color-border-default);
    stroke-width: 8;
    stroke-linecap: round;
}

.gauge-segment {
    fill: none;
    stroke-width: 8;
    stroke-linecap: round;
    opacity: 0.25;
}

.gauge-value-arc {
    fill: none;
    stroke-width: 8;
    stroke-linecap: round;
    opacity: 0.9;
}

.gauge-needle {
    stroke: var(--color-text-primary);
    stroke-width: 1.5;
    stroke-linecap: round;
}

.gauge-pivot {
    fill: var(--color-text-primary);
}

.gauge-readout {
    display: flex;
    align-items: baseline;
    gap: var(--space-1);
}

.gauge-val {
    font-size: var(--type-body);
    font-weight: 700;
    color: var(--color-text-primary);
}

.gauge-unit {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
</style>
