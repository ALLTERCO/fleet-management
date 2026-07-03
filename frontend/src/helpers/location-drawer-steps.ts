// Pure logic for the LocationEntryDrawer wizard. Owns step shape, kind→step
// rules, and field-level validation so the component template stays slim.

import type {LocationKind} from '@api/location';

export type GeoPrecision = 'geocoded' | 'confirmed' | 'manual';

export interface GeoState {
    lat: number;
    lng: number;
}

export interface WizardStep {
    id: number;
    label: string;
    optional: boolean;
    skipForKindWithoutAddress?: boolean;
}

export const WIZARD_STEPS: ReadonlyArray<WizardStep> = [
    {id: 1, label: 'Basics', optional: false},
    {
        id: 2,
        label: 'Place on map',
        optional: false,
        skipForKindWithoutAddress: true
    },
    {id: 3, label: 'Details', optional: true}
];

// Single source of truth for which kinds need an address step. The drawer's
// segmented control and edit-step routing both derive from this.
const KINDS_REQUIRING_ADDRESS: ReadonlySet<LocationKind> = new Set([
    'site',
    'building'
]);
const KINDS_REQUIRING_PARENT: ReadonlySet<LocationKind> = new Set([
    'floor',
    'room'
]);

// Answer — does this kind get the place-on-map wizard step?
export function kindRequiresAddress(kind: LocationKind): boolean {
    return KINDS_REQUIRING_ADDRESS.has(kind);
}

// Answer — must this kind be parented by another location?
export function kindRequiresParent(kind: LocationKind): boolean {
    return KINDS_REQUIRING_PARENT.has(kind);
}

// Answer — visible steps for the kind. Step 2 disappears for floor/room.
export function visibleStepsForKind(kind: LocationKind): WizardStep[] {
    return WIZARD_STEPS.filter(
        (s) => !(s.skipForKindWithoutAddress && !kindRequiresAddress(kind))
    );
}

// Answer — clamp a requested step into the steps that actually exist for
// this kind. Used when callers ask to open on a specific step.
export function clampStepForKind(
    requestedStep: number,
    kind: LocationKind
): number {
    // Redirect step 2 to 3 for kinds without an address step first, so a
    // caller asking "open on the address step" lands somewhere sensible
    // even when that step is hidden for this kind.
    if (requestedStep === 2 && !kindRequiresAddress(kind)) return 3;
    const ids = visibleStepsForKind(kind).map((s) => s.id);
    if (ids.includes(requestedStep)) return requestedStep;
    return ids[0] ?? 1;
}

// what3words is "three lowercase words joined by dots", with an optional ///
// prefix per their UX guidelines. Definitive resolution requires their API;
// this is the cheap isPossible3wa client lint.
const W3W_PATTERN = /^(?:\/\/\/)?[a-z]{3,}\.[a-z]{3,}\.[a-z]{3,}$/i;

// Answer — does the input *look like* a what3words address? Empty input
// passes (the field is optional); non-empty must match the pattern.
export function isPossibleWhat3Words(input: string): boolean {
    const trimmed = input.trim();
    if (!trimmed) return true;
    return W3W_PATTERN.test(trimmed);
}

// Answer — is this a valid latitude (-90..90, finite)?
export function isValidLatitude(value: number): boolean {
    return Number.isFinite(value) && value >= -90 && value <= 90;
}

// Answer — is this a valid longitude (-180..180, finite)?
export function isValidLongitude(value: number): boolean {
    return Number.isFinite(value) && value >= -180 && value <= 180;
}

// Tag input limits. Tags are typed metadata used in queries — they need
// guardrails so a stray paste cannot stuff thousands of them into kindFields.
export const MAX_TAGS_PER_LOCATION = 32;
export const MAX_TAG_LENGTH = 32;
export const TAG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

export type TagRejectionReason =
    | 'empty'
    | 'length'
    | 'format'
    | 'duplicate'
    | 'count';

// Answer — can this candidate be added to the existing tag list?
export function tagRejectionReason(args: {
    candidate: string;
    existing: ReadonlyArray<string>;
}): TagRejectionReason | null {
    const t = args.candidate.trim();
    if (!t) return 'empty';
    if (t.length > MAX_TAG_LENGTH) return 'length';
    if (!TAG_PATTERN.test(t)) return 'format';
    if (args.existing.includes(t)) return 'duplicate';
    if (args.existing.length >= MAX_TAGS_PER_LOCATION) return 'count';
    return null;
}

// Notes — bounded so the kindFields JSON stays manageable.
export const MAX_NOTES_LENGTH = 2000;

// Answer — message describing why the notes are invalid, or '' if fine.
export function notesErrorMessage(value: string): string {
    if (value.length > MAX_NOTES_LENGTH) {
        return `Notes are limited to ${MAX_NOTES_LENGTH} characters.`;
    }
    return '';
}

// Answer — does a name still have problems after trimming? Returns a short
// message describing the first problem, or '' if it's clean.
export function nameContentErrorMessage(value: string): string {
    if (hasControlChar(value)) {
        return 'Name contains characters that cannot be displayed.';
    }
    if (value !== value.trim()) {
        return 'Name has leading or trailing whitespace.';
    }
    return '';
}

// Answer — does the string contain any C0 control char (0x00-0x1F) or DEL (0x7F)?
function hasControlChar(value: string): boolean {
    for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code < 0x20 || code === 0x7f) return true;
    }
    return false;
}
