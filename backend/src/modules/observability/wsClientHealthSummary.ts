export const WS_CLIENT_HEALTH_WINDOW_SEC = 5 * 60;

export interface WsClientHealthSample {
    clientId: string;
    bufferedBytes: number;
    action: 'paused' | 'dropped';
    ts: number;
}

export interface WsClientHealthStats {
    windowSec: number;
    strugglingClients: number;
    pausedClients: number;
    droppedClients: number;
    worstBufferedBytes: number;
}

/** Summarize only backpressure observed in the same recent window used by the UI. */
export function summarizeWsClientHealth(
    samples: readonly WsClientHealthSample[],
    nowMs: number = Date.now()
): WsClientHealthStats {
    const cutoff = nowMs - WS_CLIENT_HEALTH_WINDOW_SEC * 1000;
    const struggling = new Set<string>();
    const paused = new Set<string>();
    const dropped = new Set<string>();
    let worstBufferedBytes = 0;

    for (const sample of samples) {
        if (sample.ts < cutoff || sample.ts > nowMs) continue;
        struggling.add(sample.clientId);
        if (sample.action === 'dropped') dropped.add(sample.clientId);
        else paused.add(sample.clientId);
        if (sample.bufferedBytes > worstBufferedBytes) {
            worstBufferedBytes = sample.bufferedBytes;
        }
    }

    return {
        windowSec: WS_CLIENT_HEALTH_WINDOW_SEC,
        strugglingClients: struggling.size,
        pausedClients: paused.size,
        droppedClients: dropped.size,
        worstBufferedBytes
    };
}
