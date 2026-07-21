// Single source of truth for a device card's liveness: online, sleeping,
// stale, and the heartbeat timestamp. Every Devices-tab card reads its
// live-state from here so the left status indicator and the right reading
// pill can never disagree about the same device.
//
// All fields are backend-reported — resolution lives in this one place:
//   - device.online / device.sleeping — presence flags the backend sets
//     from WS liveness (sleeping devices report their own wakeup window)
//   - device.meta.lastReportTs — ms epoch, bumped on every device report
//   - status.bluetoothdevice.transportHealth — BLU cadence health, judged
//     backend-side against the model's expected report interval

export interface DeviceLivenessInput {
    online?: boolean;
    sleeping?: boolean;
    loading?: boolean;
    source?: string;
    status?: Record<string, any>;
    meta?: Record<string, any>;
}

export interface DeviceLiveness {
    online: boolean;
    sleeping: boolean;
    /** Last report outlived the model's expected cadence — render muted. */
    stale: boolean;
    /** Heartbeat in ms epoch: the one field cards read for "last seen". */
    lastReportMs: number | null;
}

function bluTransportHealth(
    status?: Record<string, any>
): {status?: string; lastSeenAt?: string} | undefined {
    return status?.bluetoothdevice?.transportHealth;
}

// BLU broadcasts carry no clock of their own; the gateway stamps lastSeenAt
// (ISO) on each received broadcast — that is the BLU heartbeat.
function bluLastSeenMs(status?: Record<string, any>): number | null {
    const iso = bluTransportHealth(status)?.lastSeenAt;
    if (typeof iso !== 'string') return null;
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms : null;
}

const OFFLINE: DeviceLiveness = {
    online: false,
    sleeping: false,
    stale: false,
    lastReportMs: null
};

export function resolveDeviceLiveness(
    device?: DeviceLivenessInput
): DeviceLiveness {
    if (!device) return OFFLINE;
    const sleeping = !!device.sleeping;
    const online = !device.loading && (device.online !== false || sleeping);

    // BLU reports over Bluetooth: the gateway measures freshness against the
    // model cadence and reports it as transport health — anything short of
    // 'online' is stale.
    if (device.source === 'bluetooth') {
        const health = bluTransportHealth(device.status)?.status;
        return {
            online,
            sleeping,
            stale: typeof health === 'string' && health !== 'online',
            lastReportMs: bluLastSeenMs(device.status)
        };
    }

    // Native/wired devices: presence is the liveness signal; meta.lastReportTs
    // is the backend's own report timestamp (device clocks may be unset/wrong).
    const reportTs = device.meta?.lastReportTs;
    return {
        online,
        sleeping,
        stale: false,
        lastReportMs: typeof reportTs === 'number' ? reportTs : null
    };
}
