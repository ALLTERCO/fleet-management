<template>
    <div ref="hostRef" class="dt" />
</template>

<script setup lang="ts">
import cytoscape, {type Core, type ElementDefinition} from 'cytoscape';
import coseBilkent from 'cytoscape-cose-bilkent';
import {onBeforeUnmount, onMounted, ref, watch} from 'vue';
import {
    TOPOLOGY_ANIMATION_DURATION_MS,
    TOPOLOGY_EDGE_ELASTICITY,
    TOPOLOGY_GRAVITY,
    TOPOLOGY_IDEAL_EDGE_LENGTH,
    TOPOLOGY_NODE_REPULSION,
    TOPOLOGY_TILE
} from '@/constants';
import {chartColors} from '@/helpers/chartUtils';
import {toCytoscapeColor} from '@/helpers/cytoscapeColor';
import {statusHex} from '@/helpers/status-colors';

// Force-directed topology (Cytoscape + cose-bilkent). Diff-based re-render:
// data changes replace the element set in place and re-run the layout;
// the renderer/style/event handlers persist.

export interface TopoNode {
    id: string;
    label: string;
    type?: 'hub' | 'device' | 'group';
    status?: 'on' | 'off' | 'warn';
}

export interface TopoEdge {
    source: string;
    target: string;
    weight?: number;
}

const props = defineProps<{
    nodes: TopoNode[];
    edges: TopoEdge[];
}>();

const emit = defineEmits<{
    nodeClick: [id: string];
}>();

const hostRef = ref<HTMLElement | null>(null);
let cy: Core | null = null;
let layoutRegistered = false;

function ensureLayoutRegistered() {
    if (layoutRegistered) return;
    cytoscape.use(coseBilkent);
    layoutRegistered = true;
}

function toElements(): ElementDefinition[] {
    const els: ElementDefinition[] = [];
    for (const n of props.nodes) {
        els.push({
            data: {
                id: n.id,
                label: n.label,
                type: n.type ?? 'device',
                status: n.status ?? 'on'
            }
        });
    }
    for (const e of props.edges) {
        els.push({
            data: {
                id: `${e.source}--${e.target}`,
                source: e.source,
                target: e.target,
                weight: e.weight ?? 1
            }
        });
    }
    return els;
}

function layoutOptions() {
    return {
        name: 'cose-bilkent',
        animate: true,
        animationDuration: TOPOLOGY_ANIMATION_DURATION_MS,
        randomize: true,
        nodeRepulsion: TOPOLOGY_NODE_REPULSION,
        idealEdgeLength: TOPOLOGY_IDEAL_EDGE_LENGTH,
        edgeElasticity: TOPOLOGY_EDGE_ELASTICITY,
        gravity: TOPOLOGY_GRAVITY,
        tile: TOPOLOGY_TILE
    } as cytoscape.LayoutOptions;
}

// Token-aware. Called at init and re-called from refreshStyles() when
// a theme:change event fires, so theme swaps repaint without remount.
function buildStyle(): cytoscape.StylesheetStyle[] {
    // Cytoscape rejects 8-digit hex (`#RRGGBBAA`) which browsers may
    // produce when resolving rgba()-backed tokens. Normalise at the edge.
    const c = toCytoscapeColor;
    return [
        {
            selector: 'node',
            style: {
                'background-color': c(chartColors.primary),
                label: 'data(label)',
                color: c(chartColors.textPrimary),
                'font-size': 10,
                'text-valign': 'bottom',
                'text-margin-y': 6,
                width: 28,
                height: 28,
                'border-width': 2,
                'border-color': c(chartColors.tooltipBorder)
            }
        },
        {
            selector: 'node[type = "hub"]',
            style: {
                'background-color': c(chartColors.info),
                width: 38,
                height: 38,
                'font-weight': 700
            }
        },
        {
            selector: 'node[type = "group"]',
            style: {
                'background-color': c(chartColors.accent),
                shape: 'round-rectangle'
            }
        },
        {
            selector: 'node[status = "off"]',
            style: {'background-color': c(statusHex('off'))}
        },
        {
            selector: 'node[status = "warn"]',
            style: {'background-color': c(statusHex('warn'))}
        },
        {
            selector: 'edge',
            style: {
                width: 1.5,
                'line-color': c(chartColors.tooltipBorder),
                'curve-style': 'bezier',
                'target-arrow-shape': 'none',
                'transition-property': 'line-color, width',
                'transition-duration': 200
            }
        },
        {
            selector: 'edge:selected, node:selected',
            style: {
                'line-color': c(chartColors.primary),
                'border-color': c(chartColors.primary),
                'border-width': 3
            }
        }
    ];
}

function refreshStyles() {
    if (!cy || cy.destroyed()) return;
    cy.style(buildStyle()).update();
}

function init() {
    if (!hostRef.value) return;
    ensureLayoutRegistered();
    // cytoscape 3.32+ auto-normalises wheel deltas — don't set wheelSensitivity.
    cy = cytoscape({
        container: hostRef.value,
        elements: toElements(),
        style: buildStyle(),
        layout: layoutOptions(),
        minZoom: 0.2,
        maxZoom: 2
    });

    cy.on('tap', 'node', (evt) => emit('nodeClick', evt.target.id()));
    window.addEventListener('theme:change', refreshStyles);
}

// Structural signature changes => re-layout. Pure attribute changes
// (status flip, label rename) update node data in place without
// re-running the 800ms cose-bilkent animation.
function structureSignature(): string {
    const nodeIds = props.nodes
        .map((n) => n.id)
        .sort()
        .join(',');
    const edgeKeys = props.edges
        .map((e) => `${e.source}>${e.target}`)
        .sort()
        .join(',');
    return `${nodeIds}|${edgeKeys}`;
}

let lastStructureSig = '';

function applyData() {
    if (!cy) return;
    const sig = structureSignature();
    if (sig === lastStructureSig) {
        // Attribute-only update: patch in place on existing elements.
        for (const n of props.nodes) {
            const node = cy.getElementById(n.id);
            if (node.empty()) continue;
            node.data('label', n.label);
            node.data('type', n.type ?? 'device');
            node.data('status', n.status ?? 'on');
        }
        for (const e of props.edges) {
            const edge = cy.getElementById(`${e.source}--${e.target}`);
            if (edge.empty()) continue;
            edge.data('weight', e.weight ?? 1);
        }
        return;
    }
    lastStructureSig = sig;
    cy.elements().remove();
    cy.add(toElements());
    cy.layout(layoutOptions()).run();
}

onMounted(() => {
    init();
    lastStructureSig = structureSignature();
});

watch(() => [props.nodes, props.edges], applyData, {deep: true});

onBeforeUnmount(() => {
    window.removeEventListener('theme:change', refreshStyles);
    cy?.destroy();
    cy = null;
});
</script>

<style scoped>
.dt {
    width: 100%;
    height: 100%;
    min-height: 360px;
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
    overflow: hidden;
}
</style>
