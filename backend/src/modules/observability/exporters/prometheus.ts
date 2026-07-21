// Line order is a Grafana scrape contract — the fixture in
// test/fixtures/observabilityPrometheusHeaders.json pins it.

import * as log4js from 'log4js';
import {tuning} from '../../../config/tuning';
import {readContractFreshnessMetrics} from '../../controlPlaneContract';
import {
    DEVICE_USAGE_WINDOW_DAYS,
    type readClientDeviceUsageRows,
    readClientDeviceUsageSnapshot
} from '../clientDeviceUsage';
import {COUNTER_DEFS} from '../counters';
import {getInitFailures, getRpcErrors, getWsMessageTypes} from '../eventLog';
import {registry as promRegistry} from '../registry';
import {
    getCpuSystemPct,
    getCpuUserPct,
    getDiskUsage,
    getEventLoopHistogram,
    getGcStats,
    getInitDurationStats,
    getLagMs,
    getLevel
} from '../samplers';
import {
    counters,
    gauges,
    labeledCounters,
    labeledGauges,
    modules
} from '../state';
import {readHttpStats} from '../topology';

const logger = log4js.getLogger('Observability');

function promLine(
    name: string,
    help: string,
    type: string,
    value: number
): string {
    return `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n${name} ${value}\n`;
}

// Escape \, ", and newline so a hostile label value can't inject lines.
function escapePromLabelValue(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n');
}

function promLabeled(
    name: string,
    labels: Record<string, string>,
    value: number
): string {
    const lblStr = Object.entries(labels)
        .map(([k, v]) => `${k}="${escapePromLabelValue(v)}"`)
        .join(',');
    return `${name}{${lblStr}} ${value}\n`;
}

function clientDeviceUsageLabels(
    row: Awaited<ReturnType<typeof readClientDeviceUsageRows>>[number]
): Record<string, string> {
    return {
        client: row.clientId,
        environment: tuning.controlPlaneContract.environmentId,
        window: `${DEVICE_USAGE_WINDOW_DAYS}d`,
        limit_status: row.limitStatus
    };
}

function emitEventLoopCpuGcSection(lines: string[]): void {
    if (getLevel() < 1) return;
    const elHistogram = getEventLoopHistogram();
    const gc = getGcStats();
    lines.push(
        promLine(
            'fm_event_loop_lag_ms',
            'Event loop lag in milliseconds',
            'gauge',
            Math.round(getLagMs())
        )
    );
    lines.push(
        promLine(
            'fm_cpu_user_percent',
            'CPU user usage percent',
            'gauge',
            getCpuUserPct()
        )
    );
    lines.push(
        promLine(
            'fm_cpu_system_percent',
            'CPU system usage percent',
            'gauge',
            getCpuSystemPct()
        )
    );

    if (elHistogram) {
        lines.push(
            '# HELP fm_event_loop_delay_ms Event loop delay histogram percentiles\n'
        );
        lines.push('# TYPE fm_event_loop_delay_ms gauge\n');
        lines.push(
            promLabeled(
                'fm_event_loop_delay_ms',
                {quantile: '0.5'},
                Math.round(elHistogram.percentile(50) / 1e6)
            )
        );
        lines.push(
            promLabeled(
                'fm_event_loop_delay_ms',
                {quantile: '0.95'},
                Math.round(elHistogram.percentile(95) / 1e6)
            )
        );
        lines.push(
            promLabeled(
                'fm_event_loop_delay_ms',
                {quantile: '0.99'},
                Math.round(elHistogram.percentile(99) / 1e6)
            )
        );
        lines.push(
            promLabeled(
                'fm_event_loop_delay_ms',
                {quantile: '1.0'},
                Math.round(elHistogram.max / 1e6)
            )
        );
    }

    lines.push(
        promLine(
            'fm_gc_pause_total_ms',
            'Total GC pause time in ms',
            'counter',
            Math.round(gc.totalPauseMs)
        )
    );
    lines.push(
        promLine(
            'fm_gc_pause_count',
            'Total GC pause count',
            'counter',
            gc.pauseCount
        )
    );
    lines.push(
        promLine(
            'fm_gc_pause_max_ms',
            'Max GC pause in ms',
            'gauge',
            Math.round(gc.maxPauseMs)
        )
    );
}

