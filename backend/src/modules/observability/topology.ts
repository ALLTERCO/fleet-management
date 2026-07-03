import * as os from 'node:os';
import * as log4js from 'log4js';
import {tuning} from '../../config/tuning';
import {getLevel} from './samplers';
import {counters, edgeCounters, modules} from './state';
import {
    inferTopologyFlowsFromText,
    TOPOLOGY_FLOW_DEFINITIONS
} from './topologyFlowDefinitions';
import type {
    EdgeCounter,
    HttpStats,
    HttpStatsGetter,
    ModuleClusterId,
    ModuleRegistration,
    ModuleStatsGetter,
    ModuleStatus,
    ThresholdPair,
    TopologyCluster,
    TopologyCriticality,
    TopologyEdge,
    TopologyEdgeKind,
    TopologyFlow,
    TopologyFlowId,
    TopologyNode,
    TopologySnapshot,
    TopologyZone,
    TopologyZoneId
} from './types';
import {pushRing} from './util/ringBuffer';
import {
    dropExpiredBefore,
    seriesFor,
    type TimestampedSample
} from './util/timeWindowSeries';

const logger = log4js.getLogger('Observability');

// Function form is the v1 API; object form adds topology metadata.
export function registerModule(name: string, getter: ModuleStatsGetter): void;
export function registerModule(name: string, reg: ModuleRegistration): void;
export function registerModule(
    name: string,
    arg: ModuleStatsGetter | ModuleRegistration
): void {
    const reg: ModuleRegistration =
        typeof arg === 'function' ? {stats: arg} : arg;
    modules.set(name, reg);
}

export function registerEdgeCounter(edge: EdgeCounter): void {
    edgeCounters.push(edge);
}

// Rate-limit getter warnings per module so a broken getter can't flood logs.
const lastGetterWarnTs = new Map<string, number>();

export function warnGetterFailed(name: string, err: unknown): void {
    const now = Date.now();
    const last = lastGetterWarnTs.get(name) ?? 0;
    if (now - last < tuning.observability.getterWarnMinIntervalMs) return;
    lastGetterWarnTs.set(name, now);
    logger.warn('Module stats getter failed for %s: %s', name, err);
}

// Rate = delta / elapsed × 60_000 over the active window.
const counterSamples = new Map<string, TimestampedSample[]>();

interface NamedSample {
    name: string;
    value: number;
    ts: number;
}

function recordCounterSample(sample: NamedSample): void {
    const series = seriesFor(counterSamples, sample.name);
    series.push({ts: sample.ts, value: sample.value});
    dropExpiredBefore(
        series,
        sample.ts - tuning.observability.edgeCounterWindowMs
    );
}

function counterRatePerMin(name: string): number {
    const samples = counterSamples.get(name);
    if (!samples || samples.length < 2) return 0;
    const oldest = samples[0];
    const latest = samples[samples.length - 1];
    const elapsedMs = latest.ts - oldest.ts;
    if (elapsedMs <= 0) return 0;
    return Math.round(((latest.value - oldest.value) / elapsedMs) * 60_000);
}

interface NodeStat {
    stats: Record<string, unknown>;
    status: ModuleStatus;
}

