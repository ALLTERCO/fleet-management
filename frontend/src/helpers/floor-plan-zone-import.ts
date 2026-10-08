// Turns proposed zone regions from an imported plan into saved zones — but
// only ones a user named and confirmed.
//
// Same rule as the device-marker import: a colour is evidence, not a decision.
// A blue blob on an architect's test fit means "PRODUCT OWNERS" to the person
// who drew it and nothing at all to us. Nothing here creates a zone on its
// own; an unconfirmed candidate is not persisted and leaves no trace.

import type {ZoneCandidate} from '@/helpers/floor-plan-geometry-resolver';
import type {ZoneShape} from '@/types/floor-plan';

/** A candidate the user accepted, with the name they gave it. */
export interface ZoneConfirmation {
    /** ZoneCandidate.key. */
    readonly key: string;
    readonly name: string;
    /** Override the drawing's colour. Omit to keep it. */
    readonly color?: string;
}

/** A confirmation naming two zones the same thing. Refused rather than
 *  silently merged: two rooms called "Meeting" are indistinguishable
 *  afterwards, and the user can still choose to merge them deliberately. */
export class DuplicateZoneNameError extends Error {
    readonly name: string;

    constructor(name: string) {
        super(`Zone name "${name}" is used more than once`);
        this.name = 'DuplicateZoneNameError';
    }
}

/** Fewer points than this is not a region. Three is the minimum ring; the
 *  resolver already drops degenerate shapes, this is the last gate before
 *  something is written. */
const MIN_RING_POINTS = 3;

export interface ZoneImportOutcome {
    readonly zones: readonly ZoneShape[];
    readonly addedIds: readonly string[];
}

/** Merge confirmed candidates into the saved zones.
 *
 *  Existing zones pass through untouched and none is ever removed — an import
 *  adds, it does not reconcile. A key with no confirmation, or a confirmation
 *  with a blank name, is dropped: an unnamed region is not a zone. */
export function applyZoneConfirmations(input: {
    readonly existing: readonly ZoneShape[];
    readonly candidates: readonly ZoneCandidate[];
    readonly confirmations: readonly ZoneConfirmation[];
}): ZoneImportOutcome {
    const {existing, candidates, confirmations} = input;
    const byKey = new Map(candidates.map((c) => [c.key, c]));
    const takenNames = new Set(
        existing.map((z) => z.name.trim().toLowerCase())
    );
    const zones: ZoneShape[] = [...existing];
    const addedIds: string[] = [];

    for (const confirmation of confirmations) {
        const candidate = byKey.get(confirmation.key);
        const name = confirmation.name.trim();
        if (!candidate || name.length === 0) continue;
        if (candidate.points.length < MIN_RING_POINTS) continue;

        const key = name.toLowerCase();
        if (takenNames.has(key)) throw new DuplicateZoneNameError(name);
        takenNames.add(key);

        const id = zoneId(candidate.key);
        zones.push({
            id,
            name,
            color: confirmation.color ?? candidate.color,
            points: candidate.points.map((p) => ({x: p.x, y: p.y}))
        });
        addedIds.push(id);
    }
    return {zones, addedIds};
}

/** Candidates grouped by the colour that proposed them. One colour is one
 *  team on a real test fit, so this is the unit a user actually names —
 *  "these five regions are STUDIO" rather than five separate decisions. */
export interface ZoneCandidateGroup {
    readonly color: string;
    readonly candidates: readonly ZoneCandidate[];
    /** Combined share of the plan, 0..1. Biggest groups are the real rooms. */
    readonly areaShare: number;
    /** Set only when every member agrees on a name the drawing supplied. */
    readonly suggestedName: string | null;
}

export function groupZoneCandidates(
    candidates: readonly ZoneCandidate[]
): ZoneCandidateGroup[] {
    const groups = new Map<string, ZoneCandidate[]>();
    for (const candidate of candidates) {
        const bucket = groups.get(candidate.color);
        if (bucket) bucket.push(candidate);
        else groups.set(candidate.color, [candidate]);
    }
    return [...groups.entries()]
        .map(([color, members]) => ({
            color,
            candidates: members,
            areaShare: members.reduce((sum, c) => sum + c.areaShare, 0),
            suggestedName: sharedName(members)
        }))
        .sort((a, b) => b.areaShare - a.areaShare);
}

function sharedName(members: readonly ZoneCandidate[]): string | null {
    const first = members[0]?.suggestedName ?? null;
    if (!first) return null;
    return members.every((m) => m.suggestedName === first) ? first : null;
}

/** The confirmations one named group turns into — one per region it covers.
 *
 *  A group is what the user names, but the drawing really does hold several
 *  separate regions for it, and two zones may not share a name. So a
 *  multi-part group is numbered: "Studio" over three regions saves as
 *  "Studio 1", "Studio 2", "Studio 3". A single-part group keeps the name
 *  exactly as typed. The UI shows the result before anything is written —
 *  numbering the user cannot see is numbering the user did not agree to.
 *
 *  A blank name confirms nothing: an unnamed region is not a zone. */
export function zoneConfirmationsForGroup(input: {
    readonly group: ZoneCandidateGroup;
    readonly name: string;
    /** Override the drawing's colour for every part. */
    readonly color?: string;
}): ZoneConfirmation[] {
    const name = input.name.trim();
    if (name.length === 0) return [];
    const parts = input.group.candidates;
    return parts.map((candidate, index) => ({
        key: candidate.key,
        name: parts.length === 1 ? name : `${name} ${index + 1}`,
        ...(input.color === undefined ? {} : {color: input.color})
    }));
}

// Stable enough to be idempotent within one import, unique enough not to
// collide with a hand-drawn zone.
function zoneId(candidateKey: string): string {
    return `import-${candidateKey.replace(/[^a-z0-9]+/gi, '-')}`;
}
