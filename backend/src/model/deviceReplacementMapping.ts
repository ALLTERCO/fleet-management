import type {EnergyTag} from '../modules/energyClassifier';
import type {
    DeviceReplacementAvailablePoint,
    DeviceReplacementCandidate,
    DeviceReplacementRequirement
} from './deviceReplacementTypes';

// One confirmed remap: the old required point (source) and the new device
// point it should move to (target). Phase/tag are preserved by the
// compatibility rule; only channel/phase/tag are the addressable grain.
export interface NormalizedRemapEntry {
    fromChannel: number;
    fromPhase: 'a' | 'b' | 'c' | 'z';
    fromTag: EnergyTag;
    toChannel: number;
    toPhase: 'a' | 'b' | 'c' | 'z';
    toTag: EnergyTag;
}

interface TargetRef {
    channel: number;
    phase: 'a' | 'b' | 'c' | 'z';
    tag: EnergyTag;
}

// Stable identity for a point: (channel, tag) — the ownership grain from
// fm.logical_meter_point UNIQUE(device, channel, tag). Phase is display
// metadata, NOT identity, so it is excluded from the key.
function pointKey(p: {channel: number; tag: EnergyTag}): string {
    return `${p.channel}|${p.tag}`;
}

function requirementKey(req: DeviceReplacementRequirement): string {
    return pointKey(req);
}

function asTargetRef(value: unknown): TargetRef | null {
    if (!value || typeof value !== 'object') return null;
    const v = value as Record<string, unknown>;
    if (
        typeof v.channel !== 'number' ||
        typeof v.phase !== 'string' ||
        typeof v.tag !== 'string'
    ) {
        return null;
    }
    return {
        channel: v.channel,
        phase: v.phase as TargetRef['phase'],
        tag: v.tag as EnergyTag
    };
}

function candidateMatchesTarget(
    candidate: DeviceReplacementAvailablePoint,
    target: TargetRef
): boolean {
    return (
        candidate.channel === target.channel &&
        candidate.phase === target.phase &&
        candidate.tag === target.tag
    );
}

/**
 * Validate a confirmed mapping against the check's remap candidates and
 * normalize it for the DB call. Fail loud: every required point that needs
 * remapping must map to exactly one of its allowed candidates, and the
 * mapping must not carry unknown or extra entries.
 *
 * Shape: `{ "<channel>|<tag>": {channel, phase, tag} }` keyed by the old
 * required point's ownership grain, valued by the chosen new-device point.
 */
export function validateConfirmedMapping(
    remapCandidates: readonly DeviceReplacementCandidate[],
    confirmedMapping: unknown
): NormalizedRemapEntry[] {
    if (
        confirmedMapping === null ||
        typeof confirmedMapping !== 'object' ||
        Array.isArray(confirmedMapping)
    ) {
        throw new Error('confirmedMapping must be an object');
    }
    const provided = confirmedMapping as Record<string, unknown>;
    const requiredKeys = new Set(
        remapCandidates.map((c) => requirementKey(c.required))
    );

    const unknownKeys = Object.keys(provided).filter(
        (key) => !requiredKeys.has(key)
    );
    if (unknownKeys.length > 0) {
        throw new Error(
            `confirmedMapping has unknown entries: ${unknownKeys.join(', ')}`
        );
    }

    const entries: NormalizedRemapEntry[] = [];
    const problems: string[] = [];
    for (const candidate of remapCandidates) {
        const key = requirementKey(candidate.required);
        const raw = provided[key];
        if (raw === undefined) {
            problems.push(`missing mapping for required point ${key}`);
            continue;
        }
        const target = asTargetRef(raw);
        if (!target) {
            problems.push(
                `mapping for ${key} must have numeric channel and string phase/tag`
            );
            continue;
        }
        const matched = candidate.candidates.some((c) =>
            candidateMatchesTarget(c, target)
        );
        if (!matched) {
            problems.push(
                `mapping for ${key} -> ${pointKey(target)} is not an allowed candidate`
            );
            continue;
        }
        entries.push({
            fromChannel: candidate.required.channel,
            fromPhase: candidate.required.phase,
            fromTag: candidate.required.tag,
            toChannel: target.channel,
            toPhase: target.phase,
            toTag: target.tag
        });
    }

    // Two entries resolving to the same target (channel, tag) is always a
    // UNIQUE collision on remap — reject before it reaches the DB.
    const targetCounts = new Map<string, number>();
    for (const entry of entries) {
        const targetKey = pointKey({
            channel: entry.toChannel,
            tag: entry.toTag
        });
        targetCounts.set(targetKey, (targetCounts.get(targetKey) ?? 0) + 1);
    }
    for (const [targetKey, count] of targetCounts) {
        if (count > 1) {
            problems.push(`duplicate target point ${targetKey}`);
        }
    }

    if (problems.length > 0) {
        throw new Error(`invalid confirmedMapping: ${problems.join('; ')}`);
    }
    return entries;
}