const ZONES: readonly TopologyZone[] = [
    {
        id: 'ingress',
        label: 'Ingress',
        description: 'Device and inbound system entry points',
        order: 10,
        collapseByDefault: false
    },
    {
        id: 'device_admission',
        label: 'Device Admission',
        description: 'Discovery, waiting room, and initial device acceptance',
        order: 20,
        collapseByDefault: false
    },
    {
        id: 'device_data_pipeline',
        label: 'Device Data Pipeline',
        description: 'Device events, status, queues, and transforms',
        order: 30,
        collapseByDefault: false
    },
    {
        id: 'command_plane',
        label: 'Command Plane',
        description: 'RPC command dispatch, execution, and responses',
        order: 40,
        collapseByDefault: false
    },
    {
        id: 'runtime',
        label: 'Runtime',
        description: 'Application runtime modules and worker services',
        order: 50,
        collapseByDefault: false
    },
    {
        id: 'storage',
        label: 'Storage',
        description: 'Databases, persistence, audit, and durable state',
        order: 60,
        collapseByDefault: false
    },
    {
        id: 'auth_security',
        label: 'Auth / Security',
        description: 'Authentication, authorization, and policy checks',
        order: 70,
        collapseByDefault: false
    },
    {
        id: 'observability',
        label: 'Observability',
        description: 'Metrics, health, topology, and dashboards',
        order: 80,
        collapseByDefault: false
    },
    {
        id: 'ui_clients',
        label: 'UI / Clients',
        description: 'Browser clients, WebSocket clients, and RPC callers',
        order: 90,
        collapseByDefault: false
    },
    {
        id: 'operations',
        label: 'Operations',
        description: 'Deploy, firmware, commands, and operational workflows',
        order: 100,
        collapseByDefault: false
    },
    {
        id: 'integrations',
        label: 'Integrations',
        description: 'Plugins, workers, adapters, and internal integrations',
        order: 110,
        collapseByDefault: true
    },
    {
        id: 'external_systems',
        label: 'External Systems',
        description: 'External services and systems outside Fleet Manager',
        order: 120,
        collapseByDefault: false
    },
    {
        id: 'unclassified',
        label: 'Unclassified',
        description:
            'Registered modules missing explicit topology zone metadata',
        order: 130,
        collapseByDefault: false
    }
];

const ZONE_BY_CLUSTER: Record<ModuleClusterId, TopologyZoneId> = {
    ingest: 'ingress',
    pipeline: 'device_data_pipeline',
    storage: 'storage',
    clients: 'ui_clients',
    security: 'auth_security',
    services: 'runtime',
    meta: 'observability'
};

function readModuleStats(): Map<string, NodeStat> {
    const out = new Map<string, NodeStat>();
    const now = Date.now();
    for (const [name, reg] of modules) {
        const nodeStat = readOneModuleStats(name, reg, now);
        out.set(name, nodeStat);
    }
    return out;
}

function readOneModuleStats(
    name: string,
    reg: ModuleRegistration,
    now: number
): NodeStat {
    try {
        return collectModuleStats(name, reg, now);
    } catch (e) {
        warnGetterFailed(name, e);
        return {stats: {}, status: 'unknown'};
    }
}

function collectModuleStats(
    name: string,
    reg: ModuleRegistration,
    now: number
): NodeStat {
    const result = reg.stats();
    const status = (result.status as ModuleStatus | undefined) ?? 'healthy';
    recordModuleHistory(name, {ts: now, stats: result});
    return {stats: result, status};
}

function collectReferencedIds(): Set<string> {
    const ids = new Set<string>(modules.keys());
    for (const reg of modules.values()) {
        for (const u of reg.topology?.upstreams ?? []) ids.add(u);
        for (const d of reg.topology?.downstreams ?? []) ids.add(d);
    }
    for (const ec of edgeCounters) {
        ids.add(ec.from);
        ids.add(ec.to);
    }
    return ids;
}

