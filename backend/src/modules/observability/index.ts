import * as log4js from 'log4js';
import {
    getSlowBuildStats,
    getSlowBuilds,
    querySlowBuilds,
    recordBuildTiming,
    resetSlowBuilds
} from './buildTimings';
import {
    getSlowDeviceCommands,
    querySlowDeviceCommands,
    recordDeviceCommand,
    resetSlowDeviceCommands
} from './deviceCommandTimings';
import {resetEventLog} from './eventLog';
import {getMetrics} from './exporters/json';
import {
    getLevel,
    resetInitDurations,
    setLevel,
    setSnapshotProducer,
    shutdownSamplers
} from './samplers';
import {
    counters,
    dbTimings,
    gauges,
    labeledCounters,
    labeledGauges,
    rpcTimings
} from './state';
import {resetSlowRpc} from './timings';
import {resetTopology, resetTopologyRings} from './topology';
import {
    getStrugglingClients,
    getWsClientHealthStats,
    queryStrugglingClients,
    recordBackpressure,
    resetWsClientHealth
} from './wsClientHealth';

export type {
    BuildTiming,
    SlowBuildEntry,
    SlowBuildStats
} from './buildTimings';
export {
    getCounter,
    getGauge,
    getLabeledCounter,
    incrementCounter,
    incrementLabeledCounter,
    setGauge,
    setLabeledGauge
} from './counters';
export type {DbRuntimeSnapshot, DbRuntimeStatus} from './dbRuntime';
export {
    buildDbRuntimeErrorSnapshot,
    buildDbRuntimeSnapshot,
    compareTimescaleRuntime,
    dbRuntimeStatusCode,
    getDbRuntimeSnapshot,
    postgresMajorFromVersion,
    readExpectedTimescaleImage,
    resetDbRuntimeSnapshotForTests,
    setDbRuntimeSnapshot,
    timescaleVersionFromImage
} from './dbRuntime';
export type {
    DeviceCommandOutcome,
    DeviceCommandTiming,
    SlowDeviceCommand
} from './deviceCommandTimings';
export {
    getInitFailures,
    getRpcErrors,
    recordInitFailure,
    recordRpcError,
    recordWsMessage
} from './eventLog';
export {getDebugReport, getMetrics} from './exporters/json';
export {getPrometheusMetrics} from './exporters/prometheus';
export {
    getLevel,
    getMetricHistory,
    isDbWritesDisabled,
    recordInitDuration,
    setDbWritesDisabled,
    setLevel,
    setWsClientCount
} from './samplers';
export type {RpcCompletion, SlowRpcEntry, SlowRpcQuery} from './timings';
export {
    getRpcMethodP95,
    getSlowRpcs,
    noteRpcCompletion,
    recordDbTiming,
    recordRpcTiming
} from './timings';
export type {
    ChangedEdge,
    ChangedNode,
    ModuleHistorySample,
    TopologyDiffResponse
} from './topology';
export {
    getCachedTopologySnapshot,
    getModuleHistory,
    getTopologyDiff,
    recordTopologyDiffSnapshot,
    registerEdgeCounter,
    registerHttpStats,
    registerModule,
    snapshotTopology
} from './topology';
export type {
    EdgeCounter,
    HttpStats,
    HttpStatsGetter,
    InitFailureEntry,
    ModuleClusterId,
    ModuleRegistration,
    ModuleRole,
    ModuleStatsGetter,
    ModuleStatus,
    ModuleTopology,
    ObsLevel,
    RpcErrorEntry,
    RpcMethodStats,
    ThresholdPair,
    TopologyCluster,
    TopologyEdge,
    TopologyNode,
    TopologySnapshot
} from './types';
export type {TimestampedSample} from './util/timeWindowSeries';
export type {
    StrugglingClient,
    WsClientHealthStats
} from './wsClientHealth';
export {
    getSlowBuildStats,
    getSlowBuilds,
    getSlowDeviceCommands,
    getStrugglingClients,
    getWsClientHealthStats,
    querySlowBuilds,
    querySlowDeviceCommands,
    queryStrugglingClients,
    recordBackpressure,
    recordBuildTiming,
    recordDeviceCommand,
    resetSlowBuilds,
    resetSlowDeviceCommands,
    resetWsClientHealth
};

const logger = log4js.getLogger('Observability');

setSnapshotProducer(getMetrics);

export function isEnabled(): boolean {
    return getLevel() > 0;
}

export function enable(): void {
    if (getLevel() >= 2) return;
    setLevel(2);
    logger.info('Observability enabled');
}

export function disable(): void {
    if (getLevel() === 0) return;
    setLevel(0);
    resetTimings();
    logger.info('Observability disabled');
}

export function resetTimings(): void {
    rpcTimings.clear();
    dbTimings.clear();
    counters.clear();
    labeledCounters.clear();
    gauges.clear();
    labeledGauges.clear();
    resetEventLog();
    resetInitDurations();
    resetSlowBuilds();
    resetSlowDeviceCommands();
    resetWsClientHealth();
    // Reset samples too, else rolling-window rate goes negative until flush.
    resetTopologyRings();
    resetSlowRpc();
}

export function shutdown(): void {
    shutdownSamplers();
    resetTopology();
    resetSlowRpc();
    resetEventLog();
}
