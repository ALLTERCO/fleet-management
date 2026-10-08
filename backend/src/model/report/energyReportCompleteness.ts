import {
    type EmIncompleteRange,
    hasBlockedRollup,
    type RollupBacklogInScope
} from '../../modules/repositories/EnergyRepository';
import RpcError from '../../rpc/RpcError';
import type {
    EnergyIncompleteRange,
    EnergySyncStatusResponse
} from '../../types/api/energy';

export interface RollupScope {
    internalIds: readonly number[];
    from: Date;
    to: Date;
}

export interface RollupWaiter {
    waitForRollup(
        internalIds: readonly number[],
        from: Date,
        to: Date
    ): Promise<RollupBacklogInScope>;
}

export function energyReportCompletenessNote(
    status: EnergySyncStatusResponse,
    incomplete: readonly EnergyIncompleteRange[] = []
): string | null {
    if (status.complete && incomplete.length === 0) return null;
    const note =
        'Partial data: ' +
        `${status.devicesCatchingUp} devices syncing history; ` +
        `${status.rollupPendingBuckets} report buckets processing`;
    return incomplete.reduce(
        (text, r) =>
            `${text}; incomplete history ${r.device} channel ${r.channel} ` +
            `${r.from} to ${r.to}`,
        note
    );
}

/**
 * Public ranges for the devices and channels a report or quote covers. A
 * range on a point the caller does not read cannot make its result partial.
 */
export function publicIncompleteRanges(
    ranges: readonly EmIncompleteRange[],
    idMap: Readonly<Record<number, string>>,
    includePoint?: (device: string, channel: number) => boolean
): EnergyIncompleteRange[] {
    return ranges.flatMap((r) => {
        const device = idMap[r.device];
        if (device === undefined) return [];
        if (includePoint && !includePoint(device, r.channel)) return [];
        return [
            {
                device,
                channel: r.channel,
                kind: r.kind,
                tag: r.tag,
                from: r.from.toISOString(),
                to: r.to.toISOString(),
                expectedWh: r.expectedWh,
                storedWh: r.storedWh
            }
        ];
    });
}

// A range the check found incomplete does not fill by waiting, so a strict
// report names it at once.
export function requireNoIncompleteRanges(
    ranges: readonly EnergyIncompleteRange[]
): void {
    if (ranges.length === 0) return;
    throw RpcError.Domain('EnergyHistoryIncomplete', {
        details: {incompleteRanges: [...ranges]}
    });
}

// Held and abandoned work never finishes on its own, so a strict report says
// so at once instead of waiting for it.
export async function requireCompleteRollup(
    repo: RollupWaiter,
    scope: RollupScope,
    backlog: RollupBacklogInScope
): Promise<void> {
    const settled =
        backlog.ready > 0 && !hasBlockedRollup(backlog)
            ? await repo.waitForRollup(scope.internalIds, scope.from, scope.to)
            : backlog;
    if (!hasBlockedRollup(settled)) return;
    throw RpcError.Domain('EnergyHistoryIncomplete', {
        details: {held: settled.held, abandoned: settled.abandoned}
    });
}
