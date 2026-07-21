<template>
    <div class="def">
        <div v-if="!hasFlow" class="def__empty">
            <i class="fas fa-bolt def__empty-icon" />
            <p class="def__empty-title">No live energy flow yet</p>
            <p class="def__empty-sub">
                Once your meters report consumption or return, the flow
                between Grid, Solar and Loads renders here.
            </p>
        </div>
        <svg
            v-else
            class="def__svg"
            :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
            role="img"
            :aria-label="ariaLabel"
        >
            <title>{{ ariaLabel }}</title>
            <defs>
                <filter
                    id="def-glow"
                    x="-50%"
                    y="-50%"
                    width="200%"
                    height="200%"
                >
                    <feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
                    <feMerge>
                        <feMergeNode in="coloredBlur" />
                        <feMergeNode in="SourceGraphic" />
                    </feMerge>
                </filter>
                <linearGradient
                    v-for="edge in resolvedEdges"
                    :id="edge.gradientId"
                    :key="edge.gradientId"
                    :x1="edge.from.x"
                    :y1="edge.from.y"
                    :x2="edge.to.x"
                    :y2="edge.to.y"
                    gradientUnits="userSpaceOnUse"
                >
                    <stop offset="0%" :stop-color="edge.color" stop-opacity="0.95" />
                    <stop offset="100%" :stop-color="edge.color" stop-opacity="0.35" />
                </linearGradient>
            </defs>

            <g
                v-for="edge in resolvedEdges"
                :key="edge.pathId"
                class="def__edge-group"
            >
                <path
                    :id="edge.pathId"
                    class="def__edge"
                    :class="{'def__edge--active': edge.active}"
                    :d="edge.path"
                    :stroke="`url(#${edge.gradientId})`"
                    :stroke-width="edge.strokeWidth"
                />
                <circle
                    v-if="edge.active"
                    class="def__particle"
                    r="3"
                    :fill="edge.color"
                >
                    <animateMotion
                        :dur="`${edge.particleDur}s`"
                        repeatCount="indefinite"
                        rotate="auto"
                        :keyPoints="edge.reversed ? '1;0' : '0;1'"
                        keyTimes="0;1"
                        calcMode="linear"
                    >
                        <mpath :href="`#${edge.pathId}`" />
                    </animateMotion>
                </circle>
                <text
                    v-if="edge.magnitude > MIN_LABEL_POWER"
                    class="def__edge-label"
                    :x="edge.labelX"
                    :y="edge.labelY"
                    text-anchor="middle"
                    dominant-baseline="middle"
                >{{ formatPower(edge.magnitude) }}{{ unit }}</text>
            </g>

            <g
                v-for="node in resolvedNodes"
                :key="node.id"
                class="def__node"
                :class="{
                    'def__node--active': nodeIsActive(node.id),
                    'def__node--converge': convergenceNodeIds.has(node.id)
                }"
                :transform="`translate(${node.x}, ${node.y})`"
            >
                <circle
                    class="def__node-circle"
                    :class="`def__node-circle--${node.id}`"
                    :r="NODE_RADIUS"
                />
                <foreignObject
                    :x="-NODE_RADIUS"
                    :y="-NODE_RADIUS"
                    :width="NODE_RADIUS * 2"
                    :height="NODE_RADIUS * 2"
                >
                    <div class="def__node-content">
                        <i :class="node.icon" />
                        <span class="def__node-label">{{ node.label }}</span>
                    </div>
                </foreignObject>
            </g>
        </svg>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {
    curvedEdgePath,
    edgePathId,
    gradientId,
    particleDuration
} from '@/helpers/energyFlow';

export type FlowPosition = 'left' | 'right' | 'top' | 'bottom';

export interface FlowNodeInput {
    readonly id: string;
    readonly label: string;
    readonly icon: string;
    readonly position: FlowPosition;
}

export interface FlowEdgeInput {
    readonly from: string;
    readonly to: string;
    readonly power: number;
    readonly color?: string;
}

const WIDTH = 480;
const HEIGHT = 360;
const NODE_RADIUS = 44;
const MIN_DRAW_POWER = 1;
const MIN_LABEL_POWER = 30;
const MIN_STROKE = 1.5;
const MAX_STROKE = 8;
const EDGE_CURVATURE = 0.18;

const props = withDefaults(
    defineProps<{
        nodes: FlowNodeInput[];
        edges: FlowEdgeInput[];
        unit?: string;
        ariaLabel?: string;
    }>(),
    {unit: 'W', ariaLabel: 'Power flow'}
);

interface ResolvedNode extends FlowNodeInput {
    readonly x: number;
    readonly y: number;
}

interface ResolvedEdge {
    readonly pathId: string;
    readonly gradientId: string;
    readonly from: ResolvedNode;
    readonly to: ResolvedNode;
    readonly path: string;
    readonly labelX: number;
    readonly labelY: number;
    readonly strokeWidth: number;
    readonly magnitude: number;
    readonly color: string;
    readonly active: boolean;
    readonly particleDur: number;
    readonly reversed: boolean;
}

const positions: Record<FlowPosition, {x: number; y: number}> = {
    left: {x: NODE_RADIUS + 16, y: HEIGHT / 2},
    right: {x: WIDTH - NODE_RADIUS - 16, y: HEIGHT / 2},
    top: {x: WIDTH / 2, y: NODE_RADIUS + 16},
    bottom: {x: WIDTH / 2, y: HEIGHT - NODE_RADIUS - 16}
};

