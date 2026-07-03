import type {
    ModuleClusterId,
    ModuleRole,
    TopologyCriticality,
    TopologyFlowId,
    TopologyNodeKind,
    TopologyZoneId
} from '../../types/api/topology';

export type {
    ModuleClusterId,
    ModuleRole,
    ModuleStatus,
    ThresholdPair,
    TopologyCluster,
    TopologyCriticality,
    TopologyEdge,
    TopologyEdgeKind,
    TopologyFlow,
    TopologyFlowId,
    TopologyNode,
    TopologyNodeKind,
    TopologySnapshot,
    TopologyZone,
    TopologyZoneId
} from '../../types/api/topology';

export type ObsLevel = 0 | 1 | 2 | 3;

export interface RpcMethodStats {
    count: number;
    totalMs: number;
    maxMs: number;
    minMs: number;
}

export interface RpcErrorEntry {
    method: string;
    error: string;
    ts: number;
}

export interface InitFailureEntry {
    shellyID: string;
    error: string;
    ts: number;
}

export type ModuleStatsGetter = () => Record<string, number | boolean | string>;

export interface ModuleTopology {
    role: ModuleRole;
    upstreams?: readonly string[];
    downstreams?: readonly string[];
    cluster?: ModuleClusterId;
    zone?: TopologyZoneId;
    kind?: TopologyNodeKind;
    label?: string;
    description?: string;
    route?: string;
    order?: number;
    noisy?: boolean;
    owner?: string;
    criticality?: TopologyCriticality;
    participatesIn?: readonly TopologyFlowId[];
    dataClasses?: readonly string[];
    externalSystem?: string;
    collapseByDefault?: boolean;
}

export interface ModuleRegistration {
    stats: ModuleStatsGetter;
    topology?: ModuleTopology;
}

export interface EdgeCounter {
    from: string;
    to: string;
    counter: string;
}

export interface HttpStats {
    requestCounts: ReadonlyMap<string, number>;
    statusCounts: ReadonlyMap<number, number>;
    activeRequests: number;
}

export type HttpStatsGetter = () => HttpStats;
