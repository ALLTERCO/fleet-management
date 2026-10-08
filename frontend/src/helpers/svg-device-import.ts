// Turns the device markers drawn on an uploaded SVG floor plan into
// placements — but only ones a user has confirmed.
//
// A layer labelled "Light1" is a drawing annotation, not a device id. So
// nothing here places a device on its own: it proposes a mapping when the
// evidence is unambiguous, leaves it blank when it is not, and the caller
// persists only what the user accepted.

import {buildPlacement} from '@/helpers/floor-plan-placement';
import type {SvgDevice} from '@/helpers/svg-floorplan';
import type {DevicePlacementMap} from '@/types/floor-plan';

/** A real device assigned to this location — the only thing a marker may be
 *  mapped onto. */
export interface ImportTargetDevice {
    /** Key the placement map is stored under (see floorPlanPlacementId). */
    readonly placementId: string;
    readonly label: string;
    /** Component types the device itself reports — `switch`, `light`,
     *  `cover`. Evidence for a category match. Read from what the backend
     *  sends; there is deliberately no local table of what a model "is". */
    readonly componentTypes?: readonly string[];
}

/** Why a device was proposed. Shown to the user so the suggestion can be
 *  judged rather than trusted. */
export type SuggestionEvidence = 'name' | 'component';

export interface ImportCandidate {
    /** Unique within one extraction — marker labels can repeat. */
    readonly key: string;
    readonly label: string;
    readonly category: string;
    readonly x: number;
    readonly y: number;
    /** Pre-filled ONLY on unambiguous evidence for a device that has no pin
     *  yet. null means the user has to pick, or leave it unplaced. */
    readonly suggestedPlacementId: string | null;
    readonly evidence: SuggestionEvidence | null;
    /** The evidence pointed at this device, but it is already on the plan.
     *  Surfaced so the user can choose to move it — never pre-filled,
     *  because an import must not move a pin somebody placed by hand. */
    readonly placedMatchId: string | null;
}

/** Two markers mapped to one device. The UI blocks this; the builder refuses
 *  it rather than silently dropping one, so a corrupt map is never written. */
export class DuplicateImportTargetError extends Error {
    readonly placementId: string;

    constructor(placementId: string) {
        super(`Device ${placementId} is selected for more than one marker`);
        this.name = 'DuplicateImportTargetError';
        this.placementId = placementId;
    }
}

export interface ImportOutcome {
    readonly placements: DevicePlacementMap;
    /** Devices that gained a pin. */
    readonly addedIds: readonly string[];
    /** Devices that already had a pin and were moved to the marker. */
    readonly movedIds: readonly string[];
}

export function buildImportCandidates(input: {
    readonly markers: readonly SvgDevice[];
    readonly devices: readonly ImportTargetDevice[];
    readonly existing: DevicePlacementMap;
}): ImportCandidate[] {
    const {markers, devices, existing} = input;
    const labelCounts = countBy(markers, (m) => normalize(m.label));
    const categoryCounts = countBy(markers, (m) => normalize(m.category));
    // A device may back at most one suggestion, so N markers never all
    // pre-fill the same device.
    const claimed = new Set<string>();
    const out: ImportCandidate[] = [];

    for (const [index, marker] of markers.entries()) {
        const match = findUnambiguousMatch({
            marker,
            devices,
            labelCounts,
            categoryCounts
        });
        const alreadyPlaced =
            match !== null && existing[match.device.placementId] !== undefined;
        const free =
            match !== null &&
            !alreadyPlaced &&
            !claimed.has(match.device.placementId);
        if (free && match) claimed.add(match.device.placementId);
        out.push({
            key: `${index}:${marker.label}`,
            label: marker.label,
            category: marker.category,
            x: marker.x,
            y: marker.y,
            suggestedPlacementId: free ? match.device.placementId : null,
            evidence: match?.evidence ?? null,
            placedMatchId: alreadyPlaced ? match.device.placementId : null
        });
    }
    return out;
}

/** Merge confirmed mappings into the saved placements.
 *
 *  Only the selected devices are touched. Every other entry — including
 *  devices this drawing knows nothing about — is passed through byte for
 *  byte, and no entry is ever removed. */