function buildTopologyNode(
    id: string,
    nodeStat: NodeStat | undefined
): TopologyNode {
    const reg = modules.get(id);
    if (reg?.topology) {
        return {
            id,
            label: reg.topology.label ?? id,
            role: reg.topology.role,
            cluster: reg.topology.cluster ?? null,
            zone: topologyZone(reg),
            kind: reg.topology.kind ?? topologyKind(reg.topology.cluster),
            status: nodeStat?.status ?? 'unknown',
            stats: nodeStat?.stats ?? {},
            route: reg.topology.route ?? null,
            description: reg.topology.description ?? null,
            virtual: false,
            noisy: reg.topology.noisy ?? false,
            order: reg.topology.order ?? defaultOrder(id),
            owner: reg.topology.owner ?? null,
            criticality:
                reg.topology.criticality ??
                defaultCriticality(reg.topology.cluster),
            stale: false,
            participatesIn: topologyFlows(id, reg.topology.participatesIn),
            dataClasses: [...(reg.topology.dataClasses ?? [])],
            externalSystem: reg.topology.externalSystem ?? null,
            collapseByDefault: reg.topology.collapseByDefault ?? false
        };
    }
    if (reg) {
        // Registered without topology metadata — neutral defaults.
        return {
            id,
            label: id,
            role: 'service',
            cluster: null,
            zone: 'unclassified',
            kind: 'module',
            status: nodeStat?.status ?? 'unknown',
            stats: nodeStat?.stats ?? {},
            route: null,
            description: null,
            virtual: false,
            noisy: false,
            order: defaultOrder(id),
            owner: null,
            criticality: 'medium',
            stale: false,
            participatesIn: topologyFlows(id),
            dataClasses: [],
            externalSystem: null,
            collapseByDefault: false
        };
    }
    // Referenced but never registered — virtual external node.
    return {
        id,
        label: id,
        role: 'external',
        cluster: null,
        zone: 'external_systems',
        kind: 'external',
        status: 'unknown',
        stats: {},
        route: null,
        description: null,
        virtual: true,
        noisy: false,
        order: defaultOrder(id),
        owner: null,
        criticality: 'medium',
        stale: true,
        participatesIn: topologyFlows(id),
        dataClasses: [],
        externalSystem: id,
        collapseByDefault: false
    };
}

function buildTopologyEdges(ts: number): TopologyEdge[] {
    const edgeMap = new Map<string, TopologyEdge>();
    const upsert = (
        from: string,
        to: string,
        declared: boolean
    ): TopologyEdge => {
        const id = `${from}->${to}`;
        let edge = edgeMap.get(id);
        if (!edge) {
            edge = {
                id,
                from,
                to,
                direction: 'forward',
                kind: edgeKind(from, to),
                throughput: 0,
                counterName: null,
                latencyMetric: null,
                errorMetric: null,
                throughputMetric: null,
                status: 'healthy',
                criticality: edgeCriticality(from, to),
                declared,
                observed: false,
                stale: false,
                lastSeenAt: null,
                description: edgeDescription(from, to),
                participatesIn: edgeFlows(from, to)
            };
            edgeMap.set(id, edge);
        } else {
            edge.declared ||= declared;
        }
        return edge;
    };
    for (const [name, reg] of modules) {
        for (const d of reg.topology?.downstreams ?? []) upsert(name, d, true);
        for (const u of reg.topology?.upstreams ?? []) upsert(u, name, true);
    }
    for (const ec of edgeCounters) {
        const edge = upsert(ec.from, ec.to, false);
        const value = counters.get(ec.counter) ?? 0;
        recordCounterSample({name: ec.counter, value, ts});
        edge.throughput = counterRatePerMin(ec.counter);
        edge.counterName = ec.counter;
        edge.throughputMetric = ec.counter;
        edge.observed = true;
        edge.lastSeenAt = ts;
        if (!edge.declared) {
            edge.status = 'warning';
            edge.description = `${edge.from} to ${edge.to} observed without declared topology metadata`;
        }
    }
    return Array.from(edgeMap.values());
}

function topologyZone(reg: ModuleRegistration): TopologyZoneId {
    const topology = reg.topology;
    if (!topology) return 'unclassified';
    if (topology.zone) return topology.zone;
    return topology.cluster
        ? ZONE_BY_CLUSTER[topology.cluster]
        : 'unclassified';
}

function topologyKind(
    cluster: ModuleClusterId | undefined
): TopologyNode['kind'] {
    if (cluster === 'storage') return 'store';
    if (cluster === 'clients') return 'client';
    if (cluster === 'ingest') return 'device';
    if (cluster === 'meta') return 'module';
    return 'module';
}

