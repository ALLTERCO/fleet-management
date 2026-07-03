// Deterministic sort + topN truncation for contributor rows.
// Tie-break by deviceId ascending so tests can pin output.

import type {Contributor} from '../../types/api/analytics';

export interface TruncateResult {
    contributors: Contributor[];
    truncated: boolean;
    truncatedCount: number;
}

export function truncateContributors(
    rows: Contributor[],
    topN: number
): TruncateResult {
    const sorted = [...rows].sort((a, b) => {
        if (b.value !== a.value) return b.value - a.value;
        return a.deviceId - b.deviceId;
    });
    if (sorted.length <= topN) {
        return {contributors: sorted, truncated: false, truncatedCount: 0};
    }
    return {
        contributors: sorted.slice(0, topN),
        truncated: true,
        truncatedCount: sorted.length - topN
    };
}
