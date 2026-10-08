// What each system health check means for a person: where the fix lives and
// how to read its number. The check id is the backend's stable key.
export interface SystemHealthCheckView {
    /** Where the admin fixes it. */
    to: string;
    actionLabel: string;
    /** Unit for the check's number, e.g. "blocks waiting". */
    unit: string;
}

const CHECKS: Readonly<Record<string, SystemHealthCheckView>> = {
    'em-sync-rejected-open': {
        to: '/settings/energy/repair',
        actionLabel: 'Open rejected blocks',
        unit: 'blocks waiting'
    },
    'em-stats-dropped': {
        to: '/settings/monitoring/runtime',
        actionLabel: 'Open system status',
        unit: 'rows lost'
    },
    'em-stats-overflow': {
        to: '/settings/monitoring/runtime',
        actionLabel: 'Open system status',
        unit: 'batches waiting'
    },
    'audit-overflow-saturated': {
        to: '/settings/monitoring/runtime',
        actionLabel: 'Open system status',
        unit: 'times full'
    }
};

const FALLBACK: SystemHealthCheckView = {
    to: '/settings/monitoring/runtime',
    actionLabel: 'Open system status',
    unit: ''
};

export function describeSystemHealthCheck(
    check: unknown
): SystemHealthCheckView {
    return typeof check === 'string' ? (CHECKS[check] ?? FALLBACK) : FALLBACK;
}
