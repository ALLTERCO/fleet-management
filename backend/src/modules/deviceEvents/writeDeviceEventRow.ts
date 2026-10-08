// device.fn_event_log_add_batch param mapping. Kept beside the row shape so
// the logger (and any future overflow drainer) persist rows identically.

import type {DeviceEventBatchRow} from './deviceEventRow';

// callMethod is injected at boot to keep this off the PostgresProvider import
// graph — importing it directly closes a logger->DB->device->logger cycle.
type CallMethod = (
    method: string,
    params: Record<string, unknown>
) => Promise<unknown>;
let callMethod: CallMethod | undefined;

export function setDeviceEventLogCallMethod(fn: CallMethod): void {
    callMethod = fn;
}

/** Rows stored, and rows whose device was deleted before they drained. */
export interface DeviceEventWriteResult {
    accepted: number;
    skipped: number;
}

export async function writeDeviceEventRowBatch(
    rows: DeviceEventBatchRow[]
): Promise<DeviceEventWriteResult> {
    if (!callMethod) {
        throw new Error('device event log writer not initialized');
    }
    // JSONB param must be pre-stringified (callMethod convention). prev/next
    // ride along as raw values; the SQL extracts them with e->'prev'.
    const result = await callMethod('device.fn_event_log_add_batch', {
        p_entries: JSON.stringify(rows)
    });
    return readWriteResult(result);
}

function readWriteResult(result: unknown): DeviceEventWriteResult {
    const row = (result as {rows?: ReadonlyArray<Record<string, unknown>>})
        ?.rows?.[0];
    const accepted = Number(row?.accepted);
    const skipped = Number(row?.skipped);
    if (!Number.isInteger(accepted) || !Number.isInteger(skipped)) {
        throw new Error(
            'device.fn_event_log_add_batch returned no accepted/skipped counts'
        );
    }
    return {accepted, skipped};
}
