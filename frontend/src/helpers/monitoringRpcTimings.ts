interface RpcTimingEntry {
    count?: unknown;
    avgMs?: unknown;
}

function isRequestTiming(method: string): boolean {
    return !(
        /^websocket_.*_lifetime$/.test(method) ||
        method.startsWith('event:') ||
        method.startsWith('waitingroom.') ||
        method.startsWith('device_ingress_')
    );
}

/**
 * Compute the average request/response RPC latency from the backend timing map.
 *
 * `rpcTimings` also contains long-lived WebSocket lifetimes and internal event,
 * waiting-room and device-ingress timings. Those are useful diagnostics, but
 * they are not RPC command latency and must not be compared with the RPC health
 * thresholds. The backend exposes one average plus a sample count per key, so
 * weight each real RPC method by its count instead of giving rare methods the
 * same influence as high-volume ones.
 */
export function computeRpcRequestAvgMs(timings: unknown): number {
    if (!timings || typeof timings !== 'object') return 0;

    let weightedTotalMs = 0;
    let sampleCount = 0;

    for (const [method, rawEntry] of Object.entries(timings)) {
        if (
            !isRequestTiming(method) ||
            !rawEntry ||
            typeof rawEntry !== 'object'
        )
            continue;

        const {count, avgMs} = rawEntry as RpcTimingEntry;
        if (
            typeof count !== 'number' ||
            !Number.isFinite(count) ||
            count <= 0 ||
            typeof avgMs !== 'number' ||
            !Number.isFinite(avgMs) ||
            avgMs < 0
        )
            continue;

        weightedTotalMs += avgMs * count;
        sampleCount += count;
    }

    return sampleCount > 0 ? Math.round(weightedTotalMs / sampleCount) : 0;
}
