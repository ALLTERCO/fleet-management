<template>
    <div
        ref="containerRef"
        class="topology-diagram"
        :class="{'is-fullscreen': fullscreen}"
    >
        <div class="topology-toolbar">
            <label class="flow-select">
                <span class="flow-select-label">View</span>
                <select
                    class="flow-select-input"
                    :value="selectedFlowId"
                    aria-label="Topology workflow overlay"
                    @change="onFlowChange"
                >
                    <option value="all">All</option>
                    <option v-for="flow in flows" :key="flow.id" :value="flow.id">
                        {{ flow.label }}
                    </option>
                </select>
            </label>
            <div class="toolbar-right">
                <button type="button" class="tool-btn" title="Fit to view" @click="fitView">
                    Fit
                </button>
                <button
                    type="button"
                    class="tool-btn"
                    :class="{active: unhealthyOnly}"
                    title="Show only warning and critical modules"
                    @click="toggleUnhealthy"
                >
                    Unhealthy
                </button>
                <button
                    type="button"
                    class="tool-btn"
                    :class="{active: locked}"
                    title="Freeze the layout so nothing moves"
                    @click="toggleLock"
                >
                    {{ locked ? 'Locked' : 'Lock' }}
                </button>
                <button
                    type="button"
                    class="tool-btn"
                    title="Clear selection and view"
                    @click="resetView"
                >
                    Reset
                </button>
                <button
                    type="button"
                    class="tool-btn"
                    title="Toggle fullscreen"
                    @click="toggleFullscreen"
                >
                    {{ fullscreen ? 'Exit' : 'Fullscreen' }}
                </button>
            </div>
        </div>

        <div v-if="store.schemaUnsupported" class="topology-banner">
            Topology schema mismatch — please reload.
        </div>
        <div v-else-if="store.lastError" class="topology-banner is-error">
            {{ store.lastError }}
        </div>

        <div
            v-if="incidentHints.length > 0"
            class="incident-strip"
            aria-label="Active topology incidents"
        >
            <button
                v-for="hint in incidentHints"
                :key="hint.id"
                type="button"
                class="incident-hint"
                :class="`is-${hint.severity}`"
                :title="hint.evidence"
                @click="focusIncidentHint(hint)"
            >
                <span class="incident-dot" />
                <span class="incident-message">{{ hint.message }}</span>
            </button>
        </div>

        <div
            class="topology-body"
            :class="{'has-inspector': selectedNode || selectedEdge}"
        >
            <div class="topology-canvas-wrap">
                <div ref="canvasRef" class="topology-canvas" />
                <div class="zone-labels" aria-hidden="true">
                    <span
                        v-for="zone in zoneLabels"
                        :key="zone.id"
                        class="zone-label"
                        :class="`is-${zone.status}`"
                        :style="{
                            transform: `translate(calc(${zone.x}px - 50%), ${zone.y}px)`
                        }"
                    >
                        {{ zone.label }}
                    </span>
                </div>
            </div>

            <TopologyInspector
                v-if="selectedNode || selectedEdge"
                class="topology-inspector-panel"
                :node="selectedNode"
                :edge="selectedEdge"
                :edges="allEdges"
                :edge-history="selectedEdgeHistory"
                @clear="clearSelection"
                @open-node-history="openSelectedNodeHistory"
            />
        </div>

        <NodeDrilldown :node-id="historyNodeId" @close="historyNodeId = null" />
    </div>
</template>

<script setup lang="ts">
import cytoscape, {type Core, type ElementDefinition} from 'cytoscape';
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue';
import {toCytoscapeColor} from '@/helpers/cytoscapeColor';
import {
    gridPositions,
    primaryStat,
    visibleNodeIds,
    type ZoneColumn,
    zoneColumns,
    zoneStatus
} from '@/helpers/topologyGraph';
import {
    buildTopologyIncidentHints,
    type TopologyIncidentHint
} from '@/helpers/topologyIncidentHints';
import {useTopologyStore} from '@/stores/topology';
import type {ModuleStatus, TopologyFlowId} from '@/types/topology';
import NodeDrilldown from './NodeDrilldown.vue';
import TopologyInspector from './TopologyInspector.vue';