const resolvedNodes = computed<readonly ResolvedNode[]>(() =>
    props.nodes.map((node) => ({...node, ...positions[node.position]}))
);

const nodeById = computed(() => {
    const map = new Map<string, ResolvedNode>();
    for (const node of resolvedNodes.value) map.set(node.id, node);
    return map;
});

const maxAbsPower = computed(() =>
    Math.max(1, ...props.edges.map((e) => Math.abs(e.power)))
);

const totalActivePower = computed(() =>
    props.edges.reduce((acc, e) => acc + Math.abs(e.power), 0)
);

const hasFlow = computed(() => totalActivePower.value > 0);

const resolvedEdges = computed<readonly ResolvedEdge[]>(() => {
    const edges = props.edges.flatMap((edge) => {
        const reversed = edge.power < 0;
        const fromKey = reversed ? edge.to : edge.from;
        const toKey = reversed ? edge.from : edge.to;
        const from = nodeById.value.get(fromKey);
        const to = nodeById.value.get(toKey);
        if (!from || !to) return [];
        const magnitude = Math.abs(edge.power);
        const ratio = magnitude / maxAbsPower.value;
        const strokeWidth = MIN_STROKE + (MAX_STROKE - MIN_STROKE) * ratio;
        const midX = (from.x + to.x) / 2;
        const midY = (from.y + to.y) / 2;
        return [
            {
                pathId: edgePathId(fromKey, toKey),
                gradientId: gradientId(fromKey, toKey),
                from,
                to,
                path: curvedEdgePath({
                    fromX: from.x,
                    fromY: from.y,
                    toX: to.x,
                    toY: to.y,
                    curvature: EDGE_CURVATURE
                }),
                labelX: midX,
                labelY: midY - 12,
                strokeWidth,
                magnitude,
                color: edge.color ?? 'var(--color-primary)',
                active: magnitude > MIN_DRAW_POWER,
                particleDur: particleDuration(magnitude, totalActivePower.value),
                reversed: false
            }
        ];
    });
    return edges
        .slice()
        .sort((a, b) => a.magnitude - b.magnitude);
});

const convergenceNodeIds = computed(() => {
    const inflow = new Map<string, number>();
    for (const edge of resolvedEdges.value) {
        if (!edge.active) continue;
        inflow.set(edge.to.id, (inflow.get(edge.to.id) ?? 0) + 1);
    }
    const ids = new Set<string>();
    for (const [id, count] of inflow) if (count >= 2) ids.add(id);
    return ids;
});

const activeNodeIds = computed(() => {
    const ids = new Set<string>();
    for (const edge of resolvedEdges.value) {
        if (edge.active) {
            ids.add(edge.from.id);
            ids.add(edge.to.id);
        }
    }
    return ids;
});

function nodeIsActive(id: string): boolean {
    return activeNodeIds.value.has(id);
}

function formatPower(value: number): string {
    if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
    return value.toFixed(0);
}
</script>

<style scoped>
.def {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    padding: var(--space-3);
}

.def__svg {
    display: block;
    width: 100%;
    aspect-ratio: 480 / 360;
    height: auto;
    min-height: 360px;
}

.def__empty {
    display: grid;
    place-items: center;
    gap: var(--space-2);
    text-align: center;
    min-height: 360px;
    padding: var(--space-4);
    background: var(--color-surface-2);
    border: 1px dashed var(--color-border-default);
    border-radius: var(--radius-lg);
}
.def__empty-icon {
    font-size: var(--type-subheading);
    color: var(--color-text-tertiary);
}
.def__empty-title {
    margin: 0;
    color: var(--color-text-secondary);
    font-weight: var(--font-semibold);
    font-size: var(--type-subheading);
}
.def__empty-sub {
    margin: 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
    max-width: 48ch;
}

.def__edge {
    fill: none;
    stroke-linecap: round;
    opacity: 0.5;
    transition: opacity var(--duration-fast) var(--ease-default);
}

.def__edge--active {
    opacity: 1;
}

.def__particle {
    filter: url(#def-glow);
    opacity: 0.92;
}

.def__edge-label {
    fill: var(--color-text-secondary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    font-variant-numeric: tabular-nums;
    paint-order: stroke;
    stroke: var(--color-surface-2);
    stroke-width: 4;
}

.def__node-circle {
    fill: var(--color-surface-3);
    stroke: var(--color-border-default);
    stroke-width: 1.5;
    transition:
        stroke-width var(--duration-fast) var(--ease-default),
        filter var(--duration-fast) var(--ease-default);
}

.def__node--active .def__node-circle {
    stroke-width: 2.5;
    filter: url(#def-glow);
}

.def__node--converge .def__node-circle {
    stroke-width: 3.5;
}

.def__node-circle--grid {
    fill: color-mix(in srgb, rgb(var(--accent-energy)) 18%, var(--color-surface-3));
    stroke: rgb(var(--accent-energy));
}

.def__node-circle--solar {
    fill: color-mix(in srgb, var(--accent-solar) 22%, var(--color-surface-3));
    stroke: var(--accent-solar);
}

.def__node-circle--battery {
    fill: color-mix(in srgb, var(--color-success) 18%, var(--color-surface-3));
    stroke: var(--color-success);
}

.def__node-circle--loads {
    fill: color-mix(in srgb, var(--color-primary) 18%, var(--color-surface-3));
    stroke: var(--color-primary);
}

.def__node-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: var(--color-text-primary);
    gap: var(--space-1);
    pointer-events: none;
}

.def__node-content i {
    font-size: var(--icon-size-md);
    color: var(--color-text-secondary);
}

.def__node-label {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}
</style>
