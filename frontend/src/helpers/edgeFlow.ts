// Maps an edge's per-minute throughput to a stable animation duration.
// Bucketed so 2s topology polls do not restart SMIL animations on jitter.

const FLOW_MIN_SEC = 1.2;
const FLOW_MAX_SEC = 6;
const FLOW_REFERENCE_RATE = 60;
const FLOW_BUCKET_SEC = 0.5;

export function flowDurationSec(throughput: number): number {
    const rate = Math.max(0, throughput);
    if (rate === 0) return FLOW_MAX_SEC;
    const ratio = Math.min(1, rate / FLOW_REFERENCE_RATE);
    const raw = FLOW_MAX_SEC - ratio * (FLOW_MAX_SEC - FLOW_MIN_SEC);
    return snapToBucket(raw);
}

function snapToBucket(seconds: number): number {
    return Math.round(seconds / FLOW_BUCKET_SEC) * FLOW_BUCKET_SEC;
}