const store = useTopologyStore();
const containerRef = ref<HTMLElement | null>(null);
const canvasRef = ref<HTMLElement | null>(null);
const selectedNodeId = ref<string | null>(null);
const selectedEdgeId = ref<string | null>(null);
const historyNodeId = ref<string | null>(null);
const selectedFlowId = ref<TopologyFlowId | 'all'>('all');
const unhealthyOnly = ref(false);
const fullscreen = ref(false);
// Locked by default: the map opens stable (no drift, no accidental drag).
const locked = ref(true);

// Zone labels render as an HTML overlay — Cytoscape draws compound labels
// behind child nodes, where they get covered.
interface ZoneLabel {
    id: string;
    label: string;
    status: string;
    x: number;
    y: number;
}
const zoneLabels = ref<ZoneLabel[]>([]);

let cy: Core | null = null;
let lastSignature = '';
let flowTimer: ReturnType<typeof setInterval> | null = null;
let dashOffset = 0;

// Canvas padding around the fitted graph.
const FIT_PADDING = 28;

const flows = computed(() => store.current?.flows ?? []);
const allNodes = computed(() => store.current?.nodes ?? []);
const allEdges = computed(() => store.current?.edges ?? []);

const selectedNode = computed(
    () => allNodes.value.find((n) => n.id === selectedNodeId.value) ?? null
);
const selectedEdge = computed(
    () => allEdges.value.find((e) => e.id === selectedEdgeId.value) ?? null
);
const selectedEdgeHistory = computed(() =>
    selectedEdgeId.value ? store.edgeHistory.get(selectedEdgeId.value) : undefined
);

// Live incidents (problem modules, degraded links, current bottleneck) shown as
// quick-jump chips above the map — click one to select and focus that service.
const incidentHints = computed<TopologyIncidentHint[]>(() => {
    const snap = store.current;
    if (!snap) return [];
    return buildTopologyIncidentHints({
        nodes: snap.nodes,
        edges: snap.edges,
        bottleneckId: store.bottleneckId
    });
});

function focusIncidentHint(hint: TopologyIncidentHint): void {
    if (hint.nodeId) selectNode(hint.nodeId);
    else if (hint.edgeId) selectEdge(hint.edgeId);
}

// ─── Data → Cytoscape elements ───

// Visible nodes in ordered zone columns — one source for elements + positions.
function viewColumns(): ZoneColumn[] {
    const ids = visibleNodeIds({
        nodes: allNodes.value,
        edges: allEdges.value,
        unhealthyOnly: unhealthyOnly.value
    });
    const nodes = allNodes.value.filter((node) => ids.has(node.id));
    return zoneColumns({nodes, zones: store.current?.zones ?? []});
}

function toElements(): ElementDefinition[] {
    const columns = viewColumns();
    const visible = new Set(
        columns.flatMap((column) => column.members.map((node) => node.id))
    );
    const elements: ElementDefinition[] = [];
    for (const column of columns) {
        elements.push({
            data: {
                id: `zone:${column.id}`,
                label: column.label,
                isZone: 1,
                zoneStatus: zoneStatus(column.members)
            }
        });
    }
    for (const column of columns) {
        for (const node of column.members) {
            const stat = primaryStat(node.stats);
            elements.push({
                data: {
                    id: node.id,
                    label: stat ? `${node.label}\n${stat}` : node.label,
                    status: node.status,
                    kind: node.kind ?? 'module',
                    parent: `zone:${column.id}`
                }
            });
        }
    }
    for (const edge of allEdges.value) {
        if (!visible.has(edge.from) || !visible.has(edge.to)) continue;
        elements.push({
            data: {
                id: edge.id,
                source: edge.from,
                target: edge.to,
                status: edge.status,
                throughput: edge.throughput
            }
        });
    }
    return elements;
}

// Grid spacing for the deterministic layout (see topologyGraph.gridPositions).
const COLUMN_GAP = 250;
const ROW_GAP = 92;

function nodePositions(): Record<string, {x: number; y: number}> {
    return gridPositions(viewColumns(), {columnGap: COLUMN_GAP, rowGap: ROW_GAP});
}

// ─── Styling (tokens resolved at runtime; Cytoscape can't read CSS vars) ───

function cssColor(name: string, fallback: string): string {
    const root = containerRef.value ?? document.documentElement;
    const raw = getComputedStyle(root).getPropertyValue(name).trim();
    return toCytoscapeColor(raw || fallback);
}

function statusPalette(): Record<ModuleStatus, string> {
    return {
        healthy: cssColor('--color-success', '#16a34a'),
        warning: cssColor('--color-warning', '#d97706'),
        critical: cssColor('--color-danger', '#dc2626'),
        unknown: cssColor('--color-text-quaternary', '#6b7280')
    };
}

