import type {
    RefrigerationPeerEnergyCoverage,
    RefrigerationPeerEnergySource,
    RefrigerationPeerEnergySourceVerdict,
    RefrigerationPeerEnergyStatus,
    RefrigerationPeerHealth,
    RefrigerationPeerPolicy
} from '../../types/api/operations';

export interface RefrigerationPeerEnergySample {
    sourceId: string;
    energyKwh: number | null;
    lastBucketAt: Date | null;
}

export interface RefrigerationPeerEnergyPeriod {
    from: Date;
    to: Date;
}

interface AssignedSource {
    source: RefrigerationPeerEnergySource;
    peerGroupId: string;
    sample: RefrigerationPeerEnergySample | undefined;
}

export function evaluateRefrigerationPeerEnergy(
    policy: RefrigerationPeerPolicy | undefined,
    period: RefrigerationPeerEnergyPeriod,
    samples: readonly RefrigerationPeerEnergySample[]
): RefrigerationPeerHealth {
    if (!policy)
        return {
            policyId: '',
            status: 'config_missing',
            thresholdPct: null,
            from: period.from.toISOString(),
            to: period.to.toISOString(),
            coverage: emptyCoverage(),
            sources: []
        };

    const sampleBySourceId = new Map(
        samples.map((sample) => [sample.sourceId, sample])
    );
    const configuredGroupSizes = configuredPeerGroupSizes(policy.sources);
    const assigned = policy.sources.map((source) => ({
        source,
        peerGroupId: selectPeerGroup(
            source.peerGroupIds,
            configuredGroupSizes,
            policy.minPeerCount
        ),
        sample: sampleBySourceId.get(source.id)
    }));
    const comparableByGroup = comparableSourcesByGroup(
        assigned,
        policy,
        period.to
    );
    const verdicts = assigned.map((item) =>
        sourceVerdict(item, comparableByGroup, policy, period.to)
    );
    const coverage = coverageOf(verdicts);

    return {
        policyId: policy.id,
        status: overallStatus(verdicts),
        thresholdPct: policy.thresholdPct,
        from: period.from.toISOString(),
        to: period.to.toISOString(),
        coverage,
        sources: verdicts
    };
}

function configuredPeerGroupSizes(
    sources: readonly RefrigerationPeerEnergySource[]
): ReadonlyMap<string, number> {
    const sizes = new Map<string, number>();
    for (const source of sources) {
        for (const peerGroupId of new Set(source.peerGroupIds))
            sizes.set(peerGroupId, (sizes.get(peerGroupId) ?? 0) + 1);
    }
    return sizes;
}

function selectPeerGroup(
    peerGroupIds: readonly string[],
    configuredGroupSizes: ReadonlyMap<string, number>,
    minPeerCount: number
): string {
    const qualifying = peerGroupIds.find(
        (peerGroupId) =>
            (configuredGroupSizes.get(peerGroupId) ?? 0) >= minPeerCount
    );
    return qualifying ?? peerGroupIds.at(-1) ?? '';
}

function comparableSourcesByGroup(
    sources: readonly AssignedSource[],
    policy: RefrigerationPeerPolicy,
    periodEnd: Date
): ReadonlyMap<string, number[]> {
    const groups = new Map<string, number[]>();
    for (const assigned of sources) {
        if (!isComparable(assigned.sample, policy.freshnessSec, periodEnd))
            continue;
        for (const peerGroupId of new Set(assigned.source.peerGroupIds)) {
            const group = groups.get(peerGroupId) ?? [];
            group.push(assigned.sample.energyKwh);
            groups.set(peerGroupId, group);
        }
    }
    return groups;
}

