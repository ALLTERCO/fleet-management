// Tally topology nodes by health status — single home for the health-strip
// counts so callers never re-implement the reduce.

import type {ModuleStatus} from '@/types/topology';

export function countByStatus(
    nodes: ReadonlyArray<{status: ModuleStatus}>
): Record<ModuleStatus, number> {
    const counts: Record<ModuleStatus, number> = {
        healthy: 0,
        warning: 0,
        critical: 0,
        unknown: 0
    };
    for (const node of nodes) {
        // Topology responses are a runtime boundary: a module can mistakenly
        // emit a non-canonical status (for example dbRuntime's local `ok`).
        // Never silently drop that node or create a NaN bucket. Count it as
        // unverified until the backend normalizes its public status.
        switch (node.status) {
            case 'healthy':
            case 'warning':
            case 'critical':
            case 'unknown':
                counts[node.status]++;
                break;
            default:
                counts.unknown++;
        }
    }
    return counts;
}
