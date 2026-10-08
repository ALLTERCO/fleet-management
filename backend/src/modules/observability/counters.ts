// COUNTER_DEFS is the single source for the mirror loop here and the
// Prometheus formatter's named-counter section.

import type {
    DedicatedLabeledCounterName,
    DedicatedLabeledGaugeName
} from './exporters/prometheus';
import {
    INTERNAL_COUNTER_NAMES,
    INTERNAL_GAUGE_NAMES,
    type InternalCounterName,
    type InternalGaugeName,
    type InternalLabeledCounterName,
    type InternalLabeledGaugeName,
    reportUnregisteredMetric
} from './internalMetricRegistry';
import {liveGauge, mirrorCounter} from './processMetrics';
import {getLevel} from './samplers';
import {
    applicationEvents,
    counters,
    gauges,
    labeledCounters,
    labeledGauges
} from './state';

export interface MetricDefinition {
    prometheusName: string;
    prometheusScale?: number;
    help: string;
    type: 'counter' | 'gauge';
}

export const COUNTER_DEFS = {
    devices_connected: {
        prometheusName: 'fm_devices_connected_total',
        help: 'Total device connections since startup',
        type: 'counter'
    },
    devices_reconnected: {
        prometheusName: 'fm_devices_reconnected_total',
        help: 'Total device reconnections since startup',
        type: 'counter'
    },
    devices_disconnected: {
        prometheusName: 'fm_devices_disconnected_total',
        help: 'Total device disconnections since startup',
        type: 'counter'
    },
    ws_connections: {
        prometheusName: 'fm_ws_connections_total',
        help: 'Total WS client connections since startup',
        type: 'counter'
    },
    ws_disconnections: {
        prometheusName: 'fm_ws_disconnections_total',
        help: 'Total WS client disconnections since startup',
        type: 'counter'
    },
    ws_auth_queue_drops: {
        prometheusName: 'fm_ws_auth_queue_drops_total',
        help: 'WS messages dropped due to full auth queue',
        type: 'counter'
    },
    status_messages: {
        prometheusName: 'fm_status_messages_total',
        help: 'Total status messages received from devices',
        type: 'counter'
    },
    notify_status_malformed: {
        prometheusName: 'fm_notify_status_malformed_total',
        help: 'NotifyStatus messages dropped due to non-object params',
        type: 'counter'
    },
    status_flushes: {
        prometheusName: 'fm_status_flushes_total',
        help: 'Total status queue flushes to DB',
        type: 'counter'
    },
    status_stream_appends: {
        prometheusName: 'fm_status_stream_appends_total',
        help: 'Total status batches appended to Redis Stream',
        type: 'counter'
    },
    status_stream_append_errors: {
        prometheusName: 'fm_status_stream_append_errors_total',
        help: 'Status Redis Stream append errors',
        type: 'counter'
    },
    status_stream_degraded: {
        prometheusName: 'fm_status_stream_degraded_total',
        help: 'Status batches whose durable Redis persistence degraded',
        type: 'counter'
    },
    status_stream_trimmed_entries_total: {
        prometheusName: 'fm_status_stream_trimmed_entries_total',
        help: 'Exact live-status Redis Stream entries trimmed at its telemetry cap',
        type: 'counter'
    },
    status_stream_trim_events_total: {
        prometheusName: 'fm_status_stream_trim_events_total',
        help: 'Live-status appends that trimmed one or more oldest telemetry entries',
        type: 'counter'
    },
    status_stream_rows_drained_total: {
        prometheusName: 'fm_status_stream_rows_drained_total',
        help: 'Live-status telemetry rows successfully drained from Redis to PostgreSQL',
        type: 'counter'
    },
    status_stream_entries_deleted_total: {
        prometheusName: 'fm_status_stream_entries_deleted_total',
        help: 'Live-status stream entries removed after terminal acknowledgement',
        type: 'counter'
    },
    status_stream_fill_percent: {
        prometheusName: 'fm_status_stream_fill_percent',
        help: 'Live-status Redis Stream fill percentage against its configured cap',
        type: 'gauge'
    },
    status_stream_warning: {
        prometheusName: 'fm_status_stream_warning',
        help: 'Whether live-status Redis Stream fill is at least 70 percent',
        type: 'gauge'
    },
    status_stream_critical: {
        prometheusName: 'fm_status_stream_critical',
        help: 'Whether live-status Redis Stream fill is at least 85 percent',
        type: 'gauge'
    },
    status_stream_full: {
        prometheusName: 'fm_status_stream_full',
        help: 'Whether live-status Redis Stream is at its telemetry cap',
        type: 'gauge'
    },
    device_snapshot_stream_appends: {
        prometheusName: 'fm_device_snapshot_stream_appends_total',
        help: 'Total device snapshots appended to Redis Stream',
        type: 'counter'
    },
    device_snapshot_stream_append_errors: {
        prometheusName: 'fm_device_snapshot_stream_append_errors_total',
        help: 'Device snapshot Redis Stream append errors',
        type: 'counter'
    },
    device_snapshot_stream_degraded: {
        prometheusName: 'fm_device_snapshot_stream_degraded_total',
        help: 'Device snapshots whose durable Redis persistence degraded',
        type: 'counter'
    },
    device_snapshot_stream_saturated: {
        prometheusName: 'fm_device_snapshot_stream_saturated_total',
        help: 'Device snapshot stream saturation warnings',
        type: 'counter'
    },
    device_snapshot_stream_drained: {
        prometheusName: 'fm_device_snapshot_stream_drained_total',
        help: 'Device snapshot stream entries drained to DB',
        type: 'counter'
    },
    device_snapshot_db_batches_total: {
        prometheusName: 'fm_device_snapshot_db_batches_total',
        help: 'Successful device snapshot PostgreSQL batches',
        type: 'counter'
    },
    device_snapshot_rows_written_total: {
        prometheusName: 'fm_device_snapshot_rows_written_total',
        help: 'Latest device snapshot rows written to PostgreSQL',
        type: 'counter'
    },
    device_snapshot_entries_coalesced_total: {
        prometheusName: 'fm_device_snapshot_entries_coalesced_total',
        help: 'Older device snapshot stream entries replaced inside a PostgreSQL batch',
        type: 'counter'
    },
    device_snapshot_stream_entries_deleted_total: {
        prometheusName: 'fm_device_snapshot_stream_entries_deleted_total',
        help: 'Device snapshot stream entries removed after terminal acknowledgement',
        type: 'counter'
    },
    device_snapshot_stream_drain_errors: {
        prometheusName: 'fm_device_snapshot_stream_drain_errors_total',
        help: 'Device snapshot stream entries that failed DB drain',
        type: 'counter'
    },
    device_snapshot_stream_poison: {
        prometheusName: 'fm_device_snapshot_stream_poison_total',
        help: 'Device snapshot stream entries with invalid payloads',
        type: 'counter'
    },
    device_snapshot_stream_poison_dropped: {
        prometheusName: 'fm_device_snapshot_stream_poison_dropped_total',
        help: 'Device snapshot poison entries dropped after repeated deliveries',
        type: 'counter'
    },
    device_snapshot_stream_ack_errors: {
        prometheusName: 'fm_device_snapshot_stream_ack_errors_total',
        help: 'Device snapshot stream XACK failures',
        type: 'counter'
    },
    device_snapshot_stream_reclaimed: {
        prometheusName: 'fm_device_snapshot_stream_reclaimed_total',
        help: 'Device snapshot stream pending entries reclaimed',
        type: 'counter'
    },
    device_snapshot_stream_cycle_errors: {
        prometheusName: 'fm_device_snapshot_stream_cycle_errors_total',
        help: 'Device snapshot stream drainer cycle errors',
        type: 'counter'
    },
    device_event_stream_appends: {
        prometheusName: 'fm_device_event_stream_appends_total',
        help: 'Total device-event batches appended to Redis Stream',
        type: 'counter'
    },
    device_event_stream_append_errors: {
        prometheusName: 'fm_device_event_stream_append_errors_total',
        help: 'Device-event Redis Stream append errors',
        type: 'counter'
    },
    device_event_stream_degraded: {
        prometheusName: 'fm_device_event_stream_degraded_total',
        help: 'Device-event batches whose durable Redis persistence degraded',
        type: 'counter'
    },
    device_event_stream_saturated: {
        prometheusName: 'fm_device_event_stream_saturated_total',
        help: 'Device-event stream saturation warnings',
        type: 'counter'
    },
    device_event_stream_capacity_rejected_total: {
        prometheusName: 'fm_device_event_stream_capacity_rejected_total',
        help: 'New device-event batches rejected without trimming accepted events',
        type: 'counter'
    },
    device_event_stream_drained: {
        prometheusName: 'fm_device_event_stream_drained_total',
        help: 'Device-event stream entries drained to DB',
        type: 'counter'
    },
    device_event_stream_entries_deleted_total: {
        prometheusName: 'fm_device_event_stream_entries_deleted_total',
        help: 'Device-event stream entries removed after terminal acknowledgement',
        type: 'counter'
    },
    device_event_stream_drain_errors: {
        prometheusName: 'fm_device_event_stream_drain_errors_total',
        help: 'Device-event stream entries that failed DB drain',
        type: 'counter'
    },
    device_event_stream_poison: {
        prometheusName: 'fm_device_event_stream_poison_total',
        help: 'Device-event stream entries with invalid payloads',
        type: 'counter'
    },
    device_event_stream_poison_dropped: {
        prometheusName: 'fm_device_event_stream_poison_dropped_total',
        help: 'Device-event poison entries dropped after repeated deliveries',
        type: 'counter'
    },
    device_event_stream_ack_errors: {
        prometheusName: 'fm_device_event_stream_ack_errors_total',
        help: 'Device-event stream XACK failures',
        type: 'counter'
    },
    device_event_stream_reclaimed: {
        prometheusName: 'fm_device_event_stream_reclaimed_total',
        help: 'Device-event stream pending entries reclaimed',
        type: 'counter'
    },
    device_event_stream_cycle_errors: {
        prometheusName: 'fm_device_event_stream_cycle_errors_total',
        help: 'Device-event stream drainer cycle errors',
        type: 'counter'
    },
    device_event_rows_skipped_deleted_device_total: {
        prometheusName: 'fm_device_event_rows_skipped_deleted_device_total',
        help: 'Device-event rows not stored because their device was deleted before they drained',
        type: 'counter'
    },
    sensor_capture_stream_appends: {
        prometheusName: 'fm_sensor_capture_stream_appends_total',
        help: 'Sensor-history batches appended to Redis Stream',
        type: 'counter'
    },
    sensor_capture_stream_capacity_rejected_total: {
        prometheusName: 'fm_sensor_capture_stream_capacity_rejected_total',
        help: 'Sensor-history batches rejected without trimming accepted history',
        type: 'counter'
    },
    sensor_capture_postgres_fallback_total: {
        prometheusName: 'fm_sensor_capture_postgres_fallback_total',
        help: 'Sensor-history batches sent to PostgreSQL after Redis append failure',
        type: 'counter'
    },
    sensor_capture_postgres_fallback_succeeded_total: {
        prometheusName: 'fm_sensor_capture_postgres_fallback_succeeded_total',
        help: 'Sensor-history batches durably accepted by the PostgreSQL fallback',
        type: 'counter'
    },
    sensor_capture_durable_accept_failed_total: {
        prometheusName: 'fm_sensor_capture_durable_accept_failed_total',
        help: 'Sensor-history batches rejected by both Redis and PostgreSQL',
        type: 'counter'
    },
    sensor_capture_stream_saturated: {
        prometheusName: 'fm_sensor_capture_stream_saturated_total',
        help: 'Sensor-history stream saturation warnings',
        type: 'counter'
    },
    sensor_capture_stream_drained: {
        prometheusName: 'fm_sensor_capture_stream_drained_total',
        help: 'Sensor-history stream entries drained to PostgreSQL',
        type: 'counter'
    },
    sensor_capture_rows_accepted_total: {
        prometheusName: 'fm_sensor_capture_rows_accepted_total',
        help: 'Sensor readings durably accepted into the Redis stream',
        type: 'counter'
    },
    sensor_capture_rows_committed_total: {
        prometheusName: 'fm_sensor_capture_rows_committed_total',
        help: 'Sensor readings committed to PostgreSQL for the first time',
        type: 'counter'
    },
    sensor_capture_batches_committed_total: {
        prometheusName: 'fm_sensor_capture_batches_committed_total',
        help: 'Sensor batches newly committed to PostgreSQL',
        type: 'counter'
    },
    sensor_capture_batches_replayed_total: {
        prometheusName: 'fm_sensor_capture_batches_replayed_total',
        help: 'Already-committed sensor batches safely skipped by the PostgreSQL watermark',
        type: 'counter'
    },
    sensor_capture_drain_duration_ms_total: {
        prometheusName: 'fm_sensor_capture_drain_duration_seconds_total',
        prometheusScale: 1 / 1000,
        help: 'Total PostgreSQL sensor-batch drain time in seconds',
        type: 'counter'
    },
    sensor_capture_stream_entries_deleted_total: {
        prometheusName: 'fm_sensor_capture_stream_entries_deleted_total',
        help: 'Sensor-history stream entries removed after terminal acknowledgement',
        type: 'counter'
    },
    sensor_capture_stream_drain_errors: {
        prometheusName: 'fm_sensor_capture_stream_drain_errors_total',
        help: 'Sensor-history stream entries that failed PostgreSQL drain',
        type: 'counter'
    },
    sensor_capture_stream_poison: {
        prometheusName: 'fm_sensor_capture_stream_poison_total',
        help: 'Sensor-history stream entries with invalid payloads',
        type: 'counter'
    },
    blu_route_cache_gateway_invalidations_total: {
        prometheusName: 'fm_blu_route_cache_gateway_invalidations_total',
        help: 'BLU route-cache invalidations scoped to one gateway',
        type: 'counter'
    },
    blu_inventory_signal_gaps_total: {
        prometheusName: 'fm_blu_inventory_signal_gaps_total',
        help: 'Peer BLU inventory signals that showed a missed gateway generation',
        type: 'counter'
    },
    blu_route_cache_org_invalidations_total: {
        prometheusName: 'fm_blu_route_cache_org_invalidations_total',
        help: 'BLU route-cache invalidations that fall back to a whole organization',
        type: 'counter'
    },
    blu_route_cache_local_hits_total: {
        prometheusName: 'fm_blu_route_cache_local_hits_total',
        help: 'BLU gateway routes served by the process-local cache',
        type: 'counter'
    },
    blu_route_cache_local_misses_total: {
        prometheusName: 'fm_blu_route_cache_local_misses_total',
        help: 'BLU gateway routes absent or stale in the process-local cache',
        type: 'counter'
    },
    blu_route_cache_local_load_coalesced_total: {
        prometheusName: 'fm_blu_route_cache_local_load_coalesced_total',
        help: 'BLU local route lookups joined to an in-flight cache load',
        type: 'counter'
    },
    blu_route_cache_hits_total: {
        prometheusName: 'fm_blu_route_cache_hits_total',
        help: 'BLU gateway routes served by the shared Redis cache',
        type: 'counter'
    },
    blu_route_cache_misses_total: {
        prometheusName: 'fm_blu_route_cache_misses_total',
        help: 'BLU gateway route lookups absent from the shared Redis cache',
        type: 'counter'
    },
    blu_route_cache_invalid_total: {
        prometheusName: 'fm_blu_route_cache_invalid_total',
        help: 'BLU gateway route payloads rejected because their schema was invalid',
        type: 'counter'
    },
    blu_route_cache_errors_total: {
        prometheusName: 'fm_blu_route_cache_errors_total',
        help: 'BLU shared route-cache operations that failed',
        type: 'counter'
    },
    blu_route_cache_db_loads_total: {
        prometheusName: 'fm_blu_route_cache_db_loads_total',
        help: 'Batched PostgreSQL BLU route queries after cache misses',
        type: 'counter'
    },
    blu_route_cache_fills_total: {
        prometheusName: 'fm_blu_route_cache_fills_total',
        help: 'BLU gateway route payloads stored under a current generation fence',
        type: 'counter'
    },
    blu_route_cache_fill_races_total: {
        prometheusName: 'fm_blu_route_cache_fill_races_total',
        help: 'BLU route-cache fills rejected after a concurrent inventory change',
        type: 'counter'
    },
    virtual_projection_route_cache_hits_total: {
        prometheusName: 'fm_virtual_projection_route_cache_hits_total',
        help: 'Virtual projection source routes served by the process-local cache',
        type: 'counter'
    },
    virtual_projection_route_cache_misses_total: {
        prometheusName: 'fm_virtual_projection_route_cache_misses_total',
        help: 'Virtual projection source routes absent from the process-local cache',
        type: 'counter'
    },
    virtual_projection_route_cache_coalesced_total: {
        prometheusName: 'fm_virtual_projection_route_cache_coalesced_total',
        help: 'Virtual projection source route lookups joined to an in-flight load',
        type: 'counter'
    },
    virtual_projection_route_cache_db_loads_total: {
        prometheusName: 'fm_virtual_projection_route_cache_db_loads_total',
        help: 'PostgreSQL virtual projection route queries after cache misses',
        type: 'counter'
    },
    virtual_projection_route_cache_invalidations_total: {
        prometheusName: 'fm_virtual_projection_route_cache_invalidations_total',
        help: 'Virtual projection route-cache invalidations by organization',
        type: 'counter'
    },
    blu_telemetry_primary_accepted_total: {
        prometheusName: 'fm_blu_telemetry_primary_accepted_total',
        help: 'BLU telemetry claims accepted from configured primary gateways',
        type: 'counter'
    },
    blu_telemetry_secondary_accepted_total: {
        prometheusName: 'fm_blu_telemetry_secondary_accepted_total',
        help: 'BLU telemetry claims accepted from failover gateways',
        type: 'counter'
    },
    blu_telemetry_secondary_suppressed_total: {
        prometheusName: 'fm_blu_telemetry_secondary_suppressed_total',
        help: 'BLU telemetry claims suppressed because another gateway owns the lane',
        type: 'counter'
    },
    blu_telemetry_arbiter_errors_total: {
        prometheusName: 'fm_blu_telemetry_arbiter_errors_total',
        help: 'BLU telemetry source-arbitration failures',
        type: 'counter'
    },
    blu_telemetry_route_unmatched_total: {
        prometheusName: 'fm_blu_telemetry_route_unmatched_total',
        help: 'BLU source components without a promoted-device route',
        type: 'counter'
    },
    blu_telemetry_legacy_source_queries_total: {
        prometheusName: 'fm_blu_telemetry_legacy_source_queries_total',
        help: 'Compatibility PostgreSQL identity queries for legacy status entries',
        type: 'counter'
    },
    blu_reconcile_config_unchanged_total: {
        prometheusName: 'fm_blu_reconcile_config_unchanged_total',
        help: 'Persisted snapshots skipped because BLU configuration did not change',
        type: 'counter'
    },
    blu_promotion_noop_total: {
        prometheusName: 'fm_blu_promotion_noop_total',
        help: 'BLU promotions that changed no database state and emitted no Device.Updated event',
        type: 'counter'
    },
    audit_overflow_capacity_rejected_total: {
        prometheusName: 'fm_audit_overflow_capacity_rejected_total',
        help: 'New audit spills rejected without trimming accepted audit entries',
        type: 'counter'
    },
    audit_overflow_entries_deleted_total: {
        prometheusName: 'fm_audit_overflow_entries_deleted_total',
        help: 'Audit overflow entries removed after terminal acknowledgement',
        type: 'counter'
    },
    rpc_success: {
        prometheusName: 'fm_rpc_success_total',
        help: 'Total successful RPC calls',
        type: 'counter'
    },
    rpc_errors: {
        prometheusName: 'fm_rpc_errors_total',
        help: 'Total failed RPC calls',
        type: 'counter'
    },
    audit_entries: {
        prometheusName: 'fm_audit_entries_total',
        help: 'Total audit log entries created',
        type: 'counter'
    },
    audit_flushes: {
        prometheusName: 'fm_audit_flushes_total',
        help: 'Total audit log flushes to DB',
        type: 'counter'
    },
    events_broadcast: {
        prometheusName: 'fm_events_broadcast_total',
        help: 'Total events broadcast to listeners',
        type: 'counter'
    },
    em_syncs_completed: {
        prometheusName: 'fm_em_syncs_completed_total',
        help: 'Total EM syncs completed',
        type: 'counter'
    },
    em_syncs_failed: {
        prometheusName: 'fm_em_syncs_failed_total',
        help: 'Total EM syncs failed',
        type: 'counter'
    },
    em_sync_blocks_fetched: {
        prometheusName: 'fm_em_sync_blocks_fetched_total',
        help: 'Total emdata/em1data blocks fetched from devices',
        type: 'counter'
    },
    em_sync_catchup_batches: {
        prometheusName: 'fm_em_sync_catchup_batches_total',
        help: 'Total EM sync blocks processed inside catch-up passes',
        type: 'counter'
    },
    em_sync_buffer_enqueued: {
        prometheusName: 'fm_em_sync_buffer_enqueued_total',
        help: 'Total EM sync blocks enqueued to Redis Stream',
        type: 'counter'
    },
    em_sync_buffer_enqueue_errors: {
        prometheusName: 'fm_em_sync_buffer_enqueue_errors_total',
        help: 'EM sync Redis Stream enqueue errors',
        type: 'counter'
    },
    em_sync_buffer_capacity_rejected: {
        prometheusName: 'fm_em_sync_buffer_capacity_rejected_total',
        help: 'EM pushes refused whole by the push buffer byte budget or entry cap',
        type: 'counter'
    },
    em_sync_buffer_invalid_cursors: {
        prometheusName: 'fm_em_sync_buffer_invalid_cursors_total',
        help: 'EM sync blocks rejected before enqueue because their cursor was invalid',
        type: 'counter'
    },
    em_sync_pull_rows_written: {
        prometheusName: 'fm_em_sync_pull_rows_written_total',
        help: 'EM raw rows written to DB straight from history pulls',
        type: 'counter'
    },
    em_sync_pull_write_failures: {
        prometheusName: 'fm_em_sync_pull_write_failures_total',
        help: 'EM history pull pages not stored; the pass stops and the page is pulled again',
        type: 'counter'
    },
    em_sync_buffer_pressure_probe_errors: {
        prometheusName: 'fm_em_sync_buffer_pressure_probe_errors_total',
        help: 'Failures while checking EM sync stream pressure',
        type: 'counter'
    },
    em_sync_buffer_saturated: {
        prometheusName: 'fm_em_sync_buffer_saturated_total',
        help: 'EM push buffer warnings at the pull pause byte mark',
        type: 'counter'
    },
    em_sync_buffer_drained: {
        prometheusName: 'fm_em_sync_buffer_drained_total',
        help: 'EM sync stream entries drained to DB',
        type: 'counter'
    },
    em_sync_buffer_entries_deleted_total: {
        prometheusName: 'fm_em_sync_buffer_entries_deleted_total',
        help: 'EM sync stream entries removed after successful DB persistence and acknowledgement',
        type: 'counter'
    },
    em_sync_buffer_rows_written: {
        prometheusName: 'fm_em_sync_buffer_rows_written_total',
        help: 'EM sync raw rows written to DB from the Redis drainer',
        type: 'counter'
    },
    em_raw_ingest_batch_size: {
        prometheusName: 'fm_em_raw_ingest_batch_size',
        help: 'Rows in the latest EM raw database write',
        type: 'gauge'
    },
    em_raw_ingest_rows_per_second: {
        prometheusName: 'fm_em_raw_ingest_rows_per_second',
        help: 'Rows per second in the latest EM raw database write',
        type: 'gauge'
    },
    em_stats_write_last_ms: {
        prometheusName: 'fm_em_stats_write_last_seconds',
        prometheusScale: 1 / 1000,
        help: 'Duration of the latest EM raw database write in seconds',
        type: 'gauge'
    },
    em_stats_write_slow: {
        prometheusName: 'fm_em_stats_write_slow_total',
        help: 'EM raw database writes above the slow threshold',
        type: 'counter'
    },
    em_sync_last_write_rows: {
        prometheusName: 'fm_em_sync_last_write_rows',
        help: 'Rows in the latest EM sync database write',
        type: 'gauge'
    },
    em_sync_last_write_ms: {
        prometheusName: 'fm_em_sync_last_write_seconds',
        prometheusScale: 1 / 1000,
        help: 'Duration of the latest EM sync database write in seconds',
        type: 'gauge'
    },
    em_sync_last_write_rows_per_sec: {
        prometheusName: 'fm_em_sync_last_write_rows_per_second',
        help: 'Rows per second in the latest EM sync database write',
        type: 'gauge'
    },
    em_sync_buffer_depth: {
        prometheusName: 'fm_em_sync_buffer_depth',
        help: 'Current EM sync Redis stream depth',
        type: 'gauge'
    },
    em_sync_buffer_bytes: {
        prometheusName: 'fm_em_sync_buffer_bytes',
        help: 'Bytes the EM push buffer accounts for: entries plus shared key lists',
        type: 'gauge'
    },
    em_rollup_batches_total: {
        prometheusName: 'fm_em_rollup_batches_total',
        help: 'Completed EM rollup batches',
        type: 'counter'
    },
    em_rollup_failures_total: {
        prometheusName: 'fm_em_rollup_failures_total',
        help: 'Failed EM rollup batches',
        type: 'counter'
    },
    em_rollup_health_failures_total: {
        prometheusName: 'fm_em_rollup_health_failures_total',
        help: 'Failed or invalid EM rollup backlog reads',
        type: 'counter'
    },
    em_rollup_blocked_total: {
        prometheusName: 'fm_em_rollup_blocked_total',
        help: 'Rollup keys held pending sufficient consistent source readings',
        type: 'counter'
    },
    em_rollup_health_valid: {
        prometheusName: 'fm_em_rollup_health_valid',
        help: 'Whether the latest EM rollup backlog read succeeded',
        type: 'gauge'
    },
    em_rollup_health_last_success_timestamp_seconds: {
        prometheusName: 'fm_em_rollup_health_last_success_timestamp_seconds',
        help: 'Unix timestamp of the last valid EM rollup backlog read',
        type: 'gauge'
    },
    em_rollup_last_progress_timestamp_seconds: {
        prometheusName: 'fm_em_rollup_last_progress_timestamp_seconds',
        help: 'Unix timestamp of the last EM rollup batch completing work',
        type: 'gauge'
    },
    em_rollup_dirty_buckets: {
        prometheusName: 'fm_em_rollup_dirty_buckets',
        help: 'Estimated EM rollup buckets waiting for recomputation',
        type: 'gauge'
    },
    em_rollup_oldest_dirty_age_seconds: {
        prometheusName: 'fm_em_rollup_oldest_dirty_age_seconds',
        help: 'Age since first marked of the oldest due EM rollup key (scheduled and held keys excluded)',
        type: 'gauge'
    },
    em_rollup_ready_buckets: {
        prometheusName: 'fm_em_rollup_ready_buckets',
        help: 'Estimated EM rollup buckets ready for recomputation (held and abandoned excluded)',
        type: 'gauge'
    },
    em_rollup_ready_oldest_age_seconds: {
        prometheusName: 'fm_em_rollup_ready_oldest_age_seconds',
        help: 'Seconds the oldest due EM rollup bucket has waited since it became due',
        type: 'gauge'
    },
    em_rollup_scheduled_buckets: {
        prometheusName: 'fm_em_rollup_scheduled_buckets',
        help: 'EM rollup buckets waiting for their bucket to close or their late debounce, not yet due',
        type: 'gauge'
    },
    em_rollup_batch_duration_seconds: {
        prometheusName: 'fm_em_rollup_batch_duration_seconds',
        help: 'Duration of the latest EM rollup batch',
        type: 'gauge'
    },
    em_rollup_buckets_per_second: {
        prometheusName: 'fm_em_rollup_buckets_per_second',
        help: 'Buckets per second in the latest EM rollup batch',
        type: 'gauge'
    },
    em_rollup_last_success_timestamp_seconds: {
        prometheusName: 'fm_em_rollup_last_success_timestamp_seconds',
        help: 'Unix timestamp of the last successful EM rollup batch',
        type: 'gauge'
    },
    em_sync_last_success_timestamp_seconds: {
        prometheusName: 'fm_em_sync_last_success_timestamp_seconds',
        help: 'Unix timestamp of the last successful atomic EM database write',
        type: 'gauge'
    },
    em_sync_due_catchup: {
        prometheusName: 'fm_em_sync_due_catchup',
        help: 'EM devices currently due for historical catch-up',
        type: 'gauge'
    },
    em_sync_active_catchup: {
        prometheusName: 'fm_em_sync_active_catchup',
        help: 'Historical EM catch-up syncs currently running',
        type: 'gauge'
    },
    em_sync_active_channels: {
        prometheusName: 'fm_em_sync_active_channels',
        help: 'EM channels currently syncing',
        type: 'gauge'
    },
    em_sync_oldest_unpicked_wait_seconds: {
        prometheusName: 'fm_em_sync_oldest_unpicked_wait_seconds',
        help: 'Longest wait among due EM devices that have not received a sync slot',
        type: 'gauge'
    },
    em_sync_starvation_suspected: {
        prometheusName: 'fm_em_sync_starvation_suspected',
        help: 'Whether the EM scheduler suspects sync starvation',
        type: 'gauge'
    },
    redis_used_memory_bytes: {
        prometheusName: 'fm_redis_used_memory_bytes',
        help: 'Redis memory currently in use',
        type: 'gauge'
    },
    redis_maxmemory_bytes: {
        prometheusName: 'fm_redis_maxmemory_bytes',
        help: 'Redis configured memory limit',
        type: 'gauge'
    },
    redis_mem_fragmentation_ratio: {
        prometheusName: 'fm_redis_mem_fragmentation_ratio',
        help: 'Redis memory fragmentation ratio',
        type: 'gauge'
    },
    redis_evicted_keys: {
        prometheusName: 'fm_redis_evicted_keys',
        help: 'Redis keys evicted since Redis started',
        type: 'gauge'
    },
    redis_last_success_timestamp_seconds: {
        prometheusName: 'fm_redis_last_success_timestamp_seconds',
        help: 'Unix timestamp of the last successful Redis runtime probe',
        type: 'gauge'
    },
    report_jobs_queued: {
        prometheusName: 'fm_report_jobs_queued',
        help: 'Durable report export jobs waiting for a worker',
        type: 'gauge'
    },
    report_jobs_processing: {
        prometheusName: 'fm_report_jobs_processing',
        help: 'Durable report export jobs currently processing',
        type: 'gauge'
    },
    report_oldest_queued_age_seconds: {
        prometheusName: 'fm_report_oldest_queued_age_seconds',
        help: 'Age of the oldest queued report export',
        type: 'gauge'
    },
    report_worker_capacity_available: {
        prometheusName: 'fm_report_worker_capacity_available',
        help: 'Configured durable worker slots not occupied in the shared pool',
        type: 'gauge'
    },
    report_worker_saturated: {
        prometheusName: 'fm_report_worker_saturated',
        help: 'Whether queued reports are blocked by a full shared worker pool',
        type: 'gauge'
    },
    notification_delivery_jobs_queued: {
        prometheusName: 'fm_notification_delivery_jobs_queued',
        help: 'Notification delivery jobs waiting for a worker',
        type: 'gauge'
    },
    notification_delivery_jobs_processing: {
        prometheusName: 'fm_notification_delivery_jobs_processing',
        help: 'Notification delivery jobs currently processing',
        type: 'gauge'
    },
    notification_delivery_jobs_dead_letter: {
        prometheusName: 'fm_notification_delivery_jobs_dead_letter',
        help: 'Notification delivery jobs in the dead-letter state',
        type: 'gauge'
    },
    notification_delivery_jobs_failed_legacy: {
        prometheusName: 'fm_notification_delivery_jobs_failed_legacy',
        help: 'Legacy notification delivery records in the failed state',
        type: 'gauge'
    },
    notification_delivery_oldest_queued_age_ms: {
        prometheusName: 'fm_notification_delivery_oldest_queued_age_seconds',
        prometheusScale: 1 / 1000,
        help: 'Age of the oldest queued notification delivery job in seconds',
        type: 'gauge'
    },
    notification_delivery_attempts_15m: {
        prometheusName: 'fm_notification_delivery_attempts_15m',
        help: 'Notification delivery attempts during the last 15 minutes',
        type: 'gauge'
    },
    notification_delivery_failed_attempts_15m: {
        prometheusName: 'fm_notification_delivery_failed_attempts_15m',
        help: 'Failed notification delivery attempts during the last 15 minutes',
        type: 'gauge'
    },
    notification_delivery_terminal_latency_avg_ms: {
        prometheusName: 'fm_notification_delivery_terminal_latency_avg_seconds',
        prometheusScale: 1 / 1000,
        help: 'Average terminal notification delivery latency in seconds',
        type: 'gauge'
    },
    notification_delivery_disabled_endpoints: {
        prometheusName: 'fm_notification_delivery_disabled_endpoints',
        help: 'Notification delivery endpoints currently disabled',
        type: 'gauge'
    },
    notification_delivery_auto_disabled_endpoints: {
        prometheusName: 'fm_notification_delivery_auto_disabled_endpoints',
        help: 'Notification delivery endpoints disabled automatically',
        type: 'gauge'
    },
    report_queue_metrics_refresh_errors: {
        prometheusName: 'fm_report_queue_metrics_refresh_errors_total',
        help: 'Failures while refreshing durable report queue metrics',
        type: 'counter'
    },
    report_pdf_renders_active: {
        prometheusName: 'fm_report_pdf_renders_active',
        help: 'Formatted PDF renders currently active in this process',
        type: 'gauge'
    },
    report_pdf_last_render_duration_ms: {
        prometheusName: 'fm_report_pdf_last_render_duration_seconds',
        prometheusScale: 1 / 1000,
        help: 'Duration of the latest formatted PDF render in seconds',
        type: 'gauge'
    },
    report_pdf_last_complex_rows: {
        prometheusName: 'fm_report_pdf_last_complex_rows',
        help: 'Complex-script rows in the latest formatted PDF render',
        type: 'gauge'
    },
    report_pdf_render_duration_ms_total: {
        prometheusName: 'fm_report_pdf_render_duration_seconds_total',
        prometheusScale: 1 / 1000,
        help: 'Cumulative formatted PDF render time in seconds',
        type: 'counter'
    },
    report_pdf_render_samples_total: {
        prometheusName: 'fm_report_pdf_render_samples_total',
        help: 'Completed formatted PDF render observations',
        type: 'counter'
    },
    report_pdf_render_budget_exceeded_total: {
        prometheusName: 'fm_report_pdf_render_budget_exceeded_total',
        help: 'Formatted PDF renders exceeding the configured time budget',
        type: 'counter'
    },
    report_pdf_render_failures_total: {
        prometheusName: 'fm_report_pdf_render_failures_total',
        help: 'Formatted PDF renders that failed before publication',
        type: 'counter'
    },
    report_pdf_complex_documents_total: {
        prometheusName: 'fm_report_pdf_complex_documents_total',
        help: 'Formatted PDFs containing at least one complex-script row',
        type: 'counter'
    },
    report_pdf_complex_rows_total: {
        prometheusName: 'fm_report_pdf_complex_rows_total',
        help: 'Complex-script rows rendered into formatted PDFs',
        type: 'counter'
    },
    report_performance_persist_errors: {
        prometheusName: 'fm_report_performance_persist_errors_total',
        help: 'Failures while persisting report performance observations',
        type: 'counter'
    },
    em_report_waiting_for_rollup: {
        prometheusName: 'fm_em_report_waiting_for_rollup_total',
        help: 'Reports that found unfinished EM rollups',
        type: 'counter'
    },
    em_report_rollup_timeout: {
        prometheusName: 'fm_em_report_rollup_timeout_total',
        help: 'Reports rejected because EM rollups remained unfinished',
        type: 'counter'
    },
    em_sync_buffer_drain_errors: {
        prometheusName: 'fm_em_sync_buffer_drain_errors_total',
        help: 'EM sync stream entries that failed DB drain',
        type: 'counter'
    },
    em_sync_values_out_of_range: {
        prometheusName: 'fm_em_sync_values_out_of_range_total',
        help: 'EM sync readings dropped because the value cannot be stored',
        type: 'counter'
    },
    em_sync_blocks_rejected: {
        prometheusName: 'fm_em_sync_blocks_rejected_total',
        help: 'EM sync blocks PostgreSQL rejected and kept in device_em.sync_rejected',
        type: 'counter'
    },
    em_sync_buffer_poison: {
        prometheusName: 'fm_em_sync_buffer_poison_total',
        help: 'EM sync stream entries with invalid payloads',
        type: 'counter'
    },
    em_sync_buffer_poison_dropped: {
        prometheusName: 'fm_em_sync_buffer_poison_dropped_total',
        help: 'EM sync poison entries dropped after repeated deliveries',
        type: 'counter'
    },
    em_sync_buffer_ack_errors: {
        prometheusName: 'fm_em_sync_buffer_ack_errors_total',
        help: 'EM sync stream XACK failures',
        type: 'counter'
    },
    em_sync_buffer_reclaimed: {
        prometheusName: 'fm_em_sync_buffer_reclaimed_total',
        help: 'EM sync stream pending entries reclaimed',
        type: 'counter'
    },
    em_sync_buffer_cycle_errors: {
        prometheusName: 'fm_em_sync_buffer_cycle_errors_total',
        help: 'EM sync drainer cycle errors',
        type: 'counter'
    },
    alert_sweep_budget_exhausted: {
        prometheusName: 'fm_alert_sweep_budget_exhausted_total',
        help: 'Alert sweep ticks that stopped scheduling at their time budget',
        type: 'counter'
    },
    alert_sweep_queue_size: {
        prometheusName: 'fm_alert_sweep_queue_size',
        help: 'Alert evaluations waiting in the current bounded sweep',
        type: 'gauge'
    },
    alert_sweep_active: {
        prometheusName: 'fm_alert_sweep_active',
        help: 'Alert evaluations currently running',
        type: 'gauge'
    },
    alert_transition_state_cache_hits_total: {
        prometheusName: 'fm_alert_transition_state_cache_hits_total',
        help: 'Alert clear decisions served by known process-local instance state',
        type: 'counter'
    },
    alert_transition_state_cache_misses_total: {
        prometheusName: 'fm_alert_transition_state_cache_misses_total',
        help: 'Alert clear decisions without known process-local instance state',
        type: 'counter'
    },
    alert_transition_state_db_loads_total: {
        prometheusName: 'fm_alert_transition_state_db_loads_total',
        help: 'Authoritative open-alert reads used to warm transition state',
        type: 'counter'
    },
    alert_resolution_normal_transition_suppressed_total: {
        prometheusName:
            'fm_alert_resolution_normal_transition_suppressed_total',
        help: 'Normal-to-normal alert clears suppressed before the resolve function',
        type: 'counter'
    },
    alert_resolution_calls_total: {
        prometheusName: 'fm_alert_resolution_calls_total',
        help: 'Calls to the atomic alert auto-resolve database function',
        type: 'counter'
    },
    alert_resolution_transitions_total: {
        prometheusName: 'fm_alert_resolution_transitions_total',
        help: 'Alert auto-resolve calls that changed an open instance',
        type: 'counter'
    },
    mdns_discovered: {
        prometheusName: 'fm_mdns_discovered_total',
        help: 'Total mDNS discovery events',
        type: 'counter'
    },
    device_ingress_cleanup_rows_total: {
        prometheusName: 'fm_device_ingress_cleanup_rows_total',
        help: 'Device ingress retention rows removed by the cleanup worker',
        type: 'counter'
    },
    device_ingress_handshake_duration_ms: {
        prometheusName: 'fm_device_ingress_handshake_duration_seconds',
        prometheusScale: 1 / 1000,
        help: 'Duration of the latest device ingress handshake in seconds',
        type: 'gauge'
    },
    device_ingress_message_rate_limited_total: {
        prometheusName: 'fm_device_ingress_message_rate_limited_total',
        help: 'Device ingress messages rejected by the rate limiter',
        type: 'counter'
    },
    device_ingress_cap_would_refuse_total: {
        prometheusName: 'fm_device_ingress_cap_would_refuse_total',
        help: 'Device admissions a connection cap would have refused in record_only mode',
        type: 'counter'
    },
    device_ingress_proxy_untrusted_total: {
        prometheusName: 'fm_device_ingress_proxy_untrusted_total',
        help: 'Device sockets whose forwarded headers were ignored because the peer is not a trusted proxy',
        type: 'counter'
    },
    device_ingress_waiting_room_open: {
        prometheusName: 'fm_device_ingress_waiting_room_open',
        help: 'Current open device ingress waiting-room entries',
        type: 'gauge'
    },
    device_inits_started: {
        prometheusName: 'fm_device_inits_started_total',
        help: 'Total device initializations started',
        type: 'counter'
    },
    device_inits_completed: {
        prometheusName: 'fm_device_inits_completed_total',
        help: 'Total device initializations completed',
        type: 'counter'
    },
    device_inits_failed: {
        prometheusName: 'fm_device_inits_failed_total',
        help: 'Total device initializations failed',
        type: 'counter'
    },
    waiting_room_approved: {
        prometheusName: 'fm_waiting_room_approved_total',
        help: 'Total devices approved from waiting room',
        type: 'counter'
    },
    waiting_room_denied: {
        prometheusName: 'fm_waiting_room_denied_total',
        help: 'Total devices denied from waiting room',
        type: 'counter'
    },
    auth_successes: {
        prometheusName: 'fm_auth_successes_total',
        help: 'Total successful authentications',
        type: 'counter'
    },
    auth_failures: {
        prometheusName: 'fm_auth_failures_total',
        help: 'Total failed authentications',
        type: 'counter'
    },
    auth_cache_hits: {
        prometheusName: 'fm_auth_cache_hits_total',
        help: 'Userinfo cache hits',
        type: 'counter'
    },
    auth_cache_misses: {
        prometheusName: 'fm_auth_cache_misses_total',
        help: 'Userinfo cache misses (Zitadel fetch)',
        type: 'counter'
    },
    auth_user_cache_hits: {
        prometheusName: 'fm_auth_user_cache_hits_total',
        help: 'Authenticated-user token cache hits',
        type: 'counter'
    },
    auth_userinfo_cache_hits: {
        prometheusName: 'fm_auth_userinfo_cache_hits_total',
        help: 'Zitadel userinfo cache hits',
        type: 'counter'
    },
    auth_userinfo_cache_misses: {
        prometheusName: 'fm_auth_userinfo_cache_misses_total',
        help: 'Zitadel userinfo cache misses',
        type: 'counter'
    },
    auth_cached_rejects: {
        prometheusName: 'fm_auth_cached_rejects_total',
        help: 'Tokens rejected from the negative authentication cache',
        type: 'counter'
    },
    auth_transient_errors: {
        prometheusName: 'fm_auth_transient_errors_total',
        help: 'Authentication failures caused by transient upstream or resolution errors',
        type: 'counter'
    },
    auth_inflight: {
        prometheusName: 'fm_auth_inflight',
        help: 'External authentications currently in progress',
        type: 'gauge'
    },
    scoped_pat_rejected: {
        prometheusName: 'fm_scoped_pat_rejected_total',
        help: 'Rejected Fleet Manager scoped PAT authentications',
        type: 'counter'
    },
    status_flush_errors: {
        prometheusName: 'fm_status_flush_errors_total',
        help: 'Status queue flush errors',
        type: 'counter'
    },
    em_stats_overflow_spilled: {
        prometheusName: 'fm_em_stats_overflow_spilled_total',
        help: 'Live em_stats batches moved to the Redis overflow stream',
        type: 'counter'
    },
    em_stats_overflow_spill_errors: {
        prometheusName: 'fm_em_stats_overflow_spill_errors_total',
        help: 'Live em_stats spills the Redis overflow stream refused',
        type: 'counter'
    },
    em_stats_overflow_poison: {
        prometheusName: 'fm_em_stats_overflow_poison_total',
        help: 'em_stats overflow entries with invalid payloads',
        type: 'counter'
    },
    em_stats_overflow_poison_dropped: {
        prometheusName: 'fm_em_stats_overflow_poison_dropped_total',
        help: 'em_stats overflow entries dropped after repeated deliveries',
        type: 'counter'
    },
    em_stats_overflow_drained: {
        prometheusName: 'fm_em_stats_overflow_drained_total',
        help: 'em_stats overflow entries written to PostgreSQL',
        type: 'counter'
    },
    em_stats_overflow_drain_errors: {
        prometheusName: 'fm_em_stats_overflow_drain_errors_total',
        help: 'em_stats overflow entries whose PostgreSQL write failed',
        type: 'counter'
    },
    em_stats_overflow_ack_errors: {
        prometheusName: 'fm_em_stats_overflow_ack_errors_total',
        help: 'em_stats overflow stream XACK failures',
        type: 'counter'
    },
    em_stats_overflow_reclaimed: {
        prometheusName: 'fm_em_stats_overflow_reclaimed_total',
        help: 'em_stats overflow entries reclaimed from a dead consumer',
        type: 'counter'
    },
    em_stats_overflow_cycle_errors: {
        prometheusName: 'fm_em_stats_overflow_cycle_errors_total',
        help: 'em_stats overflow drain cycles that failed',
        type: 'counter'
    },
    em_stats_overflow_entries_deleted_total: {
        prometheusName: 'fm_em_stats_overflow_entries_deleted_total',
        help: 'em_stats overflow entries removed after acknowledgement',
        type: 'counter'
    },
    em_stats_flushes: {
        prometheusName: 'fm_em_stats_flushes_total',
        help: 'EM stats queue flushes to DB',
        type: 'counter'
    },
    em_stats_flush_errors: {
        prometheusName: 'fm_em_stats_flush_errors_total',
        help: 'EM stats queue flush errors',
        type: 'counter'
    },
    audit_write_errors: {
        prometheusName: 'fm_audit_write_errors_total',
        help: 'Audit log write errors',
        type: 'counter'
    },
    authz_audit_write_failures: {
        prometheusName: 'fm_authz_audit_write_failures_total',
        help: 'Authz audit entries dropped after a swallowed DB write failure',
        type: 'counter'
    },
    plugin_worker_errors: {
        prometheusName: 'fm_plugin_worker_errors_total',
        help: 'Plugin worker errors',
        type: 'counter'
    },
    plugin_worker_crashes: {
        prometheusName: 'fm_plugin_worker_crashes_total',
        help: 'Plugin worker non-zero exits',
        type: 'counter'
    },
    device_persists: {
        prometheusName: 'fm_device_persists_total',
        help: 'Device state persist operations (5s debounced)',
        type: 'counter'
    },
    events_filtered: {
        prometheusName: 'fm_events_filtered_total',
        help: 'Events dropped by subscription deny/allow filters',
        type: 'counter'
    },
    events_permission_denied: {
        prometheusName: 'fm_events_permission_denied_total',
        help: 'Events dropped due to device access denial',
        type: 'counter'
    },
    status_flushes_skipped: {
        prometheusName: 'fm_status_flushes_skipped_total',
        help: 'Status flushes skipped (DB writes disabled)',
        type: 'counter'
    },
    em_stats_flushes_skipped: {
        prometheusName: 'fm_em_stats_flushes_skipped_total',
        help: 'EM stats flushes skipped (DB writes disabled)',
        type: 'counter'
    },
    em_sync_writes_skipped: {
        prometheusName: 'fm_em_sync_writes_skipped_total',
        help: 'EM sync DB writes skipped (DB writes disabled)',
        type: 'counter'
    },
    audit_flushes_skipped: {
        prometheusName: 'fm_audit_flushes_skipped_total',
        help: 'Audit flushes skipped (DB writes disabled)',
        type: 'counter'
    },
    device_persists_skipped: {
        prometheusName: 'fm_device_persists_skipped_total',
        help: 'Device persists skipped (DB writes disabled)',
        type: 'counter'
    },
    fleet_summary_energy_failures: {
        prometheusName: 'fm_fleet_summary_energy_failures_total',
        help: 'Per-device daily-energy lookups that failed during fleet summary',
        type: 'counter'
    },
    fleet_metrics_device_failures: {
        prometheusName: 'fm_fleet_metrics_device_failures_total',
        help: 'Devices skipped during fleet live-metric aggregation due to errors',
        type: 'counter'
    },
    ws_live_loop_send_errors: {
        prometheusName: 'fm_ws_live_loop_send_errors_total',
        help: 'WS session live-loop sendBatchAndAck non-socket faults',
        type: 'counter'
    },
    device_inits_queue_dropped: {
        prometheusName: 'fm_device_inits_queue_dropped_total',
        help: 'Device inits refused because the init queue was over its high-water mark (init_queue_full)',
        type: 'counter'
    },
    device_inits_cooldown_rejected: {
        prometheusName: 'fm_device_inits_cooldown_rejected_total',
        help: 'Device inits rejected while the device was in init-failure cooldown',
        type: 'counter'
    },
    cluster_inits_full: {
        prometheusName: 'fm_cluster_inits_full_total',
        help: 'Device inits rejected because the cluster-wide init slot cap was full',
        type: 'counter'
    },
    waiting_room_reconnect_limited: {
        prometheusName: 'fm_waiting_room_reconnect_limited_total',
        help: 'Reconnect attempts throttled by the waiting-room reconnect limiter (backoff)',
        type: 'counter'
    },
    waiting_room_stored_admit_failed: {
        prometheusName: 'fm_waiting_room_stored_admit_failed_total',
        help: 'Stored-approval admits that failed (e.g. init gate full) and backed off instead of looping',
        type: 'counter'
    },
    device_builds_total: {
        prometheusName: 'fm_device_builds_total',
        help: 'Devices built (probed + composed) after admission',
        type: 'counter'
    },
    device_builds_slow: {
        prometheusName: 'fm_device_builds_slow_total',
        help: 'Device builds that ran slower than the slow-build threshold',
        type: 'counter'
    },
    contained_faults: {
        prometheusName: 'fm_contained_faults_total',
        help: 'Unexpected faults in our code, contained instead of crashing (alert if > 0)',
        type: 'counter'
    },
    peer_errors: {
        prometheusName: 'fm_peer_errors_total',
        help: 'Expected peer/network errors handled gracefully (resets, disconnects, bad frames)',
        type: 'counter'
    },
    process_uncaught_exception_total: {
        prometheusName: 'fm_process_uncaught_exception_total',
        help: 'Uncaught exceptions reaching the process-level handler',
        type: 'counter'
    },
    process_unhandled_rejection_total: {
        prometheusName: 'fm_process_unhandled_rejection_total',
        help: 'Unhandled promise rejections reaching the process-level handler',
        type: 'counter'
    },
    device_gui_revocation_subscribe_errors: {
        prometheusName: 'fm_device_gui_revocation_subscribe_errors_total',
        help: 'Failed subscriptions to device GUI session revocations; retried in the background',
        type: 'counter'
    }
} satisfies Record<string, MetricDefinition>;