function defaultCriticality(
    cluster: ModuleClusterId | undefined
): TopologyCriticality {
    if (cluster === 'storage' || cluster === 'security') return 'critical';
    if (cluster === 'pipeline' || cluster === 'ingest') return 'high';
    return 'medium';
}

function defaultOrder(id: string): number {
    return stableHash(id) % 10_000;
}

function stableHash(value: string): number {
    let hash = 0;
    for (const ch of value) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return hash;
}

function topologyFlows(
    id: string,
    explicit: readonly TopologyFlowId[] = []
): TopologyFlowId[] {
    return inferTopologyFlowsFromText(moduleSearchText(id), explicit);
}

function moduleSearchText(id: string): string {
    const topology = modules.get(id)?.topology;
    return [
        id,
        topology?.label ?? '',
        topology?.description ?? '',
        topology?.route ?? '',
        topology?.cluster ?? '',
        topology?.zone ?? '',
        topology?.role ?? ''
    ]
        .join(' ')
        .toLowerCase();
}

function edgeKind(from: string, to: string): TopologyEdgeKind {
    const text = `${moduleSearchText(from)} ${moduleSearchText(to)}`;
    if (text.includes('auth')) return 'auth';
    if (text.includes('db') || text.includes('database')) return 'storage';
    if (text.includes('observability') || text.includes('metric')) {
        return 'observability';
    }
    if (text.includes('deploy') || text.includes('runtime')) return 'deploy';
    if (text.includes('notification') || text.includes('webhook')) {
        return 'notification';
    }
    if (text.includes('external')) return 'external_api';
    return 'data';
}

function edgeCriticality(from: string, to: string): TopologyCriticality {
    const source = modules.get(from)?.topology?.criticality;
    const target = modules.get(to)?.topology?.criticality;
    if (source === 'critical' || target === 'critical') return 'critical';
    if (source === 'high' || target === 'high') return 'high';
    return 'medium';
}

function edgeDescription(from: string, to: string): string {
    return `${from} to ${to}`;
}

function edgeFlows(from: string, to: string): TopologyFlowId[] {
    const flows = new Set<TopologyFlowId>();
    for (const flow of topologyFlows(from)) {
        if (topologyFlows(to).includes(flow)) flows.add(flow);
    }
    return Array.from(flows);
}

const CLUSTER_LABELS: Record<ModuleClusterId, string> = {
    ingest: 'Ingest',
    pipeline: 'Pipeline',
    storage: 'Storage',
    clients: 'Clients',
    security: 'Security',
    services: 'Services',
    meta: 'Meta'
};

function buildTopologyClusters(
    nodes: readonly TopologyNode[]
): TopologyCluster[] {
    const seen = new Set<ModuleClusterId>();
    for (const n of nodes) if (n.cluster) seen.add(n.cluster);
    return Array.from(seen).map((id) => ({id, label: CLUSTER_LABELS[id]}));
}

export function snapshotTopology(): TopologySnapshot {
    const snap = buildTopologySnapshot();
    recordTopologyDiffSnapshot(snap);
    return snap;
}

function buildTopologySnapshot(): TopologySnapshot {
    const generatedAt = Date.now();
    const moduleStats = readModuleStats();
    const ids = collectReferencedIds();
    const nodes = Array.from(ids).map((id) =>
        buildTopologyNode(id, moduleStats.get(id))
    );
    const edges = buildTopologyEdges(generatedAt);
    return {
        schemaVersion: 2,
        generatedAt,
        zones: buildTopologyZones(nodes),
        nodes,
        edges,
        flows: buildTopologyFlows(nodes, edges),
        clusters: buildTopologyClusters(nodes),
        thresholds: anomalyThresholds()
    };
}

function buildTopologyZones(_nodes: readonly TopologyNode[]): TopologyZone[] {
    return [...ZONES];
}