function buildStyle(): cytoscape.StylesheetStyle[] {
    const status = statusPalette();
    const surface = cssColor('--color-surface-3', '#122338');
    const surfaceActive = cssColor('--color-surface-4', '#182d46');
    const zoneFill = cssColor('--color-surface-0', '#091320');
    const text = cssColor('--color-text-primary', '#f0f2f4');
    const border = cssColor('--color-border-strong', '#2a3a52');
    const edgeLine = cssColor('--color-success', '#16a34a');
    const primary = cssColor('--color-primary', '#4495d1');
    return [
        // Zone group — a quiet recessed container; the label is an HTML overlay.
        {
            selector: ':parent',
            style: {
                shape: 'round-rectangle',
                'corner-radius': '16px',
                'background-color': zoneFill,
                'background-opacity': 0.6,
                'border-width': 1,
                'border-color': border,
                'border-opacity': 0.5,
                label: '',
                padding: '18px'
            }
        },
        // Service node — clean card; health shows on the border.
        {
            selector: 'node',
            style: {
                shape: 'round-rectangle',
                'corner-radius': '9px',
                'background-color': surface,
                'border-width': 1.5,
                'border-color': border,
                label: 'data(label)',
                color: text,
                'font-size': 11,
                'font-weight': 500,
                'text-valign': 'center',
                'text-halign': 'center',
                'text-wrap': 'wrap',
                'text-max-width': '108px',
                'line-height': 1.3,
                width: 'label',
                height: 'label',
                padding: '14px'
            }
        },
        {
            selector: 'node[status = "healthy"]',
            style: {'border-color': status.healthy, 'border-opacity': 0.7}
        },
        {
            selector: 'node[status = "warning"]',
            style: {
                'border-color': status.warning,
                'border-width': 2.5,
                'background-color': cssColor('--color-warning-subtle', '#3a2e10')
            }
        },
        {
            selector: 'node[status = "critical"]',
            style: {
                'border-color': status.critical,
                'border-width': 2.5,
                'background-color': cssColor('--color-danger-subtle', '#3a1414')
            }
        },
        // Edge — a stream of bright dashes flowing toward the arrow; only
        // problems recolour. Thicker + brighter so the flow reads at a glance.
        {
            selector: 'edge',
            style: {
                width: 'mapData(throughput, 0, 60, 2.4, 6)',
                'line-color': edgeLine,
                'line-style': 'dashed',
                // Bright dash + gap = a packet streaming along the line.
                'line-dash-pattern': [9, 11],
                'line-cap': 'round',
                'curve-style': 'taxi',
                'taxi-direction': 'rightward',
                'taxi-turn': '40%',
                'taxi-turn-min-distance': '8px',
                'target-arrow-shape': 'triangle',
                'target-arrow-color': edgeLine,
                'arrow-scale': 1,
                opacity: 0.85
            }
        },
        {
            selector: 'edge[status = "warning"]',
            style: {
                'line-color': status.warning,
                'target-arrow-color': status.warning,
                opacity: 0.9
            }
        },
        {
            selector: 'edge[status = "critical"]',
            style: {
                'line-color': status.critical,
                'target-arrow-color': status.critical,
                opacity: 0.95
            }
        },
        {
            selector: 'node:selected',
            style: {
                'border-width': 3,
                'border-color': primary,
                'background-color': surfaceActive,
                'underlay-color': primary,
                'underlay-opacity': 0.3,
                'underlay-padding': '12px'
            }
        },
        {
            selector: 'edge:selected',
            style: {
                width: 3.5,
                'line-color': primary,
                'target-arrow-color': primary,
                opacity: 1
            }
        },
        {
            selector: '.faded',
            style: {opacity: 0.45, 'text-opacity': 0.45}
        },
        // Final word: zone boxes never render a canvas label (HTML overlay does).
        {
            selector: ':parent',
            style: {label: '', 'background-color': zoneFill, 'border-color': border}
        },
        // Rolled-up zone health colours the box border (worst member wins).
        {
            selector: ':parent[zoneStatus = "warning"]',
            style: {'border-color': status.warning, 'border-opacity': 0.9}
        },
        {
            selector: ':parent[zoneStatus = "critical"]',
            style: {'border-color': status.critical, 'border-opacity': 0.95}
        }
    ];
}

