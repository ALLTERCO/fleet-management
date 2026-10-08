// Line order is a Grafana scrape contract — the fixture in
// test/fixtures/observabilityPrometheusHeaders.json pins it.

import {runtimeIdentity} from '../../../config/runtimeIdentity';
import {tuning} from '../../../config/tuning';
import {readContractFreshnessMetrics} from '../../controlPlaneContract';
import {getRedisRuntimeSnapshot} from '../../redis/runtimeInfo';
import {getZitadelActionInboxSnapshot} from '../../zitadelActions/inboxMetrics';
import {
    DEVICE_USAGE_WINDOW_DAYS,
    readCachedClientDeviceUsageSnapshot,
    type readClientDeviceUsageRows
} from '../clientDeviceUsage';
import {getInitFailures, getRpcErrors, getWsMessageTypes} from '../eventLog';
import {eventLoopTotals, takeEventLoopWindow} from '../eventLoopWindow';
import {
    INTERNAL_COUNTER_NAMES,
    INTERNAL_GAUGE_NAMES,
    INTERNAL_LABELED_COUNTER_NAMES,
    INTERNAL_LABELED_GAUGE_NAMES,
    reportUnregisteredMetric
} from '../internalMetricRegistry';
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
    applicationEvents,
    counters,
    gauges,
    labeledCounters,
    labeledGauges,
    modules
} from '../state';
import {readHttpStats} from '../topology';

function promLine(
    name: string,
    help: string,
    type: 'counter' | 'gauge',
    value: number
): string {
    return `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n${name} ${value}\n`;
}

// Only pools behind the priority gate report the split; the outbox does not.
function priorityWaitingLines(
    metricPrefix: string,
    label: string,
    stats: Record<string, number | boolean | string>
): string[] {
    const {foregroundWaiting, backgroundWaiting} = stats;
    if (
        typeof foregroundWaiting !== 'number' ||
        typeof backgroundWaiting !== 'number'
    ) {
        return [];
    }
    return [
        promLine(
            `${metricPrefix}_waiting_foreground`,
            `${label} user requests waiting for a connection`,
            'gauge',
            foregroundWaiting
        ),
        promLine(
            `${metricPrefix}_waiting_background`,
            `${label} background work waiting for a connection`,
            'gauge',
            backgroundWaiting
        )
    ];
}

// Counted from the moment pg-pool hands a connection over until it is back.
function priorityCheckedOutLines(
    metricPrefix: string,
    label: string,
    stats: Record<string, number | boolean | string>
): string[] {
    const {foregroundCheckedOut, backgroundCheckedOut} = stats;
    if (
        typeof foregroundCheckedOut !== 'number' ||
        typeof backgroundCheckedOut !== 'number'
    ) {
        return [];
    }
    return [
        promLine(
            `${metricPrefix}_checked_out_foreground`,
            `${label} connections checked out by user requests`,
            'gauge',
            foregroundCheckedOut
        ),
        promLine(
            `${metricPrefix}_checked_out_background`,
            `${label} connections checked out by background work`,
            'gauge',
            backgroundCheckedOut
        )
    ];
}

type LabeledMetricDefinition = {
    prometheusName: string;
    prometheusScale?: number;
    help: string;
};