// A failed device-usage read must degrade this one section (mark it
// unavailable), not 500 the whole scrape.
async function readClientDeviceUsageOrUnavailable(): Promise<
    Awaited<ReturnType<typeof readClientDeviceUsageSnapshot>>
> {
    try {
        return await readClientDeviceUsageSnapshot();
    } catch (err) {
        logger.warn(
            'client device usage read failed; degrading section: %s',
            err instanceof Error ? err.message : String(err)
        );
        return {
            queryAvailable: false,
            staleAgeSeconds: -1,
            rows: [],
            source: 'unavailable'
        };
    }
}

async function emitClientDeviceUsageSection(lines: string[]): Promise<void> {
    const usage = await readClientDeviceUsageOrUnavailable();
    const usageRows = usage.rows;
    lines.push(
        promLine(
            'fm_client_device_usage_query_available',
            'Whether Fleet Manager could read aggregate client device usage from the database',
            'gauge',
            usage.queryAvailable ? 1 : 0
        )
    );
    lines.push(
        promLine(
            'fm_client_device_usage_stale_age_seconds',
            'Age of the cached aggregate client device usage snapshot in seconds; -1 means unavailable',
            'gauge',
            usage.staleAgeSeconds
        )
    );
    if (!usageRows.length) return;

    lines.push(
        '# HELP fm_client_unique_active_devices Unique active physical production devices by client over the last 30 days. Labels never include raw device IDs.\n'
    );
    lines.push('# TYPE fm_client_unique_active_devices gauge\n');
    for (const row of usageRows) {
        lines.push(
            promLabeled(
                'fm_client_unique_active_devices',
                clientDeviceUsageLabels(row),
                row.uniqueDevices
            )
        );
    }

    lines.push(
        '# HELP fm_client_device_limit_warning Whether active device usage is at or above the warning threshold.\n'
    );
    lines.push('# TYPE fm_client_device_limit_warning gauge\n');
    for (const row of usageRows) {
        lines.push(
            promLabeled(
                'fm_client_device_limit_warning',
                clientDeviceUsageLabels(row),
                row.limitStatus === 'warning' ||
                    row.limitStatus === 'over_limit'
                    ? 1
                    : 0
            )
        );
    }

    lines.push(
        '# HELP fm_client_device_limit_over Whether active device usage is above the paid limit.\n'
    );
    lines.push('# TYPE fm_client_device_limit_over gauge\n');
    for (const row of usageRows) {
        lines.push(
            promLabeled(
                'fm_client_device_limit_over',
                clientDeviceUsageLabels(row),
                row.limitStatus === 'over_limit' ? 1 : 0
            )
        );
    }

    lines.push(
        '# HELP fm_client_paid_device_limit Configured paid device limit by client; 0 means no limit is configured in Fleet Manager metadata.\n'
    );
    lines.push('# TYPE fm_client_paid_device_limit gauge\n');
    for (const row of usageRows) {
        lines.push(
            promLabeled(
                'fm_client_paid_device_limit',
                clientDeviceUsageLabels(row),
                row.paidLimit ?? 0
            )
        );
    }
}