// Snap nodes to their grid positions (preset is synchronous), then frame.
function runLayout(): void {
    if (!cy || cy.destroyed()) return;
    cy.layout({name: 'preset', positions: nodePositions()} as cytoscape.LayoutOptions).run();
    frameView();
}

// Fit the whole map so every zone is visible — the locked default freezes the
// view here, so nothing may sit off-screen and unreachable.
function frameView(): void {
    if (!cy || cy.destroyed()) return;
    cy.fit(undefined, FIT_PADDING);
    updateZoneLabels();
}

// ─── Lifecycle + diff-based updates (a new module just appears) ───

function init(): void {
    if (!canvasRef.value) return;
    cy = cytoscape({
        container: canvasRef.value,
        elements: toElements(),
        style: buildStyle(),
        minZoom: 0.2,
        maxZoom: 2.5
    });
    runLayout();
    lastSignature = signature();
    cy.on('tap', 'node', (evt) => selectNode(evt.target.id()));
    cy.on('tap', 'edge', (evt) => selectEdge(evt.target.id()));
    cy.on('tap', (evt) => {
        if (evt.target === cy) clearSelection();
    });
    cy.on('mouseover', 'node', (evt) => hoverNode(evt.target));
    cy.on('mouseout', 'node', clearHover);
    cy.on('pan zoom resize layoutstop', updateZoneLabels);
    applyLockState();
    startFlowAnimation();
}

// Hover a service → spotlight it and its direct dependencies; restore on out.
// Skipped while a selection or flow overlay is active (that owns the focus).
function hasActiveFocus(): boolean {
    return Boolean(
        selectedNodeId.value ||
            selectedEdgeId.value ||
            selectedFlowId.value !== 'all'
    );
}

function hoverNode(node: cytoscape.NodeSingular): void {
    if (!cy || hasActiveFocus() || node.isParent()) return;
    // Dim only unrelated services — zone boxes stay full so the structure
    // never disappears, and nodes never double-fade with their parent box.
    cy.elements().not(node.closedNeighborhood()).not(':parent').addClass('faded');
}

function clearHover(): void {
    if (hasActiveFocus()) return;
    cy?.elements().removeClass('faded');
}

// HTML overlay positions: top-left of each zone box, in viewport pixels.
function updateZoneLabels(): void {
    if (!cy || cy.destroyed()) {
        zoneLabels.value = [];
        return;
    }
    const labels: ZoneLabel[] = [];
    for (const parent of cy.nodes(':parent')) {
        const box = parent.renderedBoundingBox({includeLabels: false});
        labels.push({
            id: parent.id(),
            label: String(parent.data('label') ?? ''),
            status: String(parent.data('zoneStatus') ?? 'healthy'),
            // Centre over the zone box; the label itself shifts -50% in CSS.
            x: Math.round((box.x1 + box.x2) / 2),
            y: Math.round(box.y1 - 16)
        });
    }
    zoneLabels.value = labels;
}

// Marching-ants dash offset = data flowing toward each arrow. Faded edges skip,
// so a selection shows only its path moving.
function startFlowAnimation(): void {
    flowTimer = setInterval(() => {
        if (!cy || cy.destroyed()) return;
        dashOffset = (dashOffset - 2) % 1000;
        cy.edges().not('.faded').style('line-dash-offset', dashOffset);
    }, 45);
}

// Structure signature: re-layout only when the set of modules/links changes.
// Pure attribute changes (status flips) patch in place — no jump, no reflow.
function signature(): string {
    const nodes = toElements().filter((el) => !('source' in (el.data ?? {})));
    const edges = toElements().filter((el) => 'source' in (el.data ?? {}));
    return `${nodes.map((n) => n.data.id).sort().join(',')}|${edges
        .map((e) => e.data.id)
        .sort()
        .join(',')}`;
}

function applyData(relayout: boolean): void {
    if (!cy || cy.destroyed()) return;
    const sig = signature();
    if (!relayout && sig === lastSignature) {
        for (const el of toElements()) {
            const item = cy.getElementById(String(el.data.id));
            if (item.empty()) continue;
            item.data(el.data);
        }
        applyFocus();
        return;
    }
    lastSignature = sig;
    cy.elements().remove();
    cy.add(toElements());
    // Layout is deterministic, so re-running it never causes a jump.
    runLayout();
    applyLockState();
    restoreSelection();
    applyFocus();
    updateZoneLabels();
}