export const LABELED_COUNTER_DEFS = {
    http_response_bytes_total: {
        prometheusName: 'fm_http_response_bytes_total',
        help: 'HTTP response wire bytes (egress) by route class'
    },
    rpc_slow_total: {
        prometheusName: 'fm_rpc_slow_total',
        help: 'Slow RPC calls (above P95 + offset) by sender type (user|service_user|system)'
    },
    ws_client_backpressure_total: {
        prometheusName: 'fm_ws_client_backpressure_total',
        help: 'Browser WS clients hitting send backpressure, by action (paused|dropped)'
    },
    ws_connection_events_total: {
        prometheusName: 'fm_ws_connection_events_total',
        help: 'WebSocket connection lifecycle events by traffic class and outcome'
    },
    ws_compression_total: {
        prometheusName: 'fm_ws_compression_total',
        help: 'WebSocket connections by traffic class and offered and negotiated compression state'
    },
    ws_message_bytes_total: {
        prometheusName: 'fm_ws_message_bytes_total',
        help: 'Decoded inbound WebSocket message bytes by traffic class, format, and negotiated extension state'
    },
    ws_message_size_bucket_total: {
        prometheusName: 'fm_ws_message_size_bucket_total',
        help: 'Inbound WebSocket messages by traffic class, format, size bucket, and negotiated extension state'
    },
    ws_wire_bytes_total: {
        prometheusName: 'fm_ws_wire_bytes_total',
        help: 'WebSocket TCP wire bytes by traffic class, direction, and negotiated extension state'
    },
    ws_closes_total: {
        prometheusName: 'fm_ws_closes_total',
        help: 'WebSocket closes by traffic class, negotiated extension state, and bounded close code'
    },
    device_gui_events_total: {
        prometheusName: 'fm_device_gui_events_total',
        help: 'Device GUI proxy lifecycle events by stage and outcome'
    },
    device_gui_bytes_total: {
        prometheusName: 'fm_device_gui_bytes_total',
        help: 'Device GUI proxy bytes by transport and direction'
    },
    device_gui_duration_ms_total: {
        prometheusName: 'fm_device_gui_duration_seconds_total',
        prometheusScale: 1 / 1000,
        help: 'Cumulative Device GUI operation duration in seconds by stage and outcome'
    },
    device_gui_duration_samples_total: {
        prometheusName: 'fm_device_gui_duration_samples_total',
        help: 'Device GUI operation duration samples by stage and outcome'
    },
    device_gui_http_responses_total: {
        prometheusName: 'fm_device_gui_http_responses_total',
        help: 'Device GUI proxy HTTP responses by status class'
    },
    device_gui_websocket_compression_total: {
        prometheusName: 'fm_device_gui_websocket_compression_total',
        help: 'Device GUI WebSocket connections by offered and negotiated compression state'
    },
    waiting_room_evicted: {
        prometheusName: 'fm_waiting_room_evicted_total',
        help: 'Total pending devices evicted from waiting room'
    },
    event_replay_cache_hits_total: {
        prometheusName: 'fm_event_replay_cache_hits_total',
        help: 'EventReplay L2 cache hits by window (historical|rolling)'
    },
    event_replay_cache_misses_total: {
        prometheusName: 'fm_event_replay_cache_misses_total',
        help: 'EventReplay L2 cache misses by window (historical|rolling)'
    },
    event_replay_cache_errors_total: {
        prometheusName: 'fm_event_replay_cache_errors_total',
        help: 'EventReplay L2 cache errors by op (read|write)'
    },
    xadd_rate_limited_total: {
        prometheusName: 'fm_xadd_rate_limited_total',
        help: 'XADDs dropped by the per-stream rate limit, by stream label'
    },
    em_sync_pull_pauses_total: {
        prometheusName: 'fm_em_sync_pull_pauses_total',
        help: 'EM history pull passes stopped before their next page, by reason (pool, bytes, age)'
    },
    redis_write_admitted_total: {
        prometheusName: 'fm_redis_write_admitted_total',
        help: 'Redis writes admitted by the bounded producer lane'
    },
    redis_write_completed_total: {
        prometheusName: 'fm_redis_write_completed_total',
        help: 'Redis writes completed by producer lane and outcome'
    },
    redis_write_duration_ms_total: {
        prometheusName: 'fm_redis_write_duration_seconds_total',
        prometheusScale: 1 / 1000,
        help: 'Cumulative Redis write duration in seconds by producer lane'
    },
    redis_write_backpressure_rejected_total: {
        prometheusName: 'fm_redis_write_backpressure_rejected_total',
        help: 'Redis writes rejected because the bounded producer lane was full'
    },
    stream_overflow_total: {
        prometheusName: 'fm_stream_overflow_total',
        help: 'Times a Redis Stream XLEN exceeded MAXLEN * overflow ratio, by stream label'
    },
    ws_admission_rejected_total: {
        prometheusName: 'fm_ws_admission_rejected_total',
        help: 'WS upgrades rejected by the slow-start admission gate, by cohort label'
    },
    em_rollup_completed_keys_total: {
        prometheusName: 'fm_em_rollup_completed_keys_total',
        help: 'EM rollup keys recomputed and saved, by the source the bucket was computed from'
    },
    device_rpc_rejected_total: {
        prometheusName: 'fm_device_rpc_rejected_total',
        help: 'Device RPC calls rejected at the per-device queue cap, by reason label'
    },
    unknown_component_types_seen: {
        prometheusName: 'fm_unknown_component_types_seen_total',
        help: 'Device status keys whose type prefix has no entity composer, by type label — surfaces firmware that exposes components FM does not yet render'
    },
    discovery_admit_device_total: {
        prometheusName: 'fm_discovery_admit_device_total',
        help: 'Discovery.AdmitDevice calls by outcome (ok|auth_required|unsupported_gen|firmware_too_old|host_not_allowed|unreachable|reboot_failed)'
    },
    discovery_probe_total: {
        prometheusName: 'fm_discovery_probe_total',
        help: 'Discovery.Probe calls by outcome'
    },
    discovery_scan_lan_total: {
        prometheusName: 'fm_discovery_scan_lan_total',
        help: 'Discovery.ScanLan calls by outcome (ok|mdns_unavailable)'
    },
    auth_mint_scoped_token_total: {
        prometheusName: 'fm_auth_mint_scoped_token_total',
        help: 'Auth.MintScopedToken calls by outcome (ok|bounded_pat_rejected|unauthorized)'
    },
    zitadel_webhook_enqueued_total: {
        prometheusName: 'fm_zitadel_webhook_enqueued_total',
        help: 'Verified Zitadel callbacks persisted to the durable inbox by action'
    },
    zitadel_webhook_duplicate_total: {
        prometheusName: 'fm_zitadel_webhook_duplicate_total',
        help: 'Repeated Zitadel callbacks acknowledged idempotently by action'
    },
    zitadel_webhook_processed_total: {
        prometheusName: 'fm_zitadel_webhook_processed_total',
        help: 'Durable Zitadel callbacks processed successfully by action'
    },
    zitadel_webhook_processing_failures_total: {
        prometheusName: 'fm_zitadel_webhook_processing_failures_total',
        help: 'Durable Zitadel callback processing failures scheduled for retry by action'
    },
    credential_set_total: {
        prometheusName: 'fm_credential_set_total',
        help: 'Credential.Set calls by outcome (ok|stage_failed)'
    },
    credential_rotate_total: {
        prometheusName: 'fm_credential_rotate_total',
        help: 'Credential.Rotate calls by outcome (ok|stage_failed)'
    },
    credential_clear_total: {
        prometheusName: 'fm_credential_clear_total',
        help: 'Credential.Clear calls by outcome (ok|stage_failed)'
    },
    certificate_sign_csr_total: {
        prometheusName: 'fm_certificate_sign_csr_total',
        help: 'Certificate.SignCsr calls by outcome (ok|csr_invalid|subject_mismatch|fm_ca_unavailable)'
    },
    certificate_set_tags_total: {
        prometheusName: 'fm_certificate_set_tags_total',
        help: 'Certificate.SetTags calls by outcome (ok|invalid)'
    },
    certificate_set_groups_total: {
        prometheusName: 'fm_certificate_set_groups_total',
        help: 'Certificate.SetGroups calls by outcome (ok|cross_tenant)'
    },
    serves_created: {
        prometheusName: 'fm_serves_created_total',
        help: 'Serves.Set links written by relation'
    },
    observability_collector_failures_total: {
        prometheusName: 'fm_observability_collector_failures_total',
        help: 'Background observability collector failures by collector'
    },
    device_ingress_connections_total: {
        prometheusName: 'fm_device_ingress_connections_total',
        help: 'Device ingress connection outcomes by security model, transport, and risk level'
    },
    device_ingress_rejections_total: {
        prometheusName: 'fm_device_ingress_rejections_total',
        help: 'Device ingress rejections by reason, severity, and transport'
    },
    device_ingress_token_rotations_total: {
        prometheusName: 'fm_device_ingress_token_rotations_total',
        help: 'Device ingress enrollment token lifecycle events by outcome'
    },
    device_ingress_certificate_bindings_total: {
        prometheusName: 'fm_device_ingress_certificate_bindings_total',
        help: 'Device ingress certificate binding events by outcome'
    },
    device_ingress_rotation_jobs_total: {
        prometheusName: 'fm_device_ingress_rotation_jobs_total',
        help: 'Device ingress token rotation job state changes by state'
    },
    device_ingress_provisioning_sessions_total: {
        prometheusName: 'fm_device_ingress_provisioning_sessions_total',
        help: 'Device ingress provisioning session events by outcome and profile'
    },
    ingress_stage_total: {
        prometheusName: 'fm_ingress_stage_total',
        help: 'Device ingress lifecycle events by stage'
    },
    ingress_dropped_total: {
        prometheusName: 'fm_ingress_dropped_total',
        help: 'Device ingress lifecycle drops by reason'
    },
    redis_stream_group_setup_errors_total: {
        prometheusName: 'fm_redis_stream_group_setup_errors_total',
        help: 'Failed consumer group setups for a Redis stream consumer, by source and reason (oom, error)'
    }
} satisfies Record<string, LabeledMetricDefinition>;

