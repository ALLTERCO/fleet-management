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
    for (const node of nodes) counts[node.status]++;
    return counts;
}
