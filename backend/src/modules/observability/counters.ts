// COUNTER_DEFS is the single source for the mirror loop here and the
// Prometheus formatter's named-counter section.
import {liveGauge, mirrorCounter} from './processMetrics';
import {getLevel} from './samplers';
import {counters, gauges, labeledCounters, labeledGauges} from './state';

export const COUNTER_DEFS: Record<
    string,
    {help: string; type: 'counter' | 'gauge'}
> = {
    devices_connected: {
        help: 'Total device connections since startup',
        type: 'counter'
    },
    devices_reconnected: {
        help: 'Total device reconnections since startup',
        type: 'counter'
    },
    devices_disconnected: {
        help: 'Total device disconnections since startup',
        type: 'counter'
    },
    ws_connections: {
        help: 'Total WS client connections since startup',
        type: 'counter'
    },
    ws_disconnections: {
        help: 'Total WS client disconnections since startup',
        type: 'counter'
    },
    ws_auth_queue_drops: {
        help: 'WS messages dropped due to full auth queue',
        type: 'counter'
    },
    status_messages: {
        help: 'Total status messages received from devices',
        type: 'counter'
    },
    notify_status_malformed: {
        help: 'NotifyStatus messages dropped due to non-object params',
        type: 'counter'
    },
    status_flushes: {
        help: 'Total status queue flushes to DB',
        type: 'counter'
    },
    status_stream_appends: {
        help: 'Total status batches appended to Redis Stream',
        type: 'counter'
    },
    status_stream_append_errors: {
        help: 'Status Redis Stream append errors',
        type: 'counter'
    },
    status_stream_degraded: {
        help: 'Status batches whose durable Redis persistence degraded',
        type: 'counter'
    },
    device_snapshot_stream_appends: {
        help: 'Total device snapshots appended to Redis Stream',
        type: 'counter'
    },
    device_snapshot_stream_append_errors: {
        help: 'Device snapshot Redis Stream append errors',
        type: 'counter'
    },
    device_snapshot_stream_degraded: {
        help: 'Device snapshots whose durable Redis persistence degraded',
        type: 'counter'
    },
    device_snapshot_stream_saturated: {
        help: 'Device snapshot stream saturation warnings',
        type: 'counter'
    },
    device_snapshot_stream_drained: {
        help: 'Device snapshot stream entries drained to DB',
        type: 'counter'
    },
    device_snapshot_stream_drain_errors: {
        help: 'Device snapshot stream entries that failed DB drain',
        type: 'counter'
    },
    device_snapshot_stream_poison: {
        help: 'Device snapshot stream entries with invalid payloads',
        type: 'counter'
    },
    device_snapshot_stream_poison_dropped: {
        help: 'Device snapshot poison entries dropped after repeated deliveries',
        type: 'counter'
    },
    device_snapshot_stream_ack_errors: {
        help: 'Device snapshot stream XACK failures',
        type: 'counter'
    },
    device_snapshot_stream_reclaimed: {
        help: 'Device snapshot stream pending entries reclaimed',
        type: 'counter'
    },
    device_snapshot_stream_cycle_errors: {
        help: 'Device snapshot stream drainer cycle errors',
        type: 'counter'
    },
    device_event_stream_appends: {
        help: 'Total device-event batches appended to Redis Stream',
        type: 'counter'
    },
    device_event_stream_append_errors: {
        help: 'Device-event Redis Stream append errors',
        type: 'counter'
    },
    device_event_stream_degraded: {
        help: 'Device-event batches whose durable Redis persistence degraded',
        type: 'counter'
    },
    device_event_stream_saturated: {
        help: 'Device-event stream saturation warnings',
        type: 'counter'
    },
    device_event_stream_drained: {
        help: 'Device-event stream entries drained to DB',
        type: 'counter'
    },
    device_event_stream_drain_errors: {
        help: 'Device-event stream entries that failed DB drain',
        type: 'counter'
    },
    device_event_stream_poison: {
        help: 'Device-event stream entries with invalid payloads',
        type: 'counter'
    },
    device_event_stream_poison_dropped: {
        help: 'Device-event poison entries dropped after repeated deliveries',
        type: 'counter'
    },
    device_event_stream_ack_errors: {
        help: 'Device-event stream XACK failures',
        type: 'counter'
    },
    device_event_stream_reclaimed: {
        help: 'Device-event stream pending entries reclaimed',
        type: 'counter'
    },
    device_event_stream_cycle_errors: {
        help: 'Device-event stream drainer cycle errors',
        type: 'counter'
    },
    rpc_success: {help: 'Total successful RPC calls', type: 'counter'},
    rpc_errors: {help: 'Total failed RPC calls', type: 'counter'},
    audit_entries: {
        help: 'Total audit log entries created',
        type: 'counter'
    },
    audit_flushes: {help: 'Total audit log flushes to DB', type: 'counter'},
    events_broadcast: {
        help: 'Total events broadcast to listeners',
        type: 'counter'
    },
    em_syncs_completed: {help: 'Total EM syncs completed', type: 'counter'},
    em_syncs_failed: {help: 'Total EM syncs failed', type: 'counter'},
    em_sync_blocks_fetched: {
        help: 'Total emdata/em1data blocks fetched from devices',
        type: 'counter'
    },
    em_sync_catchup_batches: {
        help: 'Total EM sync blocks processed inside catch-up passes',
        type: 'counter'
    },
    em_sync_buffer_enqueued: {
        help: 'Total EM sync blocks enqueued to Redis Stream',
        type: 'counter'
    },
    em_sync_buffer_enqueue_errors: {
        help: 'EM sync Redis Stream enqueue errors',
        type: 'counter'
    },
    em_sync_buffer_saturated: {
        help: 'EM sync stream saturation warnings',
        type: 'counter'
    },
    em_sync_buffer_drained: {
        help: 'EM sync stream entries drained to DB',
        type: 'counter'
    },
    em_sync_buffer_rows_written: {
        help: 'EM sync raw rows written to DB from the Redis drainer',
        type: 'counter'
    },
    em_sync_buffer_drain_errors: {
        help: 'EM sync stream entries that failed DB drain',
        type: 'counter'
    },
    em_sync_buffer_poison: {
        help: 'EM sync stream entries with invalid payloads',
        type: 'counter'
    },
    em_sync_buffer_poison_dropped: {
        help: 'EM sync poison entries dropped after repeated deliveries',
        type: 'counter'
    },
    em_sync_buffer_ack_errors: {
        help: 'EM sync stream XACK failures',
        type: 'counter'
    },
    em_sync_buffer_reclaimed: {
        help: 'EM sync stream pending entries reclaimed',
        type: 'counter'
    },
    em_sync_buffer_cycle_errors: {
        help: 'EM sync drainer cycle errors',
        type: 'counter'
    },
    mdns_discovered: {help: 'Total mDNS discovery events', type: 'counter'},
    device_inits_started: {
        help: 'Total device initializations started',
        type: 'counter'
    },
    device_inits_completed: {
        help: 'Total device initializations completed',
        type: 'counter'
    },
    device_inits_failed: {
        help: 'Total device initializations failed',
        type: 'counter'
    },
    waiting_room_approved: {
        help: 'Total devices approved from waiting room',
        type: 'counter'
    },
    waiting_room_denied: {
        help: 'Total devices denied from waiting room',
        type: 'counter'
    },
    auth_successes: {
        help: 'Total successful authentications',
        type: 'counter'
    },
    auth_failures: {help: 'Total failed authentications', type: 'counter'},
    auth_cache_hits: {help: 'Userinfo cache hits', type: 'counter'},
    auth_cache_misses: {
        help: 'Userinfo cache misses (Zitadel fetch)',
        type: 'counter'
    },
    status_flush_errors: {
        help: 'Status queue flush errors',
        type: 'counter'
    },
    em_stats_flushes: {
        help: 'EM stats queue flushes to DB',
        type: 'counter'
    },
    em_stats_flush_errors: {
        help: 'EM stats queue flush errors',
        type: 'counter'
    },
    audit_write_errors: {help: 'Audit log write errors', type: 'counter'},
    authz_audit_write_failures: {
        help: 'Authz audit entries dropped after a swallowed DB write failure',
        type: 'counter'
    },
    plugin_worker_errors: {help: 'Plugin worker errors', type: 'counter'},
    plugin_worker_crashes: {
        help: 'Plugin worker non-zero exits',
        type: 'counter'
    },
    device_persists: {
        help: 'Device state persist operations (5s debounced)',
        type: 'counter'
    },
    events_filtered: {
        help: 'Events dropped by subscription deny/allow filters',
        type: 'counter'
    },
    events_permission_denied: {
        help: 'Events dropped due to device access denial',
        type: 'counter'
    },
    status_flushes_skipped: {
        help: 'Status flushes skipped (DB writes disabled)',
        type: 'counter'
    },
    em_stats_flushes_skipped: {
        help: 'EM stats flushes skipped (DB writes disabled)',
        type: 'counter'
    },
    em_sync_writes_skipped: {
        help: 'EM sync DB writes skipped (DB writes disabled)',
        type: 'counter'
    },
    audit_flushes_skipped: {
        help: 'Audit flushes skipped (DB writes disabled)',
        type: 'counter'
    },
    device_persists_skipped: {
        help: 'Device persists skipped (DB writes disabled)',
        type: 'counter'
    },
    fleet_summary_energy_failures: {
        help: 'Per-device daily-energy lookups that failed during fleet summary',
        type: 'counter'
    },
    fleet_metrics_device_failures: {
        help: 'Devices skipped during fleet live-metric aggregation due to errors',
        type: 'counter'
    },
    ws_live_loop_send_errors: {
        help: 'WS session live-loop sendBatchAndAck non-socket faults',
        type: 'counter'
    },
    device_inits_queue_dropped: {
        help: 'Device inits refused because the init queue was over its high-water mark (init_queue_full)',
        type: 'counter'
    },
    device_inits_cooldown_rejected: {
        help: 'Device inits rejected while the device was in init-failure cooldown',
        type: 'counter'
    },
    cluster_inits_full: {
        help: 'Device inits rejected because the cluster-wide init slot cap was full',
        type: 'counter'
    },
    waiting_room_reconnect_limited: {
        help: 'Reconnect attempts throttled by the waiting-room reconnect limiter (backoff)',
        type: 'counter'
    },
    waiting_room_stored_admit_failed: {
        help: 'Stored-approval admits that failed (e.g. init gate full) and backed off instead of looping',
        type: 'counter'
    },
    device_builds_total: {
        help: 'Devices built (probed + composed) after admission',
        type: 'counter'
    },
    device_builds_slow: {
        help: 'Device builds that ran slower than the slow-build threshold',
        type: 'counter'
    },
    contained_faults: {
        help: 'Unexpected faults in our code, contained instead of crashing (alert if > 0)',
        type: 'counter'
    },
    peer_errors: {
        help: 'Expected peer/network errors handled gracefully (resets, disconnects, bad frames)',
        type: 'counter'
    },
    process_uncaught_exception_total: {
        help: 'Uncaught exceptions reaching the process-level handler',
        type: 'counter'
    },
    process_unhandled_rejection_total: {
        help: 'Unhandled promise rejections reaching the process-level handler',
        type: 'counter'
    }
};

for (const [name, def] of Object.entries(COUNTER_DEFS)) {
    const read = () => counters.get(name) ?? 0;
    if (def.type === 'gauge') liveGauge(`fm_${name}`, def.help, read);
    else mirrorCounter(`fm_${name}`, def.help, read);
}

function sortLabels(labels: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(labels).sort(([a], [b]) => a.localeCompare(b))
    );
}

function labelKey(name: string, labels: Record<string, string>): string {
    return JSON.stringify({name, labels});
}

export function incrementCounter(name: string, delta = 1): void {
    if (getLevel() < 2) return;
    counters.set(name, (counters.get(name) ?? 0) + delta);
}

export function getCounter(name: string): number {
    return counters.get(name) ?? 0;
}

export function incrementLabeledCounter(
    name: string,
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
    name: string,
    labels: Record<string, string>
): number {
    const key = labelKey(name, sortLabels(labels));
    return labeledCounters.get(key)?.value ?? 0;
}

export function getGauge(name: string): number {
    return gauges.get(name) ?? 0;
}

export function setGauge(name: string, value: number): void {
    if (getLevel() < 1) return;
    gauges.set(name, value);
}

export function setLabeledGauge(
    name: string,
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