export const LABELED_GAUGE_DEFS = {
    ws_active_connections: {
        prometheusName: 'fm_ws_active_connections',
        help: 'Current WebSocket connections by traffic class'
    },
    em_sync_pull_paused: {
        prometheusName: 'fm_em_sync_pull_paused',
        help: 'EM history catch-up held by the push buffer, by reason (bytes, age)'
    },
    stream_length: {
        prometheusName: 'fm_stream_length',
        help: 'Current XLEN of a monitored Redis Stream, by stream label'
    },
    stream_oldest_age_ms: {
        prometheusName: 'fm_stream_oldest_age_seconds',
        prometheusScale: 1 / 1000,
        help: 'Age in seconds of the oldest entry in a monitored Redis Stream, by stream label'
    },
    redis_stream_group_waiting: {
        prometheusName: 'fm_redis_stream_group_waiting',
        help: '1 while a Redis stream consumer cannot read because its consumer group is not set up, by source'
    },
    stream_pending_entries: {
        prometheusName: 'fm_stream_pending_entries',
        help: 'Current pending-entry count for a monitored Redis Stream consumer group, by stream label'
    },
    redis_write_capacity_commands: {
        prometheusName: 'fm_redis_write_capacity_commands',
        help: 'Configured pending-write capacity of the Redis producer lane'
    },
    redis_write_pending_commands: {
        prometheusName: 'fm_redis_write_pending_commands',
        help: 'Current pending Redis writes observed by producer lane'
    },
    redis_write_duration_ms_max: {
        prometheusName: 'fm_redis_write_duration_max_seconds',
        prometheusScale: 1 / 1000,
        help: 'Maximum Redis write duration observed in seconds by producer lane'
    },
    db_query_total_time_ms: {
        prometheusName: 'fm_db_query_total_time_seconds',
        prometheusScale: 1 / 1000,
        help: 'Cumulative execution time in seconds of the top DB queries, by schema.function tag'
    },
    db_query_mean_time_ms: {
        prometheusName: 'fm_db_query_mean_time_seconds',
        prometheusScale: 1 / 1000,
        help: 'Mean execution time in seconds of the top DB queries, by schema.function tag'
    },
    db_query_calls: {
        prometheusName: 'fm_db_query_calls',
        help: 'Cumulative call count of the top DB queries, by schema.function tag'
    },
    devices: {
        prometheusName: 'fm_devices',
        help: 'Devices in the database by kind and generation'
    },
    devices_by_model: {
        prometheusName: 'fm_devices_by_model',
        help: 'Devices in the database by model'
    },
    db_table_size_bytes: {
        prometheusName: 'fm_db_table_size_bytes',
        help: 'On-disk size (bytes) of the largest tables, hypertable-aware'
    },
    db_table_live_tuples: {
        prometheusName: 'fm_db_table_live_tuples',
        help: 'Live tuples per table (tables with the most dead tuples)'
    },
    db_table_dead_tuples: {
        prometheusName: 'fm_db_table_dead_tuples',
        help: 'Dead tuples per table (tables with the most dead tuples)'
    },
    db_table_autovacuum_count: {
        prometheusName: 'fm_db_table_autovacuum_runs',
        help: 'Cumulative autovacuum runs per table'
    },
    observability_collector_duration_ms: {
        prometheusName: 'fm_observability_collector_duration_seconds',
        prometheusScale: 1 / 1000,
        help: 'Latest background observability collector duration in seconds'
    },
    observability_collector_last_success_timestamp_seconds: {
        prometheusName:
            'fm_observability_collector_last_success_timestamp_seconds',
        help: 'Unix timestamp of the latest successful background observability collection'
    },
    device_ingress_live_connections: {
        prometheusName: 'fm_device_ingress_live_connections',
        help: 'Current device ingress connections by security model, transport, and risk level'
    },
    em_rollup_held_buckets: {
        prometheusName: 'fm_em_rollup_held_buckets',
        help: 'EM rollup buckets held inside the correction window, by reason'
    },
    em_rollup_held_oldest_bucket_age_seconds: {
        prometheusName: 'fm_em_rollup_held_oldest_bucket_age_seconds',
        help: 'Age of the oldest held EM rollup bucket, by reason'
    },
    em_rollup_abandoned_buckets: {
        prometheusName: 'fm_em_rollup_abandoned_buckets',
        help: 'EM rollup buckets abandoned with evidence and not computed again, by reason'
    }
} satisfies Record<string, LabeledMetricDefinition>;

