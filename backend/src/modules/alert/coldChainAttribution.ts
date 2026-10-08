/**
 * Names the appliance behind a water leak.
 *
 * A leak sensor only ever says "wet here". Under refrigeration the water is
 * almost always melt water from a fixture whose defrost drain is blocked, and
 * the fixture is a different Shelly device from the sensor that saw the water.
 * The rule engine has no cross-device primitive — `composite` resolves its
 * leaves against one device — so this enriches the existing `flood_alarm`
 * match with the co-located fixture that is in a defrost excursion right now,
 * the same way `attachVirtualRoleContext` enriches virtual-device matches.
 */
import {
    type ColdChainFixture,
    classifyFixture,
    coldChainProbeC,
    holdingCeilingC
} from './coldChainRules';
import type {MatchResult} from './types';

/** The little a candidate fixture has to expose — kept minimal so the
 *  attribution is unit-testable without a live DeviceCollector. */
export interface FixtureCandidate {
    shellyID: string;
    name?: string;
    status: Record<string, unknown>;
}

export interface FixtureExcursion {
    shellyID: string;
    label: string;
    tC: number;
    fixture: ColdChainFixture;
}

/** Fixtures whose case air is above the band they hold — the ones shedding
 *  melt water. Which devices even qualify is decided by the probe path, not by
 *  the reading: a device that publishes on no cold-chain probe is not a
 *  refrigerated fixture, so a sales-floor room sensor is excluded because it
 *  publishes on `temperature:0`, not because 25 °C looks too warm. */
export function fixturesInExcursion(
    candidates: readonly FixtureCandidate[]
): FixtureExcursion[] {
    const out: FixtureExcursion[] = [];
    for (const candidate of candidates) {
        const tC = coldChainProbeC(candidate.status);
        if (tC === null) continue;
        const fixture = classifyFixture(tC);
        if (tC <= holdingCeilingC(fixture)) continue;
        out.push({
            shellyID: candidate.shellyID,
            label: candidate.name ?? fixture.label,
            tC,
            fixture
        });
    }
    return out;
}

export interface AttributionCandidate extends FixtureExcursion {
    locationIds: readonly number[];
}

/** The fixture a wet floor most likely came from.
 *
 *  Ranked by how many locations it shares with the leak sensor: the location
 *  tree hands back a device's whole ancestry, so a fixture in the same store
 *  shares strictly more of it than one three suburbs away. Ties go to the
 *  warmest fixture, which is the furthest into its defrost and therefore has
 *  shed the most water. A fixture sharing nothing with the sensor is not
 *  attributable and the alert stays unattributed rather than guessing. */
export function attributeLeak(input: {
    leakLocationIds: readonly number[];
    candidates: readonly AttributionCandidate[];
}): FixtureExcursion | null {
    const leakLocations = new Set(input.leakLocationIds);
    let best: {candidate: AttributionCandidate; shared: number} | null = null;
    for (const candidate of input.candidates) {
        let shared = 0;
        for (const id of candidate.locationIds) {
            if (leakLocations.has(id)) shared += 1;
        }
        if (shared === 0) continue;
        if (
            best === null ||
            shared > best.shared ||
            (shared === best.shared && candidate.tC > best.candidate.tC)
        ) {
            best = {candidate, shared};
        }
    }
    if (!best) return null;
    const {locationIds: _locationIds, ...excursion} = best.candidate;
    return excursion;
}

/** Context keys the water-leak message template renders. Named here so the
 *  template and the enrichment cannot drift apart. */
export const LEAK_ATTRIBUTION_CONTEXT_KEYS = Object.freeze({
    shellyID: 'defrostingApplianceShellyID',
    label: 'defrostingApplianceLabel',
    tempC: 'defrostingApplianceTempC'
});

/** Merge the attributed fixture into a flood match's context. Returns the
 *  match untouched when nothing could be attributed, so an unattributable leak
 *  is still a critical alert. */
export function withLeakAttribution(
    match: MatchResult,
    excursion: FixtureExcursion | null
): MatchResult {
    if (!excursion) return match;
    return {
        ...match,
        message:
            `${match.message} Most likely melt water from ${excursion.label} ` +
            `(${excursion.shellyID}), currently ${excursion.tC} °C.`,
        context: {
            ...(match.context ?? {}),
            [LEAK_ATTRIBUTION_CONTEXT_KEYS.shellyID]: excursion.shellyID,
            [LEAK_ATTRIBUTION_CONTEXT_KEYS.label]: excursion.label,
            [LEAK_ATTRIBUTION_CONTEXT_KEYS.tempC]: excursion.tC
        }
    };
}

export interface LeakAttributionDeps {
    /** Every device the node currently holds status for. */
    fixtureCandidates: () => readonly FixtureCandidate[];
    /** Location ancestry of one device, as alert scope already resolves it. */
    locationIdsOf: (shellyID: string) => Promise<readonly number[]>;
}

/** Attribute a flood match to a co-located fixture in excursion. Membership
 *  lookups run only for fixtures already known to be in excursion, so a quiet
 *  fleet costs one lookup for the leak sensor and nothing else. */
export async function resolveLeakAttribution(
    leakShellyID: string,
    deps: LeakAttributionDeps
): Promise<FixtureExcursion | null> {
    const excursions = fixturesInExcursion(deps.fixtureCandidates()).filter(
        (excursion) => excursion.shellyID !== leakShellyID
    );
    if (excursions.length === 0) return null;
    const leakLocationIds = await deps.locationIdsOf(leakShellyID);
    if (leakLocationIds.length === 0) return null;
    const candidates: AttributionCandidate[] = [];
    for (const excursion of excursions) {
        candidates.push({
            ...excursion,
            locationIds: await deps.locationIdsOf(excursion.shellyID)
        });
    }
    return attributeLeak({leakLocationIds, candidates});
}
