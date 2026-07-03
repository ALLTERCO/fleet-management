/** Canonical Shelly status.source values mapped to operator-friendly labels.
 *  Single source of truth — every EntityTemplate that surfaces `via X` uses this. */

const SOURCE_LABELS: Record<string, string> = {
    init: 'power on',
    WS_in: 'cloud',
    http: 'HTTP',
    button: 'button',
    timer: 'timer',
    schedule: 'schedule',
    limit_switch: 'limit switch',
    loopback: 'loopback',
    FLEET_MANAGER: 'fleet manager',
    FLEET_MANAGER_UI: 'fleet manager'
};

export function formatSource(source: string): string {
    return SOURCE_LABELS[source] ?? source;
}