export type DedicatedLabeledCounterName = keyof typeof LABELED_COUNTER_DEFS;
export type DedicatedLabeledGaugeName = keyof typeof LABELED_GAUGE_DEFS;

const LABELED_COUNTER_DEFINITIONS: Readonly<
    Record<string, LabeledMetricDefinition>
> = LABELED_COUNTER_DEFS;
const LABELED_GAUGE_DEFINITIONS: Readonly<
    Record<string, LabeledMetricDefinition>
> = LABELED_GAUGE_DEFS;

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

function emitRuntimeConfigurationSection(lines: string[]): void {
    const streamCaps: ReadonlyArray<readonly [string, number]> = [
        ['em-sync', tuning.energy.emSyncStreamMaxlen],
        ['status-telemetry', tuning.status.streamMaxlen],
        ['device-snapshot', tuning.deviceSnapshot.streamMaxlen],
        ['device-event', tuning.deviceEvents.streamMaxlen],
        ['sensor-capture', tuning.sensorCapture.streamMaxlen],
        ['device-ingest', tuning.ingest.maxlen],
        ['websocket-replay-per-session', tuning.ws.streamMaxlen],
        ['audit-overflow', tuning.audit.overflowMaxlen]
    ];
    lines.push(
        '# HELP fm_build_info Fleet Manager build information\n',
        '# TYPE fm_build_info gauge\n',
        promLabeled(
            'fm_build_info',
            {
                version: runtimeIdentity.appVersion,
                commit: runtimeIdentity.buildCommit,
                api_contract: runtimeIdentity.apiContractVersion,
                ui_contract: runtimeIdentity.uiContractVersion,
                frontend_artifact: runtimeIdentity.frontendArtifactId,
                frontend_version: runtimeIdentity.frontendArtifactVersion
            },
            1
        ),
        '# HELP fm_runtime_info Fleet Manager runtime information\n',
        '# TYPE fm_runtime_info gauge\n',
        promLabeled(
            'fm_runtime_info',
            {
                node_version: runtimeIdentity.nodeVersion,
                platform: runtimeIdentity.platform,
                architecture: runtimeIdentity.architecture
            },
            1
        ),
        '# HELP fm_runtime_config_info Safe Fleet Manager deployment configuration identity\n',
        '# TYPE fm_runtime_config_info gauge\n',
        promLabeled(
            'fm_runtime_config_info',
            {
                deployment_mode: runtimeIdentity.deploymentMode,
                topology_mode: runtimeIdentity.topologyMode,
                client: runtimeIdentity.clientId,
                environment: runtimeIdentity.environmentId,
                compose_project: runtimeIdentity.composeProject,
                fingerprint: runtimeIdentity.configurationFingerprint
            },
            1
        ),
        promLine(
            'fm_em_rollup_workers',
            'Configured energy rollup worker count',
            'gauge',
            tuning.energy.rollupWorkers
        ),
        promLine(
            'fm_em_rollup_batch_size',
            'Configured energy rollup batch size',
            'gauge',
            tuning.energy.rollupBatchSize
        ),
        promLine(
            'fm_runtime_available_parallelism',
            'CPU parallelism available to the Node.js process',
            'gauge',
            runtimeIdentity.availableParallelism
        ),
        promLine(
            'fm_em_sync_max_concurrent_devices',
            'Configured maximum concurrent EM device syncs',
            'gauge',
            tuning.rpc.maxConcurrentEmSyncs
        ),
        promLine(
            'fm_em_sync_max_concurrent_channels',
            'Configured maximum concurrent EM channel syncs',
            'gauge',
            tuning.rpc.maxConcurrentEmSyncChannels
        ),
        promLine(
            'fm_em_sync_catchup_share_percent',
            'Configured EM sync slots reserved for catch-up work',
            'gauge',
            tuning.energy.emSyncCatchupSharePct
        ),
        promLine(
            'fm_em_sync_catchup_high_water_percent',
            'EM push buffer byte budget percentage that pauses history pulls',
            'gauge',
            tuning.energy.emSyncCatchupHighWaterPct
        ),
        promLine(
            'fm_em_sync_buffer_max_bytes',
            'Configured byte budget of the EM push buffer in Redis',
            'gauge',
            tuning.energy.emSyncStreamMaxBytes
        ),
        promLine(
            'fm_em_sync_pull_pause_age_seconds',
            'Oldest EM push buffer entry age that pauses history pulls',
            'gauge',
            tuning.energy.emSyncPullPauseAgeMs / 1000
        ),
        promLine(
            'fm_report_worker_concurrency',
            'Shared durable worker concurrency available to report exports',
            'gauge',
            tuning.delivery.outboxConcurrency
        ),
        promLine(
            'fm_report_pdf_render_budget_seconds',
            'Configured formatted PDF render-time budget in seconds',
            'gauge',
            tuning.report.pdfRenderBudgetMs / 1000
        ),
        promLine(
            'fm_alert_sweep_concurrency',
            'Configured concurrent alert sweep evaluations',
            'gauge',
            tuning.alert.sweepConcurrency
        ),
        promLine(
            'fm_alert_sweep_batch_size',
            'Configured alert sweep batch size',
            'gauge',
            tuning.alert.sweepBatchSize
        ),
        promLine(
            'fm_zitadel_db_max_open_connections',
            'Configured Zitadel PostgreSQL maximum open connections',
            'gauge',
            Number(
                runtimeIdentity.effectiveConfig.zitadel_db_max_open_connections
            )
        ),
        promLine(
            'fm_zitadel_db_max_idle_connections',
            'Configured Zitadel PostgreSQL maximum idle connections',
            'gauge',
            Number(
                runtimeIdentity.effectiveConfig.zitadel_db_max_idle_connections
            )
        ),
        '# HELP fm_zitadel_password_hasher_info Configured Zitadel password hasher\n',
        '# TYPE fm_zitadel_password_hasher_info gauge\n',
        promLabeled(
            'fm_zitadel_password_hasher_info',
            {
                algorithm: String(
                    runtimeIdentity.effectiveConfig.zitadel_hash_algorithm
                ),
                cost: String(runtimeIdentity.effectiveConfig.zitadel_hash_cost)
            },
            1
        ),
        promLine(
            'fm_auth_introspection_timeout_seconds',
            'Configured Zitadel token introspection timeout',
            'gauge',
            tuning.zitadel.introspectionTimeoutMs / 1000
        )
    );
    lines.push(
        '# HELP fm_stream_maxlen Configured Redis Stream capacity\n',
        '# TYPE fm_stream_maxlen gauge\n',
        ...streamCaps.map(([stream, maxlen]) =>
            promLabeled('fm_stream_maxlen', {stream}, maxlen)
        ),
        '# HELP fm_stream_overflow_warning_ratio Configured stream overflow warning ratio\n',
        '# TYPE fm_stream_overflow_warning_ratio gauge\n',
        ...streamCaps.map(([stream]) =>
            promLabeled(
                'fm_stream_overflow_warning_ratio',
                {stream},
                tuning.observability.healthOverflowRatio
            )
        ),
        '# HELP fm_status_stream_warning_percent Live-status stream warning threshold\n',
        '# TYPE fm_status_stream_warning_percent gauge\n',
        'fm_status_stream_warning_percent 70\n',
        '# HELP fm_status_stream_critical_percent Live-status stream critical threshold\n',
        '# TYPE fm_status_stream_critical_percent gauge\n',
        'fm_status_stream_critical_percent 85\n'
    );
    const redisRuntime = getRedisRuntimeSnapshot();
    const zitadelInbox = getZitadelActionInboxSnapshot();
    lines.push(
        '# HELP fm_redis_runtime_info Live Redis version and durability configuration\n',
        '# TYPE fm_redis_runtime_info gauge\n',
        promLabeled(
            'fm_redis_runtime_info',
            {
                version: redisRuntime.version,
                eviction_policy: redisRuntime.evictionPolicy,
                aof_enabled:
                    redisRuntime.aofEnabled === null
                        ? 'unknown'
                        : String(redisRuntime.aofEnabled)
            },
            1
        ),
        promLine(
            'fm_zitadel_webhook_queue_depth',
            'Durable Zitadel callbacks waiting for processing',
            'gauge',
            zitadelInbox.queued
        ),
        promLine(
            'fm_zitadel_webhook_in_progress',
            'Durable Zitadel callbacks currently processing',
            'gauge',
            zitadelInbox.inProgress
        ),
        promLine(
            'fm_zitadel_webhook_oldest_wait_seconds',
            'Age of the oldest durable Zitadel callback waiting for processing',
            'gauge',
            zitadelInbox.oldestQueuedAgeSeconds
        ),
        promLine(
            'fm_zitadel_webhook_last_success_timestamp_seconds',
            'Unix timestamp of the last successfully processed Zitadel callback',
            'gauge',
            zitadelInbox.lastSuccessTimestampSeconds
        )
    );
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
            'fm_event_loop_lag_seconds',
            'Event loop lag in seconds',
            'gauge',
            getLagMs() / 1000
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
            '# HELP fm_event_loop_delay_seconds Event loop delay percentiles in seconds\n'
        );
        lines.push('# TYPE fm_event_loop_delay_seconds gauge\n');
        lines.push(
            promLabeled(
                'fm_event_loop_delay_seconds',
                {percentile: '0.5'},
                elHistogram.percentile(50) / 1e9
            )
        );
        lines.push(
            promLabeled(
                'fm_event_loop_delay_seconds',
                {percentile: '0.95'},
                elHistogram.percentile(95) / 1e9
            )
        );
        lines.push(
            promLabeled(
                'fm_event_loop_delay_seconds',
                {percentile: '0.99'},
                elHistogram.percentile(99) / 1e9
            )
        );
        lines.push(
            promLabeled(
                'fm_event_loop_delay_seconds',
                {percentile: '1.0'},
                elHistogram.max / 1e9
            )
        );
    }

    lines.push(
        promLine(
            'fm_gc_pause_seconds_total',
            'Total GC pause time in seconds',
            'counter',
            gc.totalPauseMs / 1000
        )
    );
    lines.push(
        promLine(
            'fm_gc_pauses_total',
            'Total GC pause count',
            'counter',
            gc.pauseCount
        )
    );
    lines.push(
        promLine(
            'fm_gc_pause_max_seconds',
            'Max GC pause in seconds',
            'gauge',
            gc.maxPauseMs / 1000
        )
    );
    emitEventLoopWindowSection(lines);
}