type DedicatedCounterName = {
    [Name in keyof typeof COUNTER_DEFS]: (typeof COUNTER_DEFS)[Name]['type'] extends 'counter'
        ? Name
        : never;
}[keyof typeof COUNTER_DEFS];

type DedicatedGaugeName = {
    [Name in keyof typeof COUNTER_DEFS]: (typeof COUNTER_DEFS)[Name]['type'] extends 'gauge'
        ? Name
        : never;
}[keyof typeof COUNTER_DEFS];

export type CounterName = DedicatedCounterName | InternalCounterName;
export type GaugeName = DedicatedGaugeName | InternalGaugeName;
export type LabeledCounterName =
    | DedicatedLabeledCounterName
    | InternalLabeledCounterName;
export type LabeledGaugeName =
    | DedicatedLabeledGaugeName
    | InternalLabeledGaugeName;

const METRIC_DEFINITIONS: Readonly<Record<string, MetricDefinition>> =
    COUNTER_DEFS;

function prometheusScale(definition: MetricDefinition): number {
    return definition.prometheusScale ?? 1;
}

for (const [name, def] of Object.entries(COUNTER_DEFS)) {
    const read = () =>
        (def.type === 'gauge'
            ? (gauges.get(name) ?? 0)
            : (counters.get(name) ?? 0)) * prometheusScale(def);
    if (def.type === 'gauge') liveGauge(def.prometheusName, def.help, read);
    else mirrorCounter(def.prometheusName, def.help, read);
}