function emitControlPlaneContractSection(lines: string[]): void {
    const metrics = readContractFreshnessMetrics();
    lines.push(
        promLine(
            'fm_deploy_manifest_available',
            'Whether a deploy manifest is available and parseable',
            'gauge',
            metrics.manifestAvailable
        )
    );
    lines.push(
        promLine(
            'fm_deploy_manifest_age_seconds',
            'Age of the deploy manifest in seconds; -1 means unavailable',
            'gauge',
            metrics.manifestAgeSeconds
        )
    );
    lines.push(
        promLine(
            'fm_deploy_manifest_schema_version',
            'Deploy manifest schema or legacy manifest version; 0 means unavailable',
            'gauge',
            metrics.manifestSchemaVersion
        )
    );
    lines.push(
        promLine(
            'fm_deploy_last_timestamp_seconds',
            'Unix timestamp for the last deploy/manifest generation time; -1 means unavailable',
            'gauge',
            metrics.lastDeployTimestampSeconds
        )
    );
    lines.push(
        promLine(
            'fm_deploy_manifest_checksum_present',
            'Whether Fleet Manager can compute a checksum for the deploy manifest',
            'gauge',
            metrics.manifestChecksumPresent
        )
    );
    lines.push(
        promLine(
            'fm_deploy_last_migration_status',
            'Last migration check status: not_run=0, passed=1, failed=2, skipped=3, unknown=4, not_available=5, degraded=6, running=7, missing=-1',
            'gauge',
            metrics.lastMigrationStatus
        )
    );
    lines.push(
        promLine(
            'fm_deploy_last_smoke_status',
            'Last smoke check status: not_run=0, passed=1, failed=2, skipped=3, unknown=4, not_available=5, degraded=6, running=7, missing=-1',
            'gauge',
            metrics.lastSmokeStatus
        )
    );
    lines.push(
        promLine(
            'fm_deploy_last_api_status',
            'Last API check status: not_run=0, passed=1, failed=2, skipped=3, unknown=4, not_available=5, degraded=6, running=7, missing=-1',
            'gauge',
            metrics.lastApiStatus
        )
    );
    lines.push(
        promLine(
            'fm_deploy_last_browser_status',
            'Last browser check status: not_run=0, passed=1, failed=2, skipped=3, unknown=4, not_available=5, degraded=6, running=7, missing=-1',
            'gauge',
            metrics.lastBrowserStatus
        )
    );
    lines.push(
        promLine(
            'fm_contract_artifact_secret_scan_status',
            'Latest CI artifact secret scan status: not_run=0, passed=1, failed=2, skipped=3, unknown=4, not_available=5, degraded=6, running=7, missing=-1',
            'gauge',
            metrics.secretScanStatus
        )
    );
}