function emitEventLoopWindowSection(lines: string[]): void {
    const window = takeEventLoopWindow();
    if (!window) return;
    lines.push(
        promLine(
            'fm_event_loop_window_seconds',
            'Length of the event loop window read by this scrape',
            'gauge',
            window.seconds
        ),
        promLine(
            'fm_event_loop_window_utilization',
            'Event loop utilization since the previous scrape (0-1)',
            'gauge',
            window.utilization
        )
    );
    const totals = eventLoopTotals();
    lines.push(
        promLine(
            'fm_event_loop_active_seconds_total',
            'Event loop time spent running callbacks',
            'counter',
            totals.activeSeconds
        ),
        promLine(
            'fm_event_loop_idle_seconds_total',
            'Event loop time spent waiting for events',
            'counter',
            totals.idleSeconds
        )
    );
    if (!window.delay) return;
    const {delay} = window;
    lines.push(
        '# HELP fm_event_loop_window_delay_seconds Event loop delay at 1 ms resolution since the previous scrape\n',
        '# TYPE fm_event_loop_window_delay_seconds gauge\n',
        promLabeled(
            'fm_event_loop_window_delay_seconds',
            {percentile: '0.5'},
            delay.p50Seconds
        ),
        promLabeled(
            'fm_event_loop_window_delay_seconds',
            {percentile: '0.99'},
            delay.p99Seconds
        ),
        promLabeled(
            'fm_event_loop_window_delay_seconds',
            {percentile: '1.0'},
            delay.maxSeconds
        ),
        promLine(
            'fm_event_loop_delay_samples_total',
            'Event loop delay samples taken at 1 ms resolution',
            'counter',
            totals.delaySamples
        ),
        promLine(
            'fm_event_loop_delay_sample_seconds_total',
            'Sum of event loop delay samples at 1 ms resolution',
            'counter',
            totals.delaySeconds
        )
    );
}