function buildTopologyFlows(
    nodes: readonly TopologyNode[],
    edges: readonly TopologyEdge[]
): TopologyFlow[] {
    return TOPOLOGY_FLOW_DEFINITIONS.map((flow) => ({
        ...flow,
        orderedNodeIds: nodes
            .filter((node) => node.participatesIn.includes(flow.id))
            .sort(compareFlowNodes)
            .map((node) => node.id),
        expectedEdgeIds: edges
            .filter((edge) => edge.participatesIn.includes(flow.id))
            .map((edge) => edge.id)
    })).filter(
        (flow) =>
            flow.orderedNodeIds.length > 0 || flow.expectedEdgeIds.length > 0
    );
}

function compareFlowNodes(left: TopologyNode, right: TopologyNode): number {
    const zoneOrder = zoneOrderOf(left.zone) - zoneOrderOf(right.zone);
    if (zoneOrder !== 0) return zoneOrder;
    const order = left.order - right.order;
    return order === 0 ? left.id.localeCompare(right.id) : order;
}

function zoneOrderOf(id: TopologyZoneId): number {
    return ZONES.find((zone) => zone.id === id)?.order ?? 999;
}

function anomalyThresholds(): Record<string, ThresholdPair> {
    const t = tuning.observability;
    return {
        'db.avgMs': {warn: t.dbWarnMs, crit: t.dbCritMs},
        'rpc.avgMs': {warn: t.rpcWarnMs, crit: t.rpcCritMs},
        'status.queueSize': {warn: t.statusQueueWarn, crit: t.statusQueueCrit}
    };
}

// Short cache absorbs tab-switch / poll-storm bursts.
let cachedTopology: TopologySnapshot | null = null;
let cachedTopologyTs = 0;

export function getCachedTopologySnapshot(): TopologySnapshot {
    const now = Date.now();
    if (
        cachedTopology &&
        now - cachedTopologyTs < tuning.observability.topologyCacheMs
    ) {
        return cachedTopology;
    }
    cachedTopology = snapshotTopology();
    cachedTopologyTs = now;
    return cachedTopology;
}

// Self-register so the diagram shows the meta-cluster observability node.
registerModule('observability', {
    stats: () => ({
        moduleCount: modules.size,
        edgeCounterCount: edgeCounters.length,
        level: getLevel()
    }),
    topology: {
        role: 'service',
        cluster: 'meta',
        label: 'Observability',
        description: 'Metrics, counters, and topology snapshot'
    }
});

registerModule('uiClients', {
    stats: () => ({status: 'healthy'}),
    topology: {
        role: 'source',
        zone: 'ui_clients',
        kind: 'client',
        label: 'UI / API Clients',
        description:
            'Operator browser sessions, API consumers, and live dashboard clients.',
        upstreams: ['events', 'observability'],
        downstreams: ['auth', 'wsCommands'],
        participatesIn: [
            'new_device_added',
            'device_status_report',
            'user_sends_command',
            'create_group',
            'user_login',
            'permission_check',
            'deploy_update',
            'metrics_scrape'
        ],
        route: '/monitoring/activity',
        owner: 'platform',
        criticality: 'high',
        order: 10,
        dataClasses: ['operator_activity']
    }
});

registerModule('deployManifest', {
    stats: () => ({status: 'healthy'}),
    topology: {
        role: 'source',
        zone: 'operations',
        kind: 'runtime',
        label: 'Deploy Manifest',
        description:
            'Machine-readable deployment contract, image identity, checks, and rollback metadata.',
        upstreams: ['authz'],
        downstreams: ['runtimeVersion'],
        participatesIn: ['deploy_update'],
        route: '/monitoring/runtime',
        owner: 'devops',
        criticality: 'critical',
        order: 20,
        dataClasses: ['deployment_contract']
    }
});

registerModule('runtimeVersion', {
    stats: () => ({status: 'healthy'}),
    topology: {
        role: 'service',
        zone: 'runtime',
        kind: 'runtime',
        label: 'Runtime Version',
        description:
            'Running Fleet Manager process identity, build commit, image tag, and deployment mode.',
        upstreams: ['deployManifest'],
        downstreams: ['deployChecks', 'observability'],
        participatesIn: ['deploy_update', 'metrics_scrape'],
        route: '/monitoring/runtime',
        owner: 'platform',
        criticality: 'critical',
        order: 10,
        dataClasses: ['runtime_identity']
    }
});