function restoreSelection(): void {
    if (!cy) return;
    cy.$(':selected').unselect();
    if (selectedNodeId.value) {
        const node = cy.getElementById(selectedNodeId.value);
        if (!node.empty()) node.select();
        else selectedNodeId.value = null;
    }
    if (selectedEdgeId.value) {
        const edge = cy.getElementById(selectedEdgeId.value);
        if (!edge.empty()) edge.select();
        else selectedEdgeId.value = null;
    }
}

// ─── Focus: fade everything except the selection / chosen flow ───

function applyFocus(): void {
    if (!cy || cy.destroyed()) return;
    cy.elements().removeClass('faded');
    const keep = focusSet();
    // Never fade zone boxes — keeps the skeleton visible and stops nodes from
    // double-fading inside a dimmed parent.
    if (keep) cy.elements().not(keep).not(':parent').addClass('faded');
}

function focusSet(): cytoscape.CollectionReturnValue | null {
    if (!cy) return null;
    if (selectedNodeId.value) {
        const node = cy.getElementById(selectedNodeId.value);
        if (node.empty()) return null;
        // Keep the node, its neighbourhood, and the zone boxes they sit in.
        return node.closedNeighborhood().union(node.closedNeighborhood().parents());
    }
    if (selectedEdgeId.value) {
        const edge = cy.getElementById(selectedEdgeId.value);
        if (edge.empty()) return null;
        const ends = edge.connectedNodes();
        return ends.union(edge).union(ends.parents());
    }
    if (selectedFlowId.value !== 'all') return flowElements();
    return null;
}

function flowElements(): cytoscape.CollectionReturnValue | null {
    if (!cy) return null;
    const flow = flows.value.find((f) => f.id === selectedFlowId.value);
    if (!flow) return null;
    let acc = cy.collection();
    for (const id of flow.orderedNodeIds) acc = acc.union(cy.getElementById(id));
    for (const id of flow.expectedEdgeIds) acc = acc.union(cy.getElementById(id));
    return acc;
}

// ─── Selection ───

function selectNode(id: string): void {
    selectedNodeId.value = id;
    selectedEdgeId.value = null;
    if (cy) {
        cy.$(':selected').unselect();
        cy.getElementById(id).select();
    }
    applyFocus();
}

function selectEdge(id: string): void {
    selectedEdgeId.value = id;
    selectedNodeId.value = null;
    if (cy) {
        cy.$(':selected').unselect();
        cy.getElementById(id).select();
    }
    applyFocus();
}

function clearSelection(): void {
    selectedNodeId.value = null;
    selectedEdgeId.value = null;
    cy?.$(':selected').unselect();
    applyFocus();
}

function openSelectedNodeHistory(): void {
    historyNodeId.value = selectedNodeId.value;
}

// ─── Toolbar ───

function fitView(): void {
    cy?.fit(undefined, 32);
}

function toggleUnhealthy(): void {
    unhealthyOnly.value = !unhealthyOnly.value;
    applyData(true);
}

function resetView(): void {
    clearSelection();
    selectedFlowId.value = 'all';
    fitView();
}

function toggleFullscreen(): void {
    fullscreen.value = !fullscreen.value;
    requestAnimationFrame(() => {
        cy?.resize();
        frameView();
    });
}

// Lock: freeze the whole diagram — no panning, zooming, dragging, or drift.
// Clicking to select still works; Fit/Reset still drive the view in code.
function toggleLock(): void {
    locked.value = !locked.value;
    applyLockState();
}

function applyLockState(): void {
    if (!cy) return;
    const frozen = locked.value;
    cy.userPanningEnabled(!frozen);
    cy.userZoomingEnabled(!frozen);
    cy.boxSelectionEnabled(!frozen);
    cy.autoungrabify(frozen);
    if (frozen) cy.nodes().lock();
    else cy.nodes().unlock();
}

function onFlowChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    selectedFlowId.value = value === 'all' ? 'all' : (value as TopologyFlowId);
    applyFocus();
}

// ─── Wiring ───

onMounted(() => {
    init();
    store.startPolling();
});

onBeforeUnmount(() => {
    store.stopPolling();
    if (flowTimer) clearInterval(flowTimer);
    flowTimer = null;
    cy?.destroy();
    cy = null;
});

watch(
    () => store.current,
    () => applyData(false),
    {deep: true}
);

