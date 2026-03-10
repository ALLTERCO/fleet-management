<template>
    <BasicBlock darker bordered>
        <div class="space-y-2">
            <h3 class="font-semibold text-sm text-[var(--color-text-secondary)]">System Data Flow</h3>
            <div class="w-full overflow-x-auto">
                <svg :viewBox="`0 0 ${W} ${H}`" class="w-full min-w-[1000px]" style="height: auto; max-height: 400px;">
                    <defs>
                        <marker v-for="c in markerColors" :key="c.name"
                            :id="`arrow-${c.name}`" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                            <polygon points="0 0, 8 3, 0 6" :fill="c.color" />
                        </marker>
                    </defs>

                    <!-- Edges (behind nodes) -->
                    <g v-for="edge in edges" :key="edge.id">
                        <path
                            :d="edge.path"
                            fill="none"
                            :stroke="statusColor(edge.status)"
                            stroke-width="2"
                            :marker-end="`url(#arrow-${statusColorName(edge.status)})`"
                            class="edge-flowing"
                            :style="{ '--flow-speed': animDuration(edge.throughput) }"
                        />
                        <!-- Animated dot traveling along edge -->
                        <circle r="3.5" :fill="statusColor(edge.status)" opacity="0.8">
                            <animateMotion :dur="animDuration(edge.throughput)" repeatCount="indefinite" :path="edge.path" />
                        </circle>
                    </g>

                    <!-- Edge labels (rendered ABOVE edges so lines don't overlap text) -->
                    <g v-for="edge in edges" :key="`label-${edge.id}`">
                        <g v-if="edge.label">
                            <rect
                                :x="edge.labelX - (edge.label.length * 3.25 + 5)"
                                :y="edge.labelY - 13"
                                :width="edge.label.length * 6.5 + 10"
                                :height="18"
                                rx="4"
                                fill="#0f172a"
                                opacity="0.95"
                                stroke="#334155"
                                stroke-width="0.5"
                            />
                            <text
                                :x="edge.labelX"
                                :y="edge.labelY"
                                text-anchor="middle"
                                fill="#e2e8f0"
                                style="font-size: 10px; font-family: var(--font-mono, monospace); font-weight: 500;"
                            >
                                {{ edge.label }}
                            </text>
                        </g>
                    </g>

                    <!-- Nodes -->
                    <g
                        v-for="node in nodes"
                        :key="node.id"
                        class="cursor-pointer"
                        @click="navigate(node.route)"
                    >
                        <title>{{ node.tooltip }}</title>
                        <rect
                            :x="node.x"
                            :y="node.y"
                            :width="NW"
                            :height="NH"
                            rx="8"
                            :fill="nodeFill(node.status)"
                            :stroke="nodeStroke(node.status)"
                            stroke-width="1.5"
                            class="transition-colors"
                        />
                        <text
                            :x="node.x + NW / 2"
                            :y="node.y + 18"
                            text-anchor="middle"
                            :fill="nodeTextColor(node.status)"
                            style="font-size: 10px; font-weight: 600;"
                        >
                            {{ node.label }}
                        </text>
                        <text
                            :x="node.x + NW / 2"
                            :y="node.y + 34"
                            text-anchor="middle"
                            fill="var(--color-text-secondary)"
                            style="font-size: 9px; font-family: var(--font-mono, monospace);"
                        >
                            {{ node.metric1 }}
                        </text>
                        <text
                            v-if="node.metric2"
                            :x="node.x + NW / 2"
                            :y="node.y + 48"
                            text-anchor="middle"
                            fill="var(--color-text-disabled)"
                            style="font-size: 9px; font-family: var(--font-mono, monospace);"
                        >
                            {{ node.metric2 }}
                        </text>
                    </g>
                </svg>
            </div>
        </div>
    </BasicBlock>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {useRouter} from 'vue-router/auto';
import BasicBlock from '@/components/core/BasicBlock.vue';
import type {FlowStatus} from '@/stores/monitoring';
import {useMonitoringStore} from '@/stores/monitoring';

const store = useMonitoringStore();
const router = useRouter();

// ── Layout constants ──────────────────────────────────────────────
const W = 1160;
const H = 380;
const NW = 120;
const NH = 56;

const ROW1_Y = 50;
const ROW2_Y = 250;
const CY1 = ROW1_Y + NH / 2; // 78
const CY2 = ROW2_Y + NH / 2; // 278
const BOT1 = ROW1_Y + NH; // 106

// Node x-positions
// Top:    mDNS → Devices → Waiting Room → Init Queue → Registry → Pipeline → Database
// Bottom: Frontend Clients    RPC Commands    Events & Plugins    EM Sync
const X = {
    mdns: 10,
    devices: 175,
    waitingRoom: 340,
    initQueue: 505,
    registry: 670,
    pipeline: 835,
    database: 1000,
    frontend: 10,
    rpc: 340,
    events: 530,
    emSync: 720
};

const markerColors = [
    {name: 'green', color: '#4ade80'},
    {name: 'yellow', color: '#fbbf24'},
    {name: 'red', color: '#f87171'},
    {name: 'gray', color: '#6b7280'}
];

interface FlowNode {
    id: string;
    label: string;
    x: number;
    y: number;
    status: FlowStatus;
    metric1: string;
    metric2: string;
    route: string;
    tooltip: string;
}

interface FlowEdge {
    id: string;
    path: string;
    status: FlowStatus;
    label: string;
    labelX: number;
    labelY: number;
    throughput: number;
}

// ── Active modules (dynamically detect what's running) ────────────
const activeModules = computed(() => {
    const m = store.latestMetrics?.modules ?? {};
    return {
        mdns: !!m.mdns,
        waitingRoom: !!m.waitingRoom,
        emSync: !!m.emSync,
        plugins: !!m.plugins,
        events: !!m.events
    };
});

// ── Nodes ──────────────────────────────────────────────────────────
const nodes = computed<FlowNode[]>(() => {
    const s = store.latest;
    if (!s) return [];
    const am = activeModules.value;

    const all: FlowNode[] = [
        // ── Top row: device ingest pipeline ──
        // mDNS only shown if module is registered
        ...(am.mdns
            ? [
                  {
                      id: 'mdns',
                      label: 'mDNS Discovery',
                      x: X.mdns,
                      y: ROW1_Y,
                      status: (s.mdnsRunning > 0
                          ? 'healthy'
                          : 'unknown') as FlowStatus,
                      metric1: s.mdnsRunning > 0 ? 'Running' : 'Stopped',
                      metric2: '',
                      route: '/monitoring/services',
                      tooltip:
                          'Local network device discovery via multicast DNS'
                  }
              ]
            : []),
        {
            id: 'devices',
            label: 'Devices',
            x: am.mdns ? X.devices : X.mdns,
            y: ROW1_Y,
            status: store.deviceIngestStatus,
            metric1: `${s.devicesTotal} online`,
            metric2: `${store.counterRates.devices_connected ?? 0}/min new`,
            route: '/monitoring/device-ingest',
            tooltip: 'Connected Shelly devices communicating via WebSocket'
        },
        // Waiting Room only shown if module is registered
        ...(am.waitingRoom
            ? [
                  {
                      id: 'waiting-room',
                      label: 'Waiting Room',
                      x: X.waitingRoom,
                      y: ROW1_Y,
                      status: store.waitingRoomStatus,
                      metric1: `${s.waitingRoomPending} pending`,
                      metric2: '',
                      route: '/monitoring/services',
                      tooltip:
                          'Devices pending admin approval before initialization'
                  }
              ]
            : []),
        {
            id: 'init-queue',
            label: 'Init Queue',
            x: am.waitingRoom ? X.initQueue : X.waitingRoom,
            y: ROW1_Y,
            status: (s.initActive > 80
                ? 'critical'
                : s.initActive > 50
                  ? 'warning'
                  : 'healthy') as FlowStatus,
            metric1: `${s.initActive}/100 active`,
            metric2: `${s.initQueued} queued`,
            route: '/monitoring/device-ingest',
            tooltip: 'Concurrent device initialization pipeline (max 100)'
        },
        {
            id: 'registry',
            label: 'Device Registry',
            x: X.registry,
            y: ROW1_Y,
            status: 'healthy' as FlowStatus,
            metric1: `${s.devicesTotal} registered`,
            metric2: `${store.counterRates.devices_connected ?? 0}/min`,
            route: '/monitoring/device-ingest',
            tooltip: 'In-memory registry of all connected devices'
        },
        {
            id: 'status-pipeline',
            label: 'Status Pipeline',
            x: X.pipeline,
            y: ROW1_Y,
            status: store.statusPipelineStatus,
            metric1: `queue: ${s.statusQueueSize}`,
            metric2: `${s.statusMsgRate}/min msgs`,
            route: '/monitoring/database',
            tooltip: 'Queued device status updates waiting for DB write'
        },
        {
            id: 'database',
            label: 'Database',
            x: X.database,
            y: ROW1_Y,
            status: store.databaseStatus,
            metric1: `pool: ${s.dbPoolTotal - s.dbPoolIdle}/${s.dbPoolTotal}`,
            metric2: `avg: ${s.dbAvgMs}ms`,
            route: '/monitoring/database',
            tooltip: 'PostgreSQL connection pool and query performance'
        },
        // ── Bottom row: user-facing & services ──
        {
            id: 'frontend',
            label: 'Browser Sessions',
            x: X.frontend,
            y: ROW2_Y,
            status: (s.wsClients > 0 ? 'healthy' : 'warning') as FlowStatus,
            metric1: `${s.wsClients} browsers`,
            metric2: `${s.eventsBroadcastRate}/min events`,
            route: '/monitoring/overview',
            tooltip: 'Active browser sessions connected via WebSocket'
        },
        {
            id: 'rpc',
            label: 'RPC Commands',
            x: X.rpc,
            y: ROW2_Y,
            status: store.rpcCommandsStatus,
            metric1: `avg: ${s.rpcAvgMs}ms`,
            metric2: `err: ${s.rpcErrorRate}/min`,
            route: '/monitoring/commands',
            tooltip: 'Device commands relayed from browser to device'
        },
        {
            id: 'events',
            label: 'Events & Plugins',
            x: X.events,
            y: ROW2_Y,
            status: store.eventsStatus,
            metric1: `${s.eventsListeners} listeners`,
            metric2: `${s.pluginsLoaded} plugins`,
            route: '/monitoring/events',
            tooltip: 'Event distribution system and loaded plugins'
        },
        // EM Sync only shown if module is registered
        ...(am.emSync
            ? [
                  {
                      id: 'em-sync',
                      label: 'EM Sync',
                      x: X.emSync,
                      y: ROW2_Y,
                      status: store.emSyncStatus,
                      metric1: `${s.emActiveSyncs} syncing`,
                      metric2: `queue: ${s.emQueueSize}`,
                      route: '/monitoring/services',
                      tooltip: 'Energy meter data synchronization service'
                  }
              ]
            : [])
    ];

    return all;
});

// Set of active node IDs for filtering edges
const activeNodeIds = computed(() => new Set(nodes.value.map((n) => n.id)));

// Edge-to-node mapping: which nodes each edge requires
const edgeRequires: Record<string, string[]> = {
    'mdns-devices': ['mdns'],
    'devices-waiting': ['waiting-room'],
    'waiting-init': ['waiting-room'],
    'registry-emsync': ['em-sync'],
    'pipeline-emsync': ['em-sync'],
    'emsync-db': ['em-sync']
};

// ── Edges ──────────────────────────────────────────────────────────
const edges = computed<FlowEdge[]>(() => {
    const s = store.latest;
    if (!s) return [];

    const rates = store.counterRates;
    const ids = activeNodeIds.value;

    // Get the actual x positions of nodes for dynamic path calculation
    const nodeMap = new Map(nodes.value.map((n) => [n.id, n]));
    const devicesX = nodeMap.get('devices')?.x ?? X.devices;
    const initQueueX = nodeMap.get('init-queue')?.x ?? X.initQueue;

    const all: FlowEdge[] = [
        // ── Top row: main ingest pipeline (left to right) ──
        {
            id: 'mdns-devices',
            path: `M${X.mdns + NW},${CY1} L${devicesX},${CY1}`,
            status: (s.mdnsRunning > 0 ? 'healthy' : 'unknown') as FlowStatus,
            label: 'discover',
            labelX: (X.mdns + NW + devicesX) / 2,
            labelY: ROW1_Y - 12,
            throughput: s.mdnsRunning > 0 ? 1 : 0
        },
        {
            id: 'devices-waiting',
            path: `M${devicesX + NW},${CY1} L${X.waitingRoom},${CY1}`,
            status: store.deviceIngestStatus,
            label: 'WS connect',
            labelX: (devicesX + NW + X.waitingRoom) / 2,
            labelY: ROW1_Y - 12,
            throughput: rates.devices_connected ?? s.devicesTotal
        },
        {
            id: 'waiting-init',
            path: `M${X.waitingRoom + NW},${CY1} L${initQueueX},${CY1}`,
            status: store.waitingRoomStatus,
            label: 'accept',
            labelX: (X.waitingRoom + NW + initQueueX) / 2,
            labelY: ROW1_Y - 12,
            throughput: rates.device_inits_started ?? s.initActive
        },
        // Direct devices → init when no waiting room
        {
            id: 'devices-init',
            path: `M${devicesX + NW},${CY1} L${initQueueX},${CY1}`,
            status: store.deviceIngestStatus,
            label: 'WS connect',
            labelX: (devicesX + NW + initQueueX) / 2,
            labelY: ROW1_Y - 12,
            throughput: rates.devices_connected ?? s.devicesTotal
        },
        {
            id: 'init-registry',
            path: `M${initQueueX + NW},${CY1} L${X.registry},${CY1}`,
            status: store.deviceIngestStatus,
            label: 'register',
            labelX: (initQueueX + NW + X.registry) / 2,
            labelY: ROW1_Y - 12,
            throughput: rates.device_inits_completed ?? s.devicesTotal
        },
        {
            id: 'registry-pipeline',
            path: `M${X.registry + NW},${CY1} L${X.pipeline},${CY1}`,
            status: store.statusPipelineStatus,
            label: `${s.statusMsgRate}/min`,
            labelX: (X.registry + NW + X.pipeline) / 2,
            labelY: ROW1_Y - 12,
            throughput: s.statusMsgRate
        },
        {
            id: 'pipeline-db',
            path: `M${X.pipeline + NW},${CY1} L${X.database},${CY1}`,
            status: store.databaseStatus,
            label: `${s.dbAvgMs}ms`,
            labelX: (X.pipeline + NW + X.database) / 2,
            labelY: ROW1_Y - 12,
            throughput: rates.status_flushes ?? s.statusMsgRate
        },

        // ── Cross-row: Registry fans out to services ──
        {
            id: 'registry-rpc',
            path: `M${X.registry + 40},${BOT1} L${X.rpc + NW / 2},${ROW2_Y}`,
            status: store.rpcCommandsStatus,
            label: 'relay',
            labelX: (X.registry + 40 + X.rpc + NW / 2) / 2 - 15,
            labelY: (BOT1 + ROW2_Y) / 2 - 8,
            throughput: rates.rpc_success ?? (s.rpcAvgMs > 0 ? 1 : 0)
        },
        {
            id: 'registry-events',
            path: `M${X.registry + 80},${BOT1} L${X.events + NW / 2},${ROW2_Y}`,
            status: store.eventsStatus,
            label: `${s.eventsBroadcastRate}/min`,
            labelX: (X.registry + 80 + X.events + NW / 2) / 2 + 15,
            labelY: (BOT1 + ROW2_Y) / 2 - 8,
            throughput: s.eventsBroadcastRate
        },
        {
            id: 'registry-emsync',
            path: `M${X.registry + NW},${BOT1} C${X.registry + NW + 20},${BOT1 + 50} ${X.emSync + NW / 2 - 20},${ROW2_Y - 30} ${X.emSync + NW / 2},${ROW2_Y}`,
            status: store.emSyncStatus,
            label: 'poll 5s',
            labelX: (X.registry + NW + X.emSync) / 2 + 20,
            labelY: (BOT1 + ROW2_Y) / 2 + 10,
            throughput: s.emActiveSyncs
        },
        {
            id: 'pipeline-emsync',
            path: `M${X.pipeline + NW / 2},${BOT1} L${X.emSync + NW / 2},${ROW2_Y}`,
            status: store.emSyncStatus,
            label: 'trigger',
            labelX: (X.pipeline + NW / 2 + X.emSync + NW / 2) / 2 + 20,
            labelY: (BOT1 + ROW2_Y) / 2 - 8,
            throughput: s.emActiveSyncs
        },

        // ── EM Sync → Database (writes energy data) ──
        {
            id: 'emsync-db',
            path: `M${X.emSync + NW},${CY2} L${X.database},${CY1 + 14}`,
            status: store.emSyncStatus,
            label: 'write',
            labelX: (X.emSync + NW + X.database) / 2,
            labelY: (CY2 + CY1 + 14) / 2 - 10,
            throughput: s.emActiveSyncs
        },

        // ── Bottom row: user interaction loop ──
        {
            id: 'frontend-rpc',
            path: `M${X.frontend + NW},${CY2} L${X.rpc},${CY2}`,
            status: store.rpcCommandsStatus,
            label: 'commands',
            labelX: (X.frontend + NW + X.rpc) / 2,
            labelY: ROW2_Y - 12,
            throughput: rates.rpc_success ?? (s.rpcAvgMs > 0 ? 1 : 0)
        },
        {
            id: 'rpc-events',
            path: `M${X.rpc + NW},${CY2} L${X.events},${CY2}`,
            status: store.eventsStatus,
            label: '',
            labelX: 0,
            labelY: 0,
            throughput: rates.rpc_success ?? s.eventsListeners
        },
        // Events broadcast back to Browser Clients (curved above bottom row)
        {
            id: 'events-frontend',
            path: `M${X.events},${ROW2_Y} C${380},${ROW2_Y - 60} ${260},${ROW2_Y - 60} ${X.frontend + NW},${ROW2_Y}`,
            status: store.eventsStatus,
            label: 'broadcast',
            labelX: (X.events + X.frontend + NW) / 2,
            labelY: ROW2_Y - 65,
            throughput: s.eventsBroadcastRate
        }
    ];

    // Filter: only show edges whose required nodes are active
    // Also handle conditional routing (devices-waiting vs devices-init)
    return all.filter((edge) => {
        // devices-waiting only if waiting-room exists
        if (edge.id === 'devices-waiting' && !ids.has('waiting-room'))
            return false;
        // devices-init only if waiting-room does NOT exist
        if (edge.id === 'devices-init' && ids.has('waiting-room')) return false;
        // Check edgeRequires mapping
        const required = edgeRequires[edge.id];
        if (required) return required.every((id) => ids.has(id));
        return true;
    });
});

function navigate(route: string) {
    router.push(route);
}

function statusColor(status: FlowStatus): string {
    switch (status) {
        case 'critical':
            return '#f87171';
        case 'warning':
            return '#fbbf24';
        case 'healthy':
            return '#4ade80';
        default:
            return '#6b7280';
    }
}

function statusColorName(status: FlowStatus): string {
    switch (status) {
        case 'critical':
            return 'red';
        case 'warning':
            return 'yellow';
        case 'healthy':
            return 'green';
        default:
            return 'gray';
    }
}

function nodeFill(status: FlowStatus): string {
    switch (status) {
        case 'critical':
            return '#450a0a80';
        case 'warning':
            return '#451a0380';
        case 'healthy':
            return '#1a2e1a80';
        default:
            return '#26262680';
    }
}

function nodeStroke(status: FlowStatus): string {
    switch (status) {
        case 'critical':
            return '#dc2626';
        case 'warning':
            return '#d97706';
        case 'healthy':
            return '#16a34a';
        default:
            return '#525252';
    }
}

function nodeTextColor(status: FlowStatus): string {
    switch (status) {
        case 'critical':
            return '#fca5a5';
        case 'warning':
            return '#fcd34d';
        case 'healthy':
            return '#bbf7d0';
        default:
            return '#a3a3a3';
    }
}

function animDuration(throughput: number): string {
    if (throughput > 100) return '0.8s';
    if (throughput > 10) return '1.5s';
    if (throughput > 0) return '3s';
    return '4s';
}
</script>

<style scoped>
.edge-flowing {
    stroke-dasharray: 12 6;
    animation: edge-flow var(--flow-speed, 4s) linear infinite;
}

@keyframes edge-flow {
    to {
        stroke-dashoffset: -18;
    }
}
</style>
