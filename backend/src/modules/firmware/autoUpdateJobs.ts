export type FirmwareAutoUpdateChannel = 'stable' | 'beta';

export type FirmwareAutoUpdateStatus =
    | 'queued'
    | 'no_update'
    | 'offline'
    | 'failed'
    | 'skipped';

export interface FirmwareAutoUpdateCandidate {
    shellyID: string;
    tenantId: string;
    channel: FirmwareAutoUpdateChannel;
}

export interface FirmwareAutoUpdateJobGroup {
    tenantId: string;
    channel: FirmwareAutoUpdateChannel;
    shellyIDs: string[];
}

export interface FirmwareAutoUpdateJobRef {
    jobId: string;
    tenantId: string;
    channel: FirmwareAutoUpdateChannel;
    shellyIDs: string[];
}

export interface FirmwareAutoUpdateResult {
    shellyID: string;
    status: FirmwareAutoUpdateStatus;
    channel?: FirmwareAutoUpdateChannel;
    jobId?: string;
    error?: string;
}

export interface FirmwareAutoUpdateRunSummary {
    checked: number;
    queued: number;
    skipped: number;
    failed: number;
    jobs: FirmwareAutoUpdateJobRef[];
    results: FirmwareAutoUpdateResult[];
}

export function groupAutoUpdateCandidates(
    candidates: readonly FirmwareAutoUpdateCandidate[]
): FirmwareAutoUpdateJobGroup[] {
    const grouped = new Map<string, FirmwareAutoUpdateJobGroup>();

    for (const candidate of candidates) {
        const key = `${candidate.tenantId}:${candidate.channel}`;
        const group =
            grouped.get(key) ??
            createAutoUpdateJobGroup(candidate.tenantId, candidate.channel);
        group.shellyIDs.push(candidate.shellyID);
        grouped.set(key, group);
    }

    return [...grouped.values()].map(sortAutoUpdateJobGroup);
}

export function summarizeAutoUpdateRun(
    results: readonly FirmwareAutoUpdateResult[],
    jobs: readonly FirmwareAutoUpdateJobRef[]
): FirmwareAutoUpdateRunSummary {
    return {
        checked: results.length,
        queued: countResults(results, 'queued'),
        skipped: countResults(results, 'skipped'),
        failed: countResults(results, 'failed'),
        jobs: [...jobs],
        results: [...results]
    };
}

function createAutoUpdateJobGroup(
    tenantId: string,
    channel: FirmwareAutoUpdateChannel
): FirmwareAutoUpdateJobGroup {
    return {
        tenantId,
        channel,
        shellyIDs: []
    };
}

function sortAutoUpdateJobGroup(
    group: FirmwareAutoUpdateJobGroup
): FirmwareAutoUpdateJobGroup {
    return {
        ...group,
        shellyIDs: [...group.shellyIDs].sort()
    };
}

function countResults(
    results: readonly FirmwareAutoUpdateResult[],
    status: FirmwareAutoUpdateStatus
): number {
    return results.filter((result) => result.status === status).length;
}
