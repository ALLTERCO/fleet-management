export interface EmSyncHealthSnapshot {
    emSyncStreamDepth: number;
    emSyncStreamOldestAgeMs: number;
    emSyncStreamPending: number;
    emSyncLastWriteMs: number;
    emSyncLastRpcFetchMs: number;
    emSyncWorstChannelLagSec: number;
    emActiveSyncs: number;
    emQueueSize: number;
}

export type EmSyncHealthStatus = 'healthy' | 'warning' | 'critical';

/**
 * Classify actionable EM synchronization pressure.
 *
 * Stream depth and oldest-entry age are retained-history diagnostics. Redis
 * XACK removes an entry from the consumer group's pending-entry list, but does
 * not delete the stream entry itself, so retained acknowledged history must
 * not be treated as live backlog.
 */
export function assessEmSyncHealth(
    snapshot: EmSyncHealthSnapshot
): EmSyncHealthStatus {
    if (
        snapshot.emSyncStreamPending > 10000 ||
        snapshot.emSyncLastWriteMs > 5000 ||
        snapshot.emSyncLastRpcFetchMs > 10000 ||
        snapshot.emSyncWorstChannelLagSec > 6 * 3600
    )
        return 'critical';

    if (snapshot.emActiveSyncs >= 40 && snapshot.emQueueSize > 200)
        return 'critical';

    if (
        snapshot.emSyncStreamPending > 1000 ||
        snapshot.emSyncLastWriteMs > 1500 ||
        snapshot.emSyncLastRpcFetchMs > 3000 ||
        snapshot.emSyncWorstChannelLagSec > 3600
    )
        return 'warning';

    if (snapshot.emActiveSyncs > 30) return 'warning';
    return 'healthy';
}
