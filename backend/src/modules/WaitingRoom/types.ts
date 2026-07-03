export interface SanitizedStatus {
    wifi?: {sta_ip?: string; ssid?: string; rssi?: number};
    eth?: {ip?: string};
    sys?: {
        mac?: string;
        fw_id?: string;
        ver?: string;
        gen?: number;
        app?: string;
        uptime?: number;
        unixtime?: number;
        // Wake interval (s) reported by battery/sleeping devices.
        wakeup_period?: number;
        device?: {
            name?: string;
            profile?: string;
            model?: string;
            // Canonical product name from jwt.n (e.g. "Youth Smart Thermostat ST802")
            productName?: string;
            // XT1 service module map keyed by service index ("0", "1", ...).
            // Value is the service `type` (e.g. "linkedgo-st-802-hvac").
            xt1Services?: Record<string, string>;
            // Shortcut to the lowest-index service type, so single-service
            // readers (current waiting-room card) don't have to walk the map.
            xt1SvcType?: string;
        };
        available_updates?: {stable?: {version?: string}};
    };
    cloud?: {connected?: boolean};
    mqtt?: {connected?: boolean};
    ble?: {enabled?: boolean};
    auth_en?: boolean;
}

export type SanitizedStatusShape = SanitizedStatus & Record<string, unknown>;

// Discovery.AdmitDevice intent shape — passed to onApprove() when the
// auto-admit hook matched. Absent on operator-driven approvals.
export interface AdmissionIntent {
    organization_id: string;
    group_id: number | null;
}

export type ApproveCallback = (
    intent?: AdmissionIntent
) => void | Promise<void>;

export interface AddDeviceInput {
    shellyID: string;
    onApprove: ApproveCallback;
    onDeny: () => void;
    onEvict: () => void;
    onQuarantine: () => void;
}

// Per-process socket-handle entry. Holds only the live admission callbacks and
// the map's own TTL marker — the device status lives solely in Redis.
export interface PendingEntry {
    onApprove: ApproveCallback;
    // Polite close. DB DENIED state stops re-entry; device flash untouched.
    onDeny: () => void;
    // TTL / capacity eviction. Polite close. Device reconnects + re-queues.
    onEvict: () => void;
    // Destructive — rewrites device WS config (server='#', enable=false) +
    // reboot. Used only via the explicit Quarantine admin action.
    onQuarantine: () => void;
    // Map-internal TTL marker (refreshed on touch); not device data.
    touchedAt: number;
}

export type PendingEvictionReason = 'lru' | 'ttl' | 'duplicate';

export interface DeviceInfoEnrichment {
    fw_id?: string;
    ver?: string;
    gen?: number;
    app?: string;
    name?: string;
    profile?: string;
    model?: string;
    // jwt.n — canonical product name (e.g. "Youth Smart Thermostat ST802")
    productName?: string;
    // jwt.xt1.svc* — service index ("0", "1", ...) → service type
    xt1Services?: Record<string, string>;
    // Lowest-index entry from xt1Services, surfaced for single-service readers
    xt1SvcType?: string;
}
