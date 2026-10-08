import {createHash} from 'node:crypto';
import {arch, availableParallelism, platform} from 'node:os';
import {readAppVersion} from './appVersion';
import {readContainerResources} from './containerResources';
import {envInt, envStr} from './envReader';
import {runtimeMetadata} from './runtimeMetadata';
import {tuning} from './tuning';

const effectiveConfig = Object.freeze({
    em_rollup_workers: tuning.energy.rollupWorkers,
    em_rollup_batch_size: tuning.energy.rollupBatchSize,
    em_sync_max_concurrent_devices: tuning.rpc.maxConcurrentEmSyncs,
    em_sync_max_concurrent_channels: tuning.rpc.maxConcurrentEmSyncChannels,
    em_sync_catchup_share_percent: tuning.energy.emSyncCatchupSharePct,
    em_sync_stream_maxlen: tuning.energy.emSyncStreamMaxlen,
    em_sync_catchup_high_water_percent: tuning.energy.emSyncCatchupHighWaterPct,
    stream_warning_ratio: tuning.observability.healthOverflowRatio,
    report_worker_concurrency: tuning.delivery.outboxConcurrency,
    alert_sweep_concurrency: tuning.alert.sweepConcurrency,
    alert_sweep_batch_size: tuning.alert.sweepBatchSize,
    rpc_rate_limit_general_per_minute: tuning.http.rateLimitGeneralRpm,
    rpc_rate_limit_expensive_per_minute: tuning.http.rateLimitExpensiveRpm,
    rpc_rate_limit_billing_per_minute: tuning.http.rateLimitBillingRpm,
    rpc_rate_limit_org_general_per_minute: tuning.http.rateLimitOrgGeneralRpm,
    rpc_rate_limit_org_expensive_per_minute:
        tuning.http.rateLimitOrgExpensiveRpm,
    rpc_rate_limit_org_billing_per_minute: tuning.http.rateLimitOrgBillingRpm,
    auth_introspection_cache_ttl_ms: tuning.zitadel.introspectedUserTtlMs,
    auth_introspection_timeout_ms: tuning.zitadel.introspectionTimeoutMs,
    auth_scoped_pat_cache_ttl_ms: tuning.zitadel.scopedPatCacheTtlMs,
    zitadel_db_max_open_connections: envInt('ZITADEL_DB_MAX_OPEN_CONNS', 30, 1),
    zitadel_db_max_idle_connections: envInt('ZITADEL_DB_MAX_IDLE_CONNS', 10, 0),
    zitadel_hash_algorithm: envStr('ZITADEL_PASSWORD_HASH_ALGORITHM', 'bcrypt'),
    zitadel_hash_cost: envInt('ZITADEL_PASSWORD_HASH_COST', 12, 10),
    zitadel_action_worker_concurrency: envInt(
        'FM_ZITADEL_ACTION_CONCURRENCY',
        2,
        1
    ),
    zitadel_action_batch_size: envInt('FM_ZITADEL_ACTION_BATCH_SIZE', 16, 1),
    zitadel_action_poll_interval_ms: envInt(
        'FM_ZITADEL_ACTION_POLL_INTERVAL_MS',
        250,
        50
    ),
    zitadel_action_idle_poll_max_ms: envInt(
        'FM_ZITADEL_ACTION_IDLE_POLL_MAX_MS',
        2_000,
        50
    ),
    stream_maxlen: {
        em_sync: tuning.energy.emSyncStreamMaxlen,
        status_telemetry: tuning.status.streamMaxlen,
        device_snapshot: tuning.deviceSnapshot.streamMaxlen,
        device_event: tuning.deviceEvents.streamMaxlen,
        device_ingest: tuning.ingest.maxlen,
        audit_overflow: tuning.audit.overflowMaxlen,
        websocket_replay_per_session: tuning.ws.streamMaxlen
    },
    safe_mode: runtimeMetadata.safeMode
});

const containerResources = readContainerResources();

const configurationFingerprint = createHash('sha256')
    .update(
        JSON.stringify({
            api_contract_version: runtimeMetadata.apiContractVersion,
            ui_contract_version: runtimeMetadata.uiContractVersion,
            frontend_artifact_id: runtimeMetadata.frontendArtifactId,
            frontend_artifact_version: runtimeMetadata.frontendArtifactVersion,
            deployment_mode: runtimeMetadata.deploymentMode,
            topology_mode: runtimeMetadata.topologyMode,
            client_id: runtimeMetadata.clientId,
            environment_id: runtimeMetadata.environmentId,
            compose_project: runtimeMetadata.composeProject,
            managed_by: runtimeMetadata.managedBy,
            container_cpu_limit_cores: containerResources.cpuLimitCores,
            container_memory_limit_bytes: containerResources.memoryLimitBytes,
            ...effectiveConfig
        })
    )
    .digest('hex');

export const runtimeIdentity = Object.freeze({
    appVersion: readAppVersion(),
    buildCommit: runtimeMetadata.buildCommit || 'unknown',
    apiContractVersion: runtimeMetadata.apiContractVersion,
    uiContractVersion: runtimeMetadata.uiContractVersion,
    frontendArtifactId: runtimeMetadata.frontendArtifactId,
    frontendArtifactVersion: runtimeMetadata.frontendArtifactVersion,
    deploymentMode: runtimeMetadata.deploymentMode,
    topologyMode: runtimeMetadata.topologyMode,
    clientId: runtimeMetadata.clientId,
    environmentId: runtimeMetadata.environmentId,
    composeProject: runtimeMetadata.composeProject,
    managedBy: runtimeMetadata.managedBy,
    nodeVersion: process.version,
    platform: platform(),
    architecture: arch(),
    availableParallelism: availableParallelism(),
    containerCpuLimitCores: containerResources.cpuLimitCores,
    containerMemoryLimitBytes: containerResources.memoryLimitBytes,
    effectiveConfig,
    configurationFingerprint
});

export function runtimeIdentityComplete(): boolean {
    return [
        runtimeIdentity.appVersion,
        runtimeIdentity.buildCommit,
        runtimeIdentity.apiContractVersion,
        runtimeIdentity.uiContractVersion,
        runtimeIdentity.frontendArtifactId,
        runtimeIdentity.frontendArtifactVersion,
        runtimeIdentity.deploymentMode,
        runtimeIdentity.topologyMode,
        runtimeIdentity.clientId,
        runtimeIdentity.environmentId,
        runtimeIdentity.composeProject,
        runtimeIdentity.managedBy
    ].every((value) => value.length > 0 && value !== 'unknown');
}