export async function getPrometheusMetrics(): Promise<string> {
    const lines: string[] = [];

    // prom-client owns process/OS/memory/counters/timings; this renders the rest.
    emitEventLoopCpuGcSection(lines);
    await emitClientDeviceUsageSection(lines);
    emitControlPlaneContractSection(lines);

    const mod = (
        name: string
    ): Record<string, number | boolean | string> | null => {
        const reg = modules.get(name);
        if (!reg) return null;
        try {
            return reg.stats();
        } catch {
            return null;
        }
    };

    const devices = mod('devices');
    if (devices) {
        lines.push(
            promLine(
                'fm_devices_total',
                'Total connected devices',
                'gauge',
                devices.total as number
            )
        );
        lines.push(
            promLine(
                'fm_devices_online',
                'Online devices',
                'gauge',
                devices.online as number
            )
        );
        lines.push(
            promLine(
                'fm_devices_offline',
                'Offline devices (transport lost)',
                'gauge',
                devices.offline as number
            )
        );
        lines.push(
            promLine(
                'fm_devices_source_count',
                'Distinct connection source types',
                'gauge',
                devices.sourceCount as number
            )
        );
        lines.push(
            promLine(
                'fm_devices_model_count',
                'Distinct device models',
                'gauge',
                devices.modelCount as number
            )
        );
        for (const [key, value] of Object.entries(devices)) {
            if (key.startsWith('source_') && typeof value === 'number') {
                lines.push(
                    promLabeled(
                        'fm_devices_by_source',
                        {source: key.replace('source_', '')},
                        value
                    )
                );
            }
        }
    }

    const shellyEvents = mod('shellyEvents');
    if (shellyEvents) {
        lines.push(
            promLine(
                'fm_device_connects_total',
                'Total device connect events',
                'counter',
                shellyEvents.connects as number
            )
        );
        lines.push(
            promLine(
                'fm_device_disconnects_total',
                'Total device disconnect events',
                'counter',
                shellyEvents.disconnects as number
            )
        );
        lines.push(
            promLine(
                'fm_device_events_total',
                'Total Shelly events emitted',
                'counter',
                shellyEvents.totalEvents as number
            )
        );
    }

    const deviceInit = mod('deviceInit');
    if (deviceInit) {
        lines.push(
            promLine(
                'fm_device_init_active',
                'Device initializations in progress',
                'gauge',
                deviceInit.active as number
            )
        );
        lines.push(
            promLine(
                'fm_device_init_queued',
                'Device initializations waiting in queue',
                'gauge',
                deviceInit.queued as number
            )
        );
    }

    const waitingRoom = mod('waitingRoom');
    if (waitingRoom) {
        lines.push(
            promLine(
                'fm_waiting_room_pending',
                'Devices pending approval',
                'gauge',
                waitingRoom.pendingDevices as number
            )
        );
    }

    const dbPool = mod('dbPool');
    if (dbPool) {
        lines.push(
            promLine(
                'fm_db_pool_total',
                'Total DB pool connections',
                'gauge',
                dbPool.totalCount as number
            )
        );
        lines.push(
            promLine(
                'fm_db_pool_idle',
                'Idle DB pool connections',
                'gauge',
                dbPool.idleCount as number
            )
        );
        lines.push(
            promLine(
                'fm_db_pool_waiting',
                'Queries waiting for DB connection',
                'gauge',
                dbPool.waitingCount as number
            )
        );
    }

    const dbRuntime = mod('dbRuntime');
    if (dbRuntime) {
        const statusCode = Number(dbRuntime.statusCode ?? 0);
        const status =
            typeof dbRuntime.status === 'string' ? dbRuntime.status : 'unknown';
        lines.push(
            promLine(
                'fm_db_runtime_status',
                'Live DB runtime status: unknown=0, ok=1, stale=2, mismatch=3, error=4',
                'gauge',
                statusCode
            )
        );
        lines.push(
            promLine(
                'fm_db_runtime_check_age_seconds',
                'Age in seconds of the last live DB runtime version check; -1 means unavailable',
                'gauge',
                Number(dbRuntime.checkAgeSeconds ?? -1)
            )
        );
        lines.push(
            promLine(
                'fm_db_runtime_last_success_age_seconds',
                'Age in seconds of the last successful live DB runtime version check; -1 means never successful',
                'gauge',
                Number(dbRuntime.lastSuccessfulAgeSeconds ?? -1)
            )
        );
        lines.push(
            promLine(
                'fm_db_postgres_major',
                'Live PostgreSQL major version reported by the database; -1 means unavailable',
                'gauge',
                Number(dbRuntime.postgresMajor ?? -1)
            )
        );
        lines.push(
            promLine(
                'fm_db_timescale_version_match',
                'Whether the live TimescaleDB extension matches the deploy manifest expectation: match=1, mismatch_or_error=0, unknown=-1',
                'gauge',
                status === 'ok' ? 1 : status === 'unknown' ? -1 : 0
            )
        );
    }

    const statusQueue = mod('statusQueue');
    if (statusQueue) {
        lines.push(
            promLine(
                'fm_status_queue_pending',
                'Pending status messages in buffer',
                'gauge',
                statusQueue.pending as number
            )
        );
        lines.push(
            promLine(
                'fm_status_queue_size',
                'Status rows queued for DB flush',
                'gauge',
                statusQueue.queueSize as number
            )
        );
        lines.push(
            promLine(
                'fm_status_queue_flushing',
                'Whether status flush is in progress',
                'gauge',
                statusQueue.flushing ? 1 : 0
            )
        );
        lines.push(
            promLine(
                'fm_em_stats_queue_size',
                'EM stats rows queued for DB flush',
                'gauge',
                statusQueue.emStatsQueueSize as number
            )
        );
    }

    const emSync = mod('emSync');
    if (emSync) {
        lines.push(
            promLine(
                'fm_em_sync_queue',
                'EM devices in sync queue',
                'gauge',
                emSync.queueSize as number
            )
        );
        lines.push(
            promLine(
                'fm_em_sync_active',
                'EM syncs currently in-flight',
                'gauge',
                emSync.activeSyncs as number
            )
        );
        lines.push(
            promLine(
                'fm_em_sync_max_concurrent',
                'Max concurrent EM syncs allowed',
                'gauge',
                emSync.maxConcurrent as number
            )
        );
        lines.push(
            promLine(
                'fm_em_sync_worst_channel_lag_seconds',
                'Worst EM sync lag in seconds across all tracked device channels',
                'gauge',
                Number(emSync.worstChannelLagSeconds ?? 0)
            )
        );
        lines.push(
            promLine(
                'fm_em_sync_lagged_channels',
                'Number of EM sync device channels with non-zero lag',
                'gauge',
                Number(emSync.laggedChannels ?? 0)
            )
        );
    }

    const audit = mod('audit');
    if (audit) {
        lines.push(
            promLine(
                'fm_audit_queue_length',
                'Audit log entries pending flush',
                'gauge',
                audit.queueLength as number
            )
        );
    }

    const events = mod('events');
    if (events) {
        lines.push(
            promLine(
                'fm_event_listeners',
                'Active event listeners',
                'gauge',
                events.listeners as number
            )
        );
        lines.push(
            promLine(
                'fm_event_types',
                'Registered event types',
                'gauge',
                events.eventTypes as number
            )
        );
        lines.push(
            promLine(
                'fm_event_group_cache_size',
                'Group metadata cache entries',
                'gauge',
                events.groupCacheSize as number
            )
        );
    }

    const commander = mod('commander');
    if (commander) {
        lines.push(
            promLine(
                'fm_rpc_components_registered',
                'Registered RPC components',
                'gauge',
                commander.registered as number
            )
        );
    }

    const wsCommands = mod('wsCommands');
    if (wsCommands) {
        lines.push(
            promLine(
                'fm_ws_internal_commands_total',
                'Internal WS commands processed',
                'counter',
                wsCommands.internalCommands as number
            )
        );
        lines.push(
            promLine(
                'fm_ws_relay_commands_total',
                'Relayed WS commands to devices',
                'counter',
                wsCommands.relayCommands as number
            )
        );
        lines.push(
            promLine(
                'fm_ws_parse_errors_total',
                'WS message parse errors',
                'counter',
                wsCommands.parseErrors as number
            )
        );
    }

    const plugins = mod('plugins');
    if (plugins) {
        lines.push(
            promLine(
                'fm_plugins_loaded',
                'Number of loaded plugins',
                'gauge',
                plugins.loadedPlugins as number
            )
        );
    }
    const pluginWorkers = mod('pluginWorkers');
    if (pluginWorkers) {
        lines.push(
            promLine(
                'fm_plugin_workers_active',
                'Active plugin worker threads',
                'gauge',
                pluginWorkers.activeWorkers as number
            )
        );
    }

    const fw = mod('firmwareScheduler');
    if (fw) {
        lines.push(
            promLine(
                'fm_firmware_scheduler_running',
                'Whether auto-update scheduler is active',
                'gauge',
                fw.running as number
            )
        );
    }

    const mdns = mod('mdns');
    if (mdns) {
        lines.push(
            promLine(
                'fm_mdns_running',
                'Whether mDNS discovery is active',
                'gauge',
                mdns.running as number
            )
        );
    }

    const registry = mod('registry');
    if (registry) {
        lines.push(
            promLine(
                'fm_registry_file_cache_size',
                'Registry file cache entries',
                'gauge',
                registry.fileCacheSize as number
            )
        );
        lines.push(
            promLine(
                'fm_registry_db_cache_size',
                'Registry DB result cache entries',
                'gauge',
                registry.dbCacheSize as number
            )
        );
    }

    const authMod = mod('auth');
    if (authMod) {
        lines.push(
            promLine(
                'fm_auth_userinfo_cache_size',
                'Cached userinfo entries',
                'gauge',
                authMod.userinfoCacheSize as number
            )
        );
    }

    const initStats = getInitDurationStats();
    if (initStats) {
        lines.push(
            promLine(
                'fm_device_init_duration_avg_ms',
                'Avg device init duration in ms',
                'gauge',
                initStats.avgMs
            )
        );
        lines.push(
            promLine(
                'fm_device_init_duration_p95_ms',
                'P95 device init duration in ms',
                'gauge',
                initStats.p95Ms
            )
        );
        lines.push(
            promLine(
                'fm_device_init_duration_p99_ms',
                'P99 device init duration in ms',
                'gauge',
                initStats.p99Ms
            )
        );
        lines.push(
            promLine(
                'fm_device_init_duration_max_ms',
                'Max device init duration in ms',
                'gauge',
                initStats.maxMs
            )
        );
        lines.push(
            promLine(
                'fm_device_init_samples',
                'Number of init duration samples in buffer',
                'gauge',
                initStats.samples
            )
        );
    }

    const diskUsage = getDiskUsage();
    if (Object.keys(diskUsage).length > 0) {
        lines.push(
            '# HELP fm_disk_usage_bytes Disk usage by directory in bytes\n'
        );
        lines.push('# TYPE fm_disk_usage_bytes gauge\n');
        for (const [dir, bytes] of Object.entries(diskUsage)) {
            lines.push(promLabeled('fm_disk_usage_bytes', {dir}, bytes));
        }
    }

    const http = readHttpStats();

    lines.push(
        promLine(
            'fm_http_active_requests',
            'In-flight HTTP requests',
            'gauge',
            http.activeRequests
        )
    );

    if (http.statusCounts.size > 0) {
        lines.push(
            '# HELP fm_http_responses_total HTTP responses by status class\n'
        );
        lines.push('# TYPE fm_http_responses_total counter\n');
        for (const [status, count] of http.statusCounts) {
            lines.push(
                promLabeled(
                    'fm_http_responses_total',
                    {status: String(status)},
                    count
                )
            );
        }
    }

    if (http.requestCounts.size > 0) {
        lines.push(
            '# HELP fm_http_requests_total HTTP requests by route prefix\n'
        );
        lines.push('# TYPE fm_http_requests_total counter\n');
        for (const [route, count] of http.requestCounts) {
            lines.push(promLabeled('fm_http_requests_total', {route}, count));
        }
    }

    if (getLevel() >= 2) {
        const counterDefs = COUNTER_DEFS;

        // Counters with no named definition fall back to a generic name.
        for (const [name, value] of counters) {
            if (!(name in counterDefs)) {
                lines.push(
                    promLine(
                        `fm_counter_${name}`,
                        `Application counter: ${name}`,
                        'counter',
                        value
                    )
                );
            }
        }

        const labeledCounterDefs: Record<string, {help: string}> = {
            rpc_slow_total: {
                help: 'Slow RPC calls (above P95 + offset) by sender type (user|service_user|system)'
            },
            ws_client_backpressure_total: {
                help: 'Browser WS clients hitting send backpressure, by action (paused|dropped)'
            },
            ws_connection_events_total: {
                help: 'WebSocket connection lifecycle events by traffic class and outcome'
            },
            ws_compression_total: {
                help: 'WebSocket connections by traffic class and offered and negotiated compression state'
            },
            ws_message_bytes_total: {
                help: 'Decoded inbound WebSocket message bytes by traffic class, format, and negotiated extension state'
            },
            ws_message_size_bucket_total: {
                help: 'Inbound WebSocket messages by traffic class, format, size bucket, and negotiated extension state'
            },
            ws_wire_bytes_total: {
                help: 'WebSocket TCP wire bytes by traffic class, direction, and negotiated extension state'
            },
            ws_closes_total: {
                help: 'WebSocket closes by traffic class, negotiated extension state, and bounded close code'
            },
            device_gui_events_total: {
                help: 'Device GUI proxy lifecycle events by stage and outcome'
            },
            device_gui_bytes_total: {
                help: 'Device GUI proxy bytes by transport and direction'
            },
            device_gui_duration_ms_total: {
                help: 'Cumulative Device GUI operation duration in milliseconds by stage and outcome'
            },
            device_gui_duration_samples_total: {
                help: 'Device GUI operation duration samples by stage and outcome'
            },
            device_gui_http_responses_total: {
                help: 'Device GUI proxy HTTP responses by status class'
            },
            device_gui_websocket_compression_total: {
                help: 'Device GUI WebSocket connections by offered and negotiated compression state'
            },
            waiting_room_evicted: {
                help: 'Total pending devices evicted from waiting room'
            },
            event_replay_cache_hits_total: {
                help: 'EventReplay L2 cache hits by window (historical|rolling)'
            },
            event_replay_cache_misses_total: {
                help: 'EventReplay L2 cache misses by window (historical|rolling)'
            },
            event_replay_cache_errors_total: {
                help: 'EventReplay L2 cache errors by op (read|write)'
            },
            xadd_rate_limited_total: {
                help: 'XADDs dropped by the per-stream rate limit, by stream label'
            },
            stream_overflow_total: {
                help: 'Times a Redis Stream XLEN exceeded MAXLEN * overflow ratio, by stream label'
            },
            ws_admission_rejected_total: {
                help: 'WS upgrades rejected by the slow-start admission gate, by cohort label'
            },
            device_rpc_rejected_total: {
                help: 'Device RPC calls rejected at the per-device queue cap, by reason label'
            },
            unknown_component_types_seen: {
                help: 'Device status keys whose type prefix has no entity composer, by type label — surfaces firmware that exposes components FM does not yet render'
            },
            discovery_admit_device_total: {
                help: 'Discovery.AdmitDevice calls by outcome (ok|auth_required|unsupported_gen|firmware_too_old|host_not_allowed|unreachable|reboot_failed)'
            },
            discovery_scan_lan_total: {
                help: 'Discovery.ScanLan calls by outcome (ok|mdns_unavailable)'
            },
            auth_mint_scoped_token_total: {
                help: 'Auth.MintScopedToken calls by outcome (ok|bounded_pat_rejected|unauthorized)'
            },
            credential_set_total: {
                help: 'Credential.Set calls by outcome (ok|stage_failed)'
            },
            credential_rotate_total: {
                help: 'Credential.Rotate calls by outcome (ok|stage_failed)'
            },
            credential_clear_total: {
                help: 'Credential.Clear calls by outcome (ok|stage_failed)'
            },
            certificate_sign_csr_total: {
                help: 'Certificate.SignCsr calls by outcome (ok|csr_invalid|subject_mismatch|fm_ca_unavailable)'
            },
            certificate_set_tags_total: {
                help: 'Certificate.SetTags calls by outcome (ok|invalid)'
            },
            certificate_set_groups_total: {
                help: 'Certificate.SetGroups calls by outcome (ok|cross_tenant)'
            },
            serves_created: {
                help: 'Serves.Set links written by relation'
            }
        };

        const labeledGaugeDefs: Record<string, {help: string}> = {
            ws_active_connections: {
                help: 'Current WebSocket connections by traffic class'
            },
            stream_length: {
                help: 'Current XLEN of a monitored Redis Stream, by stream label'
            },
            stream_oldest_age_ms: {
                help: 'Age in milliseconds of the oldest entry in a monitored Redis Stream, by stream label'
            },
            stream_pending_entries: {
                help: 'Current pending-entry count for a monitored Redis Stream consumer group, by stream label'
            }
        };

        const emittedLabeledCounters = new Set<string>();
        for (const {name, labels, value} of labeledCounters.values()) {
            const def = labeledCounterDefs[name];
            if (def && !emittedLabeledCounters.has(name)) {
                lines.push(`# HELP fm_${name} ${def.help}\n`);
                lines.push(`# TYPE fm_${name} counter\n`);
                emittedLabeledCounters.add(name);
            }
            lines.push(promLabeled(`fm_${name}`, labels, value));
        }

        if (gauges.size > 0) {
            for (const [name, value] of gauges) {
                lines.push(
                    promLine(
                        `fm_gauge_${name}`,
                        `Application gauge: ${name}`,
                        'gauge',
                        value
                    )
                );
            }
        }

        const emittedLabeledGauges = new Set<string>();
        for (const {name, labels, value} of labeledGauges.values()) {
            const def = labeledGaugeDefs[name];
            if (def && !emittedLabeledGauges.has(name)) {
                lines.push(`# HELP fm_${name} ${def.help}\n`);
                lines.push(`# TYPE fm_${name} gauge\n`);
                emittedLabeledGauges.add(name);
            }
            lines.push(promLabeled(`fm_${name}`, labels, value));
        }

        if (getWsMessageTypes().size > 0) {
            lines.push(
                '# HELP fm_ws_messages_total WebSocket messages by type\n'
            );
            lines.push('# TYPE fm_ws_messages_total counter\n');
            for (const [type, count] of getWsMessageTypes()) {
                lines.push(promLabeled('fm_ws_messages_total', {type}, count));
            }
        }

        lines.push(
            promLine(
                'fm_rpc_error_buffer_size',
                'RPC errors in ring buffer',
                'gauge',
                getRpcErrors().length
            )
        );
        lines.push(
            promLine(
                'fm_init_failure_buffer_size',
                'Init failures in ring buffer',
                'gauge',
                getInitFailures().length
            )
        );
    }

    return lines.join('') + (await promRegistry.metrics());
}
