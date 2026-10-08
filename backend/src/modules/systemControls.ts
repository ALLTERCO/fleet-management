import log4js from 'log4js';
import {readAppVersion} from '../config/appVersion';
import {
    runtimeIdentity,
    runtimeIdentityComplete
} from '../config/runtimeIdentity';
import {runtimeMetadata} from '../config/runtimeMetadata';
import {tuning} from '../config/tuning';
import {getAuthzRuntimeStatus} from './authz';
import {getCounts as getDeviceLoadCounts} from './device/deviceLoadLedger';
import type {ObsLevel} from './Observability';
import * as Observability from './Observability';
import {pingRedis} from './redis/health';
import {redisFeaturesWaiting} from './redis/redisWaiting';

const startedAt = new Date();

type DependencyStatus =
    | 'passed'
    | 'failed'
    | 'degraded'
    | 'skipped'
    | 'unknown';

interface ReadyCheck {
    status: DependencyStatus;
    required: boolean;
}

interface ReadyHealthDeps {
    checkDatabase?: () => Promise<DependencyStatus>;
    checkRedis?: () => Promise<DependencyStatus>;
    redisFeaturesWaiting?: () => readonly string[];
}

export const KNOWN_LOG_CATEGORIES = [
    'default',
    'web',
    'shelly-ws',
    'postgres',
    'message-parser',
    'DeviceCollector',
    'Commander',
    'audit',
    'Observability',
    'FirmwareScheduler',
    'local-scanner',
    'registry',
    'Plugin Loader',
    'device-proxy',
    'message-handler',
    'config',
    'AbstractDevice',
    'device',
    'GroupComponent',
    'BackupComponent',
    'FirmwareComponent',
    'user',
    'WaitingRoom',
    'client-ws',
    'local-ws',
    'ws-server',
    'ws-upgrade',
    'api',
    'grafana-proxy',
    'ShellyComponents',
    'shelly-events',
    'event-model',
    'frontend-builder',
    'plugin-loader'
] as const;

export const VALID_LOG_LEVELS = [
    'OFF',
    'FATAL',
    'ERROR',
    'WARN',
    'INFO',
    'DEBUG',
    'TRACE',
    'ALL',
    'MARK'
] as const;

export {readAppVersion};

export function getLiveHealth() {
    return {
        schema_version: 1,
        status: 'live',
        live: true,
        online: true,
        service: 'fleet-manager',
        version: readAppVersion(),
        commit: runtimeIdentity.buildCommit,
        identity_complete: runtimeIdentityComplete(),
        configuration_fingerprint: runtimeIdentity.configurationFingerprint,
        uptime_s: Math.max(0, Math.floor(process.uptime())),
        checked_at: new Date().toISOString()
    };
}

export function getVersionInfo() {
    return {
        schema_version: 1,
        service: 'fleet-manager',
        app_version: runtimeIdentity.appVersion,
        build_commit: runtimeIdentity.buildCommit,
        api_contract_version: runtimeIdentity.apiContractVersion,
        ui_contract_version: runtimeIdentity.uiContractVersion,
        frontend_artifact_id: runtimeIdentity.frontendArtifactId,
        frontend_artifact_version: runtimeIdentity.frontendArtifactVersion,
        deployment_mode: runtimeIdentity.deploymentMode,
        topology_mode: runtimeIdentity.topologyMode,
        client_id: runtimeIdentity.clientId,
        environment_id: runtimeIdentity.environmentId,
        compose_project: runtimeIdentity.composeProject,
        managed_by: runtimeIdentity.managedBy,
        node_version: runtimeIdentity.nodeVersion,
        platform: runtimeIdentity.platform,
        architecture: runtimeIdentity.architecture,
        available_parallelism: runtimeIdentity.availableParallelism,
        container_cpu_limit_cores: runtimeIdentity.containerCpuLimitCores,
        container_memory_limit_bytes: runtimeIdentity.containerMemoryLimitBytes,
        effective_config: runtimeIdentity.effectiveConfig,
        configuration_fingerprint: runtimeIdentity.configurationFingerprint,
        identity_complete: runtimeIdentityComplete(),
        started_at: startedAt.toISOString()
    };
}

async function checkDatabaseReady(): Promise<DependencyStatus> {
    try {
        const postgres = await import('./PostgresProvider.js');
        await postgres.queryRows('SELECT 1');
        return 'passed';
    } catch {
        return 'failed';
    }
}

async function checkRedisReady(): Promise<DependencyStatus> {
    if (tuning.redis.disabled) return 'skipped';
    try {
        return (await pingRedis()) === 'up' ? 'passed' : 'unknown';
    } catch {
        return 'degraded';
    }
}