function sourceVerdict(
    assigned: AssignedSource,
    comparableByGroup: ReadonlyMap<string, number[]>,
    policy: RefrigerationPeerPolicy,
    periodEnd: Date
): RefrigerationPeerEnergySourceVerdict {
    const common = {
        sourceId: assigned.source.id,
        deviceId: assigned.source.deviceId,
        peerGroupId: assigned.peerGroupId
    };
    if (!assigned.sample || !isValidEnergy(assigned.sample.energyKwh))
        return {
            ...common,
            energyKwh: null,
            peerMedianKwh: null,
            peerCount: 0,
            driftPct: null,
            status: 'data_missing',
            unratedReason: null
        };
    if (!isFresh(assigned.sample, policy.freshnessSec, periodEnd))
        return {
            ...common,
            energyKwh: assigned.sample.energyKwh,
            peerMedianKwh: null,
            peerCount: 0,
            driftPct: null,
            status: 'stale',
            unratedReason: null
        };

    const peers = comparableByGroup.get(assigned.peerGroupId) ?? [];
    const peerMedianKwh = median(peers);
    if (peers.length < policy.minPeerCount)
        return {
            ...common,
            energyKwh: assigned.sample.energyKwh,
            peerMedianKwh,
            peerCount: peers.length,
            driftPct: null,
            status: 'unrated',
            unratedReason: 'insufficient_peers'
        };
    if (peerMedianKwh === 0)
        return {
            ...common,
            energyKwh: assigned.sample.energyKwh,
            peerMedianKwh,
            peerCount: peers.length,
            driftPct: null,
            status: 'unrated',
            unratedReason: 'zero_median'
        };

    const driftPct = round1(
        ((assigned.sample.energyKwh - peerMedianKwh) / peerMedianKwh) * 100
    );
    return {
        ...common,
        energyKwh: assigned.sample.energyKwh,
        peerMedianKwh,
        peerCount: peers.length,
        driftPct,
        status:
            Math.abs(driftPct) >= policy.thresholdPct ? 'attention' : 'healthy',
        unratedReason: null
    };
}

function isComparable(
    sample: RefrigerationPeerEnergySample | undefined,
    freshnessSec: number,
    periodEnd: Date
): sample is RefrigerationPeerEnergySample & {energyKwh: number} {
    return (
        sample !== undefined &&
        isValidEnergy(sample.energyKwh) &&
        isFresh(sample, freshnessSec, periodEnd)
    );
}

function isValidEnergy(value: number | null): value is number {
    return value !== null && Number.isFinite(value) && value >= 0;
}

function isFresh(
    sample: RefrigerationPeerEnergySample,
    freshnessSec: number,
    periodEnd: Date
): boolean {
    if (!sample.lastBucketAt) return false;
    const ageMs = periodEnd.getTime() - sample.lastBucketAt.getTime();
    return ageMs >= 0 && ageMs <= freshnessSec * 1000;
}

function median(values: readonly number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
}

function round1(value: number): number {
    return Math.round(value * 10) / 10;
}

function coverageOf(
    verdicts: readonly RefrigerationPeerEnergySourceVerdict[]
): RefrigerationPeerEnergyCoverage {
    return {
        configuredSources: verdicts.length,
        observedSources: verdicts.filter(
            (verdict) => verdict.status !== 'data_missing'
        ).length,
        freshSources: verdicts.filter(
            (verdict) =>
                verdict.status !== 'data_missing' && verdict.status !== 'stale'
        ).length,
        ratedSources: verdicts.filter(
            (verdict) =>
                verdict.status === 'healthy' || verdict.status === 'attention'
        ).length
    };
}

function overallStatus(
    verdicts: readonly RefrigerationPeerEnergySourceVerdict[]
): RefrigerationPeerEnergyStatus {
    if (verdicts.length === 0) return 'data_missing';
    if (verdicts.some((verdict) => verdict.status === 'attention'))
        return 'attention';
    if (verdicts.some((verdict) => verdict.status === 'stale')) return 'stale';
    if (verdicts.some((verdict) => verdict.status === 'data_missing'))
        return 'data_missing';
    if (verdicts.some((verdict) => verdict.status === 'unrated'))
        return 'unrated';
    return 'healthy';
}

function emptyCoverage(): RefrigerationPeerHealth['coverage'] {
    return {
        configuredSources: 0,
        observedSources: 0,
        freshSources: 0,
        ratedSources: 0
    };
}