// The side panel changes the canvas width. Re-measure, re-fit into the new
// width, then recompute label positions — otherwise labels detach from boxes.
watch(
    () => Boolean(selectedNode.value || selectedEdge.value),
    () => {
        requestAnimationFrame(() => {
            if (!cy || cy.destroyed()) return;
            cy.resize();
            cy.fit(undefined, 32);
            updateZoneLabels();
        });
    }
);
</script>

<style scoped>
.topology-diagram {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: 100%;
    /* Opaque base so the app background photo can never bleed through gaps. */
    background: var(--color-surface-1);
    border-radius: var(--radius-md);
}
.topology-diagram.is-fullscreen {
    position: fixed;
    inset: var(--space-3);
    z-index: 55;
    padding: var(--space-3);
    background: var(--color-surface-bg);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-2xl);
}
.topology-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: var(--space-2);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
}
.flow-select {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
}
.flow-select-label {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.flow-select-input {
    min-height: 32px;
    padding: 0 var(--space-3);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-surface-3);
    color: var(--color-text-primary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    cursor: pointer;
}
.toolbar-right {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-1);
}
.tool-btn {
    min-height: 32px;
    padding: 0 var(--space-3);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-surface-3);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    cursor: pointer;
    transition:
        background var(--duration-normal) ease,
        color var(--duration-normal) ease;
}
.tool-btn:hover {
    background: var(--color-surface-4);
    color: var(--color-text-primary);
}
.tool-btn.active {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: var(--color-text-on-primary);
}
.tool-btn:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: 1px;
}
.topology-banner {
    padding: var(--space-2) var(--space-3);
    background: var(--color-warning-subtle);
    color: var(--color-warning-text);
    border-radius: var(--radius-md);
    font-size: var(--type-body);
}
.topology-banner.is-error {
    background: var(--color-danger-subtle);
    color: var(--color-danger-text);
}
/* Quick-jump chips for live incidents — click selects the affected service. */
.incident-strip {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
}
.incident-hint {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    max-width: 360px;
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-pill, 999px);
    background: var(--color-surface-2);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    cursor: pointer;
    transition: background var(--duration-normal) ease;
}
.incident-hint:hover {
    background: var(--color-surface-3);
    color: var(--color-text-primary);
}
.incident-hint.is-warning {
    border-color: var(--color-warning);
}
.incident-hint.is-critical {
    border-color: var(--color-danger);
}
.incident-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    flex: none;
}
.incident-hint.is-warning .incident-dot {
    background: var(--color-warning);
}
.incident-hint.is-critical .incident-dot {
    background: var(--color-danger);
}
.incident-message {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
/* Canvas full width; on selection the inspector takes a side column. */
.topology-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
    gap: var(--space-3);
    width: 100%;
}
.topology-body.has-inspector {
    grid-template-columns: minmax(0, 1fr) minmax(300px, 360px);
}
.is-fullscreen .topology-body {
    flex: 1;
    min-height: 0;
    align-items: stretch;
}
.topology-canvas-wrap {
    position: relative;
    width: 100%;
    height: clamp(460px, 64vh, 760px);
}
.is-fullscreen .topology-canvas-wrap {
    height: 100%;
}
/* Solid surface — opaque so the app background photo can't show through. */
.topology-canvas {
    width: 100%;
    height: 100%;
    background: var(--color-surface-1);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
}
/* Zone labels drawn on top of the canvas so nodes can't cover them. */
.zone-labels {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    border-radius: var(--radius-md);
}
.zone-label {
    position: absolute;
    top: 0;
    left: 0;
    padding: 2px 7px;
    border-radius: 4px;
    background: var(--color-surface-1);
    color: var(--color-text-tertiary);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    white-space: nowrap;
    will-change: transform;
}
.zone-label.is-warning {
    color: var(--color-warning);
}
.zone-label.is-critical {
    color: var(--color-danger);
}
.topology-inspector-panel {
    align-self: start;
    width: 100%;
    max-height: clamp(460px, 64vh, 760px);
    overflow-y: auto;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
}
@media (max-width: 900px) {
    .topology-body.has-inspector {
        grid-template-columns: minmax(0, 1fr);
    }
    .topology-inspector-panel {
        max-height: 340px;
    }
}
/* Fullscreen: the inspector fills the whole column height, not a fixed cap. */
.is-fullscreen .topology-inspector-panel {
    align-self: stretch;
    max-height: none;
    height: 100%;
}
</style>