const BYTES_PER_MB = 1_048_576;

// Free memory as % of total (host-size agnostic); heap in MB. Fixed, not env.
export const HOST_FREE_MEM_WARN_PCT = 10;
export const HOST_FREE_MEM_CRIT_PCT = 5;
export const HOST_HEAP_WARN_MB = 256;
export const HOST_HEAP_CRIT_MB = 512;

// Worst of free-memory % / heap → node status, so pressure shows red.
export function hostResourceStatus(
    freeMemPct: number,
    heapUsedMb: number
): ModuleStatus {
    if (
        freeMemPct <= HOST_FREE_MEM_CRIT_PCT ||
        heapUsedMb >= HOST_HEAP_CRIT_MB
    ) {
        return 'critical';
    }
    if (
        freeMemPct <= HOST_FREE_MEM_WARN_PCT ||
        heapUsedMb >= HOST_HEAP_WARN_MB
    ) {
        return 'warning';
    }
    return 'healthy';
}

registerModule('hostResources', {
    stats: () => {
        const freeMemMb = Math.round(os.freemem() / BYTES_PER_MB);
        const totalMemMb = Math.round(os.totalmem() / BYTES_PER_MB);
        const freeMemPct = Math.round((freeMemMb / totalMemMb) * 100);
        const heapUsedMb = Math.round(
            process.memoryUsage().heapUsed / BYTES_PER_MB
        );
        return {
            status: hostResourceStatus(freeMemPct, heapUsedMb),
            freeMemMb,
            totalMemMb,
            freeMemPct,
            heapUsedMb,
            load1m: Number(os.loadavg()[0].toFixed(2))
        };
    },
    topology: {
        role: 'service',
        zone: 'runtime',
        kind: 'runtime',
        label: 'Host Resources',
        description:
            'OS free memory, process heap, and load average for the host.',
        downstreams: ['observability'],
        participatesIn: ['metrics_scrape'],
        route: '/monitoring/resources',
        owner: 'platform',
        criticality: 'critical',
        order: 20
    }
});

registerModule('deployChecks', {
    stats: () => ({status: 'healthy'}),
    topology: {
        role: 'transform',
        zone: 'operations',
        kind: 'runtime',
        label: 'Deploy Checks',
        description:
            'Migration, health, smoke, API, and browser checks tied to the deployed manifest.',
        upstreams: ['runtimeVersion'],
        downstreams: ['rollbackMetadata'],
        participatesIn: ['deploy_update'],
        route: '/monitoring/runtime',
        owner: 'devops',
        criticality: 'critical',
        order: 30,
        dataClasses: ['deployment_result']
    }
});

registerModule('rollbackMetadata', {
    stats: () => ({status: 'healthy'}),
    topology: {
        role: 'sink',
        zone: 'operations',
        kind: 'runtime',
        label: 'Rollback Metadata',
        description:
            'Rollback target and readiness information for the currently deployed revision.',
        upstreams: ['deployChecks'],
        participatesIn: ['deploy_update'],
        route: '/monitoring/runtime',
        owner: 'devops',
        criticality: 'high',
        order: 40,
        dataClasses: ['deployment_contract']
    }
});

registerModule('prometheus', {
    stats: () => ({status: 'unknown'}),
    topology: {
        role: 'external',
        zone: 'external_systems',
        kind: 'external',
        label: 'Prometheus Scraper',
        description:
            'External metrics scraper for /metrics and topology-derived monitoring data.',
        upstreams: ['observability'],
        downstreams: ['grafana'],
        participatesIn: ['metrics_scrape'],
        owner: 'devops',
        criticality: 'high',
        order: 40,
        externalSystem: 'prometheus',
        dataClasses: ['metrics']
    }
});