export function applyImportSelections(input: {
    readonly existing: DevicePlacementMap;
    readonly candidates: readonly ImportCandidate[];
    /** candidate key -> placementId. A key that is missing, or maps to an
     *  empty string, is not placed: an unmapped marker is not a device. */
    readonly selections: Readonly<Record<string, string>>;
}): ImportOutcome {
    const {existing, candidates, selections} = input;
    const placements: DevicePlacementMap = {...existing};
    const addedIds: string[] = [];
    const movedIds: string[] = [];
    const seen = new Set<string>();

    for (const candidate of candidates) {
        const placementId = selections[candidate.key];
        if (!placementId) continue;
        if (seen.has(placementId)) {
            throw new DuplicateImportTargetError(placementId);
        }
        seen.add(placementId);
        const previous = existing[placementId];
        placements[placementId] = buildPlacement({
            existing: previous,
            point: {x: candidate.x, y: candidate.y}
        });
        if (previous === undefined) addedIds.push(placementId);
        else movedIds.push(placementId);
    }
    return {placements, addedIds, movedIds};
}

/** Devices a marker may be mapped onto, best guesses first, so the picker
 *  puts plausible options at the top without ever choosing for the user. */
export function rankDevicesForMarker(input: {
    readonly marker: Pick<SvgDevice, 'label' | 'category'>;
    readonly devices: readonly ImportTargetDevice[];
}): ImportTargetDevice[] {
    const {marker, devices} = input;
    return [...devices].sort((a, b) => {
        const rank = affinity(marker, b) - affinity(marker, a);
        return rank !== 0 ? rank : a.label.localeCompare(b.label);
    });
}

// ── matching ───────────────────────────────────────────────────────────

interface EvidenceMatch {
    readonly device: ImportTargetDevice;
    readonly evidence: SuggestionEvidence;
}

// A suggestion is offered only when exactly one device fits AND exactly one
// marker asks for it. Anything else is a guess between equals, and guessing
// is what this feature exists to avoid.
function findUnambiguousMatch(input: {
    readonly marker: SvgDevice;
    readonly devices: readonly ImportTargetDevice[];
    readonly labelCounts: ReadonlyMap<string, number>;
    readonly categoryCounts: ReadonlyMap<string, number>;
}): EvidenceMatch | null {
    const {marker, devices, labelCounts, categoryCounts} = input;

    const byName = devices.filter((d) => matchesName(marker, d));
    if (byName.length === 1 && labelCounts.get(normalize(marker.label)) === 1) {
        return {device: byName[0], evidence: 'name'};
    }

    const byComponent = devices.filter((d) => matchesCategory(marker, d));
    const categoryMarkers = categoryCounts.get(normalize(marker.category)) ?? 0;
    if (byComponent.length === 1 && categoryMarkers === 1) {
        return {device: byComponent[0], evidence: 'component'};
    }
    return null;
}

function matchesName(
    marker: Pick<SvgDevice, 'label'>,
    device: ImportTargetDevice
): boolean {
    const label = normalize(marker.label);
    return label.length > 0 && normalize(device.label) === label;
}

// The drawing's category names a component type the device reports. Plural
// category layers ("Lights") are matched against the singular type by
// dropping one trailing "s" — the only spelling liberty taken. Anything
// looser risks a confident wrong answer, which is worse than no answer.
function matchesCategory(
    marker: Pick<SvgDevice, 'category'>,
    device: ImportTargetDevice
): boolean {
    const category = normalize(marker.category);
    if (category.length === 0) return false;
    const singular = category.endsWith('s') ? category.slice(0, -1) : category;
    return (device.componentTypes ?? []).some((type) => {
        const t = normalize(type);
        return t === category || t === singular;
    });
}

function affinity(
    marker: Pick<SvgDevice, 'label' | 'category'>,
    device: ImportTargetDevice
): number {
    if (matchesName(marker, device)) return 2;
    if (matchesCategory(marker, device)) return 1;
    return 0;
}

function normalize(value: string): string {
    return value.trim().toLowerCase();
}

function countBy<T>(
    items: readonly T[],
    key: (item: T) => string
): Map<string, number> {
    const counts = new Map<string, number>();
    for (const item of items) {
        const k = key(item);
        counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return counts;
}
