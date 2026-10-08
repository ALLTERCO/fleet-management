import type {
    IrrigationPolicy,
    IrrigationVerdict,
    IrrigationVerdictStatus,
    OperationalPolicies,
    PvHealthPolicy,
    PvHealthVerdict
} from '../../types/api/operations';
import {latestScheduledOccurrence} from './evaluatorBlocks';

export type OperationalVerdictPolicies = OperationalPolicies;

export const EMPTY_OPERATIONAL_VERDICT_POLICIES: OperationalVerdictPolicies = {
    refrigeration: [],
    coldChain: [],
    parking: [],
    irrigation: [],
    pv: [],
    italiaPoolChemistry: [],
    italiaHotWater: [],
    italiaNightFlow: [],
    italiaPitch: [],
    italiaSitePower: [],
    italiaBreakerTrips: []
};

export interface PvSourceHistory {
    id: string;
    generatedWh: number | null;
    fresh: boolean;
}

export function pvHealthVerdict(
    policy: PvHealthPolicy | undefined,
    sources: readonly PvSourceHistory[]
): PvHealthVerdict {
    if (!policy)
        return {
            policyId: '',
            status: 'config_missing',
            comparableSources: 0,
            attentionSources: []
        };
    if (
        sources.length !== policy.sources.length ||
        sources.some((source) => source.generatedWh === null)
    )
        return unavailablePv(policy.id, 'data_missing', sources);
    if (sources.some((source) => !source.fresh))
        return unavailablePv(policy.id, 'stale', sources);
    const comparable = sources.filter((source) => source.generatedWh! > 0);
    if (comparable.length < policy.minComparableSources)
        return unavailablePv(policy.id, 'data_missing', comparable);
    const median = medianOf(comparable.map((source) => source.generatedWh!));
    const attentionSources = comparable
        .filter(
            (source) =>
                1 - source.generatedWh! / median >= policy.attentionFraction
        )
        .map((source) => source.id);
    return {
        policyId: policy.id,
        status: attentionSources.length > 0 ? 'attention' : 'healthy',
        comparableSources: comparable.length,
        attentionSources
    };
}

function unavailablePv(
    policyId: string,
    status: 'data_missing' | 'stale',
    sources: readonly PvSourceHistory[]
): PvHealthVerdict {
    return {
        policyId,
        status,
        comparableSources: sources.filter(
            (source) => source.generatedWh !== null
        ).length,
        attentionSources: []
    };
}

function medianOf(values: readonly number[]): number {
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
}

export interface IrrigationHistory {
    valveAvailable: boolean;
    valveFresh: boolean;
    completedAt: Date | null;
    soilValue: number | null;
    rainValue: number | null;
}

export function irrigationVerdict(
    policy: IrrigationPolicy | undefined,
    timezone: string,
    history: IrrigationHistory,
    now: Date
): IrrigationVerdict {
    if (!policy) return unavailableIrrigation('', 'config_missing');
    const dueAt = latestScheduledOccurrence({
        schedules: policy.schedules,
        timezone,
        now
    });
    if (!history.valveAvailable)
        return unavailableIrrigation(policy.id, 'data_missing', dueAt);
    if (!history.valveFresh)
        return unavailableIrrigation(policy.id, 'stale', dueAt);
    if (history.completedAt)
        return {
            policyId: policy.id,
            status: 'completed',
            dueAt: dueAt.toISOString(),
            completedAt: history.completedAt.toISOString(),
            skipReason: null
        };
    if (
        policy.soil &&
        history.soilValue !== null &&
        history.soilValue >= policy.soil.threshold
    )
        return skippedIrrigation(policy.id, dueAt, 'soil_wet');
    if (
        policy.rain &&
        history.rainValue !== null &&
        history.rainValue >= policy.rain.threshold
    )
        return skippedIrrigation(policy.id, dueAt, 'rain');
    const graceEndsAt = dueAt.getTime() + policy.graceSec * 1000;
    return unavailableIrrigation(
        policy.id,
        now.getTime() <= graceEndsAt ? 'scheduled' : 'missed',
        dueAt
    );
}

function unavailableIrrigation(
    policyId: string,
    status: Exclude<IrrigationVerdictStatus, 'completed' | 'skipped_by_policy'>,
    dueAt?: Date
): IrrigationVerdict {
    return {
        policyId,
        status,
        dueAt: dueAt?.toISOString() ?? null,
        completedAt: null,
        skipReason: null
    };
}

function skippedIrrigation(
    policyId: string,
    dueAt: Date,
    skipReason: 'soil_wet' | 'rain'
): IrrigationVerdict {
    return {
        policyId,
        status: 'skipped_by_policy',
        dueAt: dueAt.toISOString(),
        completedAt: null,
        skipReason
    };
}