registerModule('grafana', {
    stats: () => ({status: 'unknown'}),
    topology: {
        role: 'external',
        zone: 'integrations',
        kind: 'external',
        label: 'Grafana',
        description:
            'Operational dashboards and alerting fed by Fleet Manager metrics.',
        upstreams: ['prometheus'],
        participatesIn: ['metrics_scrape'],
        route: '/graphs',
        owner: 'devops',
        criticality: 'medium',
        order: 50,
        externalSystem: 'grafana',
        dataClasses: ['metrics']
    }
});

registerModule('notificationDelivery', {
    stats: () => ({status: 'unknown'}),
    topology: {
        role: 'transform',
        zone: 'integrations',
        kind: 'module',
        label: 'Notification Delivery',
        description:
            'Notification routing, provider adapter delivery, result logging, and audit handoff.',
        upstreams: ['events'],
        downstreams: ['audit'],
        participatesIn: ['alert_triggered', 'notification_sent', 'audit_write'],
        route: '/monitoring/events',
        owner: 'backend',
        criticality: 'high',
        order: 60,
        dataClasses: ['notification_result']
    }
});

let httpStatsGetter: HttpStatsGetter | undefined;

export function registerHttpStats(getter: HttpStatsGetter): void {
    httpStatsGetter = getter;
}

function emptyHttpStats(): HttpStats {
    return {
        requestCounts: new Map(),
        statusCounts: new Map(),
        activeRequests: 0
    };
}

export function readHttpStats(): HttpStats {
    return httpStatsGetter?.() ?? emptyHttpStats();
}

// 300 samples × ~21 modules × ~200 bytes ≈ 1.3MB cap.
export interface ModuleHistorySample {
    ts: number;
    stats: Record<string, unknown>;
}

const moduleHistory = new Map<string, ModuleHistorySample[]>();

function recordModuleHistory(name: string, sample: ModuleHistorySample): void {
    let series = moduleHistory.get(name);
    if (!series) {
        series = [];
        moduleHistory.set(name, series);
    }
    series.push(sample);
    while (series.length > tuning.observability.moduleHistorySize)
        series.shift();
}

export function getModuleHistory(
    name: string,
    windowSec: number
): ModuleHistorySample[] {
    const series = moduleHistory.get(name);
    if (!series) return [];
    const cutoff = Date.now() - windowSec * 1000;
    return series.filter((s) => s.ts >= cutoff);
}

const topologyDiffRing: TopologySnapshot[] = [];

export function recordTopologyDiffSnapshot(snap: TopologySnapshot): void {
    pushRing(topologyDiffRing, snap, tuning.observability.topologyDiffRingSize);
}

export interface ChangedEdge {
    id: string;
    previousThroughput: number;
    currentThroughput: number;
    pctChange: number;
}

export interface ChangedNode {
    id: string;
    statusBefore: ModuleStatus;
    statusAfter: ModuleStatus;
}

export interface NodeMembershipChange {
    id: string;
    change: 'appeared' | 'disappeared';
    status: ModuleStatus;
}

export interface EdgeMembershipChange {
    id: string;
    change: 'appeared' | 'disappeared';
    from: string;
    to: string;
}

export interface TopologyDiffResponse {
    schemaVersion: 2;
    windowMin: number;
    changedEdges: ChangedEdge[];
    changedNodes: ChangedNode[];
    nodeMembershipChanges: NodeMembershipChange[];
    edgeMembershipChanges: EdgeMembershipChange[];
}

export function getTopologyDiff(windowMin: number): TopologyDiffResponse {
    const current = topologyDiffRing[topologyDiffRing.length - 1];
    if (!current) return emptyDiff(windowMin);
    const baseline = pickBaselineSnapshot(windowMin);
    if (!baseline) return emptyDiff(windowMin);
    return {
        schemaVersion: 2,
        windowMin,
        changedEdges: collectChangedEdges(baseline, current),
        changedNodes: collectChangedNodes(baseline, current),
        nodeMembershipChanges: collectNodeMembershipChanges(baseline, current),
        edgeMembershipChanges: collectEdgeMembershipChanges(baseline, current)
    };
}