function sortLabels(labels: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(labels).sort(([a], [b]) => a.localeCompare(b))
    );
}

function labelKey(name: string, labels: Record<string, string>): string {
    return JSON.stringify({name, labels});
}

export function incrementCounter(name: CounterName, delta = 1): void {
    if (getLevel() < 2) return;
    if (!(name in METRIC_DEFINITIONS) && !INTERNAL_COUNTER_NAMES.has(name)) {
        reportUnregisteredMetric('counter', name);
        return;
    }
    counters.set(name, (counters.get(name) ?? 0) + delta);
}

export function incrementApplicationEvent(name: string, delta = 1): void {
    if (getLevel() < 2) return;
    applicationEvents.set(name, (applicationEvents.get(name) ?? 0) + delta);
}

export function getCounter(name: CounterName): number {
    return counters.get(name) ?? 0;
}

export function incrementLabeledCounter(
    name: LabeledCounterName,
    labels: Record<string, string>,
    delta = 1
): void {
    if (getLevel() < 2) return;
    const sortedLabels = sortLabels(labels);
    const key = labelKey(name, sortedLabels);
    const current = labeledCounters.get(key);
    labeledCounters.set(key, {
        name,
        labels: sortedLabels,
        value: (current?.value ?? 0) + delta
    });
}

export function getLabeledCounter(
    name: LabeledCounterName,
    labels: Record<string, string>
): number {
    const key = labelKey(name, sortLabels(labels));
    return labeledCounters.get(key)?.value ?? 0;
}

export function getLabeledGauge(
    name: LabeledGaugeName,
    labels: Record<string, string>
): number {
    const key = labelKey(name, sortLabels(labels));
    return labeledGauges.get(key)?.value ?? 0;
}

export function getGauge(name: GaugeName): number {
    return gauges.get(name) ?? 0;
}

export function setGauge(name: GaugeName, value: number): void {
    if (getLevel() < 1) return;
    if (
        METRIC_DEFINITIONS[name]?.type !== 'gauge' &&
        !INTERNAL_GAUGE_NAMES.has(name)
    ) {
        reportUnregisteredMetric('gauge', name);
        return;
    }
    gauges.set(name, value);
}

export function setLabeledGauge(
    name: LabeledGaugeName,
    labels: Record<string, string>,
    value: number
): void {
    if (getLevel() < 1) return;
    const sortedLabels = sortLabels(labels);
    labeledGauges.set(labelKey(name, sortedLabels), {
        name,
        labels: sortedLabels,
        value
    });
}