// Redis answering pings while a feature still waits for a command Redis
// refuses (for example at maxmemory) serves, but not fully.
function withWaitingFeatures(
    redis: DependencyStatus,
    waitingFeatures: readonly string[]
): DependencyStatus {
    return redis === 'passed' && waitingFeatures.length > 0
        ? 'degraded'
        : redis;
}

export async function getReadyHealth(deps: ReadyHealthDeps = {}) {
    const checks: Record<string, ReadyCheck> = {
        database: {
            status: await (deps.checkDatabase ?? checkDatabaseReady)(),
            required: true
        },
        redis: {
            status: withWaitingFeatures(
                await (deps.checkRedis ?? checkRedisReady)(),
                (deps.redisFeaturesWaiting ?? redisFeaturesWaiting)()
            ),
            required: false
        }
    };

    const ready = Object.values(checks).every(
        (check) => !check.required || check.status === 'passed'
    );

    return {
        schema_version: 1,
        status: ready ? 'ready' : 'not_ready',
        ready,
        service: 'fleet-manager',
        checks,
        checked_at: new Date().toISOString()
    };
}

export async function getFullHealth() {
    const metrics = Observability.getMetrics();
    const base: Record<string, unknown> = {
        online: true,
        version: readAppVersion(),
        obsLevel: Observability.getLevel(),
        authz: await getAuthzRuntimeStatus()
    };
    if (runtimeMetadata.buildCommit) base.commit = runtimeMetadata.buildCommit;
    // Serving with devices the store knows about but memory does not is
    // degraded, not down: the probe stays 200 and ops still see the gap.
    if (getDeviceLoadCounts().gap > 0) base.degraded = true;
    const redisWaiting = redisFeaturesWaiting();
    if (redisWaiting.length > 0) {
        base.degraded = true;
        base.redisWaiting = redisWaiting;
    }
    if (metrics) base.metrics = metrics;
    return base;
}

export function getDbWrites() {
    return {dbWritesDisabled: Observability.isDbWritesDisabled()};
}

export function setDbWrites(disabled: unknown) {
    if (typeof disabled !== 'boolean') {
        throw new Error('Provide disabled (boolean)');
    }
    Observability.setDbWritesDisabled(disabled);
    return getDbWrites();
}

export function getDebugReport() {
    return Observability.getDebugReport();
}

export async function getStreamsHealth() {
    const report: Record<string, unknown> = {
        redisDisabled: tuning.redis.disabled,
        ingestCapture: tuning.ingest.capture,
        ingestDrainAtBoot: tuning.ingest.drainAtBoot
    };
    if (!tuning.redis.disabled) {
        try {
            report.redis = await pingRedis();
        } catch (err) {
            report.redis = 'down';
            report.redisError = String(err);
        }
        try {
            const {getOverflowStream} = await import(
                './audit/AuditOverflowStream.js'
            );
            const stream = getOverflowStream();
            report.auditOverflow = {
                size: await stream.length(),
                oldestAgeMs: await stream.oldestAgeMs()
            };
        } catch {
            /* optional Redis stream */
        }
        try {
            const {getOverflowStream} = await import(
                './status/StatusOverflowStream.js'
            );
            const stream = getOverflowStream();
            report.statusOverflow = {
                size: await stream.length(),
                oldestAgeMs: await stream.oldestAgeMs()
            };
        } catch {
            /* optional Redis stream */
        }
    }
    return report;
}

export function setObservability(input: {level?: unknown; enabled?: unknown}) {
    if (input.level !== undefined) {
        if (![0, 1, 2, 3].includes(input.level as number)) {
            throw new Error('level must be 0, 1, 2, or 3');
        }
        Observability.setLevel(input.level as ObsLevel);
    } else if (typeof input.enabled === 'boolean') {
        Observability.setLevel(input.enabled ? 2 : 0);
    } else {
        throw new Error('Provide level (0-3) or enabled (boolean)');
    }
    return {
        observability: Observability.isEnabled(),
        level: Observability.getLevel()
    };
}

export function resetObservability() {
    Observability.resetTimings();
    return {reset: true};
}

export function getLogLevels() {
    const levels: Record<string, string> = {};
    for (const cat of KNOWN_LOG_CATEGORIES) {
        const catLogger = log4js.getLogger(cat);
        levels[cat] = catLogger.level.toString();
    }
    return {levels};
}

export function setLogLevel(input: {category?: unknown; level?: unknown}) {
    const {category, level} = input;
    if (!category || !level) {
        throw new Error('Provide category and level');
    }
    if (!VALID_LOG_LEVELS.includes(String(level).toUpperCase() as any)) {
        throw new Error(`Invalid level. Valid: ${VALID_LOG_LEVELS.join(', ')}`);
    }
    const catLogger = log4js.getLogger(String(category));
    catLogger.level = String(level);
    return {category: String(category), level: catLogger.level.toString()};
}