function emptyDiff(windowMin: number): TopologyDiffResponse {
    return {
        schemaVersion: 2,
        windowMin,
        changedEdges: [],
        changedNodes: [],
        nodeMembershipChanges: [],
        edgeMembershipChanges: []
    };
}

function pickBaselineSnapshot(windowMin: number): TopologySnapshot | null {
    const cutoff = Date.now() - windowMin * 60_000;
    for (const snap of topologyDiffRing) {
        if (snap.generatedAt <= cutoff) return snap;
    }
    return topologyDiffRing[0] ?? null;
}

function collectChangedEdges(
    baseline: TopologySnapshot,
    current: TopologySnapshot
): ChangedEdge[] {
    const baseById = new Map(baseline.edges.map((e) => [e.id, e]));
    const out: ChangedEdge[] = [];
    for (const edge of current.edges) {
        const prior = baseById.get(edge.id);
        if (!prior) continue;
        const change = pctChange(prior.throughput, edge.throughput);
        if (Math.abs(change) < tuning.observability.topologyDiffPctThreshold)
            continue;
        out.push({
            id: edge.id,
            previousThroughput: prior.throughput,
            currentThroughput: edge.throughput,
            pctChange: change
        });
    }
    return out;
}

function pctChange(before: number, after: number): number {
    if (before === 0 && after === 0) return 0;
    if (before === 0) return 100;
    return Math.round(((after - before) / before) * 100);
}

function collectChangedNodes(
    baseline: TopologySnapshot,
    current: TopologySnapshot
): ChangedNode[] {
    const baseById = new Map(baseline.nodes.map((n) => [n.id, n]));
    const out: ChangedNode[] = [];
    for (const node of current.nodes) {
        const prior = baseById.get(node.id);
        if (!prior || prior.status === node.status) continue;
        out.push({
            id: node.id,
            statusBefore: prior.status,
            statusAfter: node.status
        });
    }
    return out;
}

function collectNodeMembershipChanges(
    baseline: TopologySnapshot,
    current: TopologySnapshot
): NodeMembershipChange[] {
    const baseById = new Map(baseline.nodes.map((node) => [node.id, node]));
    const currentById = new Map(current.nodes.map((node) => [node.id, node]));
    const out: NodeMembershipChange[] = [];
    for (const node of current.nodes) {
        if (!baseById.has(node.id)) {
            out.push({id: node.id, change: 'appeared', status: node.status});
        }
    }
    for (const node of baseline.nodes) {
        if (!currentById.has(node.id)) {
            out.push({
                id: node.id,
                change: 'disappeared',
                status: node.status
            });
        }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
}

function collectEdgeMembershipChanges(
    baseline: TopologySnapshot,
    current: TopologySnapshot
): EdgeMembershipChange[] {
    const baseById = new Map(baseline.edges.map((edge) => [edge.id, edge]));
    const currentById = new Map(current.edges.map((edge) => [edge.id, edge]));
    const out: EdgeMembershipChange[] = [];
    for (const edge of current.edges) {
        if (!baseById.has(edge.id)) {
            out.push({
                id: edge.id,
                change: 'appeared',
                from: edge.from,
                to: edge.to
            });
        }
    }
    for (const edge of baseline.edges) {
        if (!currentById.has(edge.id)) {
            out.push({
                id: edge.id,
                change: 'disappeared',
                from: edge.from,
                to: edge.to
            });
        }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
}

// Clears rolling rings but keeps the registered module graph intact.
export function resetTopologyRings(): void {
    counterSamples.clear();
    moduleHistory.clear();
    topologyDiffRing.length = 0;
}

export function resetTopology(): void {
    resetTopologyRings();
    modules.clear();
    edgeCounters.length = 0;
    lastGetterWarnTs.clear();
    cachedTopology = null;
    cachedTopologyTs = 0;
}