function emitClientDeviceUsageSection(lines: string[]): void {
    const usage = readCachedClientDeviceUsageSnapshot();
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
    emitRuntimeConfigurationSection(lines);
    emitEventLoopCpuGcSection(lines);
    emitClientDeviceUsageSection(lines);
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
                dbPool.total as number
            )
        );
        lines.push(
            promLine(
                'fm_db_pool_idle',
                'Idle DB pool connections',
                'gauge',
                dbPool.idle as number
            )
        );
        lines.push(
            promLine(
                'fm_db_pool_waiting',
                'Queries waiting for DB connection',
                'gauge',
                dbPool.waiting as number
            )
        );
        lines.push(
            ...priorityWaitingLines('fm_db_pool', 'Shared DB pool', dbPool),
            ...priorityCheckedOutLines('fm_db_pool', 'Shared DB pool', dbPool)
        );
    }

    for (const [moduleName, metricName, label] of [
        ['dbOutboxPool', 'fm_db_outbox_pool', 'Outbox DB pool']
    ] as const) {
        const pool = mod(moduleName);
        if (!pool) continue;
        lines.push(
            promLine(
                `${metricName}_total`,
                `${label} total connections`,
                'gauge',
                pool.totalCount as number
            ),
            promLine(
                `${metricName}_idle`,
                `${label} idle connections`,
                'gauge',
                pool.idleCount as number
            ),
            promLine(
                `${metricName}_waiting`,
                `${label} waiting clients`,
                'gauge',
                pool.waitingCount as number
            ),
            ...priorityWaitingLines(metricName, label, pool),
            ...priorityCheckedOutLines(metricName, label, pool)
        );
    }

    const dbRuntime = mod('dbRuntime');
    if (dbRuntime) {
        const statusCode = Number(dbRuntime.statusCode ?? 0);
        const status =
            typeof dbRuntime.status === 'string' ? dbRuntime.status : 'unknown';
        lines.push(
            '# HELP fm_db_runtime_info Live PostgreSQL and TimescaleDB version information\n',
            '# TYPE fm_db_runtime_info gauge\n',
            promLabeled(
                'fm_db_runtime_info',
                {
                    postgres_version: String(
                        dbRuntime.postgresVersion ?? 'unknown'
                    ),
                    timescale_version: String(
                        dbRuntime.timescaleVersion ?? 'unknown'
                    ),
                    expected_timescale_version: String(
                        dbRuntime.expectedTimescaleVersion ?? 'unknown'
                    )
                },
                1
            ),
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
                'fm_db_runtime_last_success_timestamp_seconds',
                'Unix timestamp of the last successful database runtime probe; -1 means never',
                'gauge',
                dbRuntime.lastSuccessfulAt
                    ? Math.floor(
                          new Date(
                              String(dbRuntime.lastSuccessfulAt)
                          ).getTime() / 1000
                      )
                    : -1
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
                'fm_em_raw_retention_seconds',
                'Authoritative TimescaleDB retention for raw EM data; -1 means unavailable or unlimited',
                'gauge',
                Number(dbRuntime.rawRetentionSeconds ?? -1)
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
        lines.push(
            promLine(
                'fm_em_sync_caught_up_slack_seconds',
                'Configured lag threshold that separates caught-up EM channels from backlog',
                'gauge',
                Number(emSync.caughtUpSlackSeconds ?? 0)
            )
        );
        lines.push(
            promLine(
                'fm_em_sync_live_cadence_max_seconds',
                'Declared upper bound between a healthy live-edge pass completing and its next eligibility',
                'gauge',
                Number(emSync.liveCadenceMaxSeconds ?? 0)
            )
        );
        lines.push(
            promLine(
                'fm_em_sync_channels_beyond_caught_up_slack',
                'Number of EM sync device channels whose lag exceeds the configured caught-up slack',
                'gauge',
                Number(emSync.channelsBeyondCaughtUpSlack ?? 0)
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
                events.deviceGroupsCacheSize as number
            )
        );
        lines.push(
            promLine(
                'fm_event_organization_access_version_orgs',
                'Organizations tracked by the access-cache version map',
                'gauge',
                events.organizationAccessVersionOrgs as number
            )
        );
        lines.push(
            promLine(
                'fm_event_device_group_metadata_version_orgs',
                'Organizations tracked by the device group-metadata version map',
                'gauge',
                events.deviceGroupMetadataVersionOrgs as number
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
                'fm_device_init_duration_avg_seconds',
                'Average device init duration in seconds',
                'gauge',
                initStats.avgMs / 1000
            )
        );
        lines.push(
            promLine(
                'fm_device_init_duration_p95_seconds',
                'P95 device init duration in seconds',
                'gauge',
                initStats.p95Ms / 1000
            )
        );
        lines.push(
            promLine(
                'fm_device_init_duration_p99_seconds',
                'P99 device init duration in seconds',
                'gauge',
                initStats.p99Ms / 1000
            )
        );
        lines.push(
            promLine(
                'fm_device_init_duration_max_seconds',
                'Maximum device init duration in seconds',
                'gauge',
                initStats.maxMs / 1000
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
        const applicationCounters = [...applicationEvents.entries()].sort(
            ([left], [right]) => left.localeCompare(right)
        );

        if (applicationCounters.length > 0) {
            lines.push(
                '# HELP fm_application_events_total Application events without a dedicated Prometheus metric definition\n'
            );
            lines.push('# TYPE fm_application_events_total counter\n');
            for (const [name, value] of applicationCounters) {
                lines.push(
                    promLabeled(
                        'fm_application_events_total',
                        {event: name},
                        value
                    )
                );
            }
        }

        const internalCounters = [...counters.entries()]
            .filter(([name]) => INTERNAL_COUNTER_NAMES.has(name))
            .sort(([left], [right]) => left.localeCompare(right));
        if (internalCounters.length > 0) {
            lines.push(
                '# HELP fm_internal_events_total Registered internal events without a dedicated Prometheus metric family\n'
            );
            lines.push('# TYPE fm_internal_events_total counter\n');
            for (const [name, value] of internalCounters) {
                lines.push(
                    promLabeled(
                        'fm_internal_events_total',
                        {event: name},
                        value
                    )
                );
            }
        }

        const emittedLabeledCounters = new Set<string>();
        const internalLabeledCounters = [];
        for (const {name, labels, value} of labeledCounters.values()) {
            const def = LABELED_COUNTER_DEFINITIONS[name];
            if (!def) {
                if (INTERNAL_LABELED_COUNTER_NAMES.has(name)) {
                    internalLabeledCounters.push({name, labels, value});
                } else {
                    reportUnregisteredMetric('labeled_counter', name);
                }
                continue;
            }
            const prometheusName = def.prometheusName;
            if (!emittedLabeledCounters.has(prometheusName)) {
                lines.push(`# HELP ${prometheusName} ${def.help}\n`);
                lines.push(`# TYPE ${prometheusName} counter\n`);
                emittedLabeledCounters.add(prometheusName);
            }
            lines.push(
                promLabeled(
                    prometheusName,
                    labels,
                    value * (def.prometheusScale ?? 1)
                )
            );
        }
        if (internalLabeledCounters.length > 0) {
            lines.push(
                '# HELP fm_internal_labeled_events_total Registered internal events with labels and without a dedicated Prometheus metric family\n'
            );
            lines.push('# TYPE fm_internal_labeled_events_total counter\n');
            for (const {name, labels, value} of internalLabeledCounters) {
                lines.push(
                    promLabeled(
                        'fm_internal_labeled_events_total',
                        {event: name, labels: JSON.stringify(labels)},
                        value
                    )
                );
            }
        }

        if (gauges.size > 0) {
            const internalGauges = [...gauges.entries()]
                .filter(([name]) => INTERNAL_GAUGE_NAMES.has(name))
                .sort(([left], [right]) => left.localeCompare(right));
            if (internalGauges.length > 0) {
                lines.push(
                    '# HELP fm_internal_values Registered internal gauge values without a dedicated Prometheus metric family\n'
                );
                lines.push('# TYPE fm_internal_values gauge\n');
            }
            for (const [name, value] of internalGauges) {
                lines.push(
                    promLabeled('fm_internal_values', {metric: name}, value)
                );
            }
        }

        const emittedLabeledGauges = new Set<string>();
        const internalLabeledGauges = [];
        for (const {name, labels, value} of labeledGauges.values()) {
            const def = LABELED_GAUGE_DEFINITIONS[name];
            if (!def) {
                if (INTERNAL_LABELED_GAUGE_NAMES.has(name)) {
                    internalLabeledGauges.push({name, labels, value});
                } else {
                    reportUnregisteredMetric('labeled_gauge', name);
                }
                continue;
            }
            const prometheusName = def.prometheusName;
            if (!emittedLabeledGauges.has(prometheusName)) {
                lines.push(`# HELP ${prometheusName} ${def.help}\n`);
                lines.push(`# TYPE ${prometheusName} gauge\n`);
                emittedLabeledGauges.add(prometheusName);
            }
            lines.push(
                promLabeled(
                    prometheusName,
                    labels,
                    value * (def.prometheusScale ?? 1)
                )
            );
        }
        if (internalLabeledGauges.length > 0) {
            lines.push(
                '# HELP fm_internal_labeled_values Registered internal gauge values with labels and without a dedicated Prometheus metric family\n'
            );
            lines.push('# TYPE fm_internal_labeled_values gauge\n');
            for (const {name, labels, value} of internalLabeledGauges) {
                lines.push(
                    promLabeled(
                        'fm_internal_labeled_values',
                        {metric: name, labels: JSON.stringify(labels)},
                        value
                    )
                );
            }
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
