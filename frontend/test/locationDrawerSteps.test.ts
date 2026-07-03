// Drawer step rules + field-level validators. One test per behaviour.

import {describe, expect, it} from 'vitest';
import {
    clampStepForKind,
    isPossibleWhat3Words,
    isValidLatitude,
    isValidLongitude,
    kindRequiresAddress,
    kindRequiresParent,
    MAX_NOTES_LENGTH,
    MAX_TAG_LENGTH,
    MAX_TAGS_PER_LOCATION,
    nameContentErrorMessage,
    notesErrorMessage,
    tagRejectionReason,
    visibleStepsForKind
} from '@/helpers/location-drawer-steps';

describe('kindRequiresAddress — which kinds need an address step', () => {
    it('flags Site as needing an address because a site is a geographic place', () => {
        expect(kindRequiresAddress('site')).toBe(true);
    });

    it('flags Building as needing an address because a building has its own street', () => {
        expect(kindRequiresAddress('building')).toBe(true);
    });

    it('clears Floor of address requirement because floors inherit from buildings', () => {
        expect(kindRequiresAddress('floor')).toBe(false);
    });

    it('clears Room of address requirement because rooms inherit from above', () => {
        expect(kindRequiresAddress('room')).toBe(false);
    });
});

describe('kindRequiresParent — which kinds must be parented', () => {
    it('requires a parent for Floor because a floor has no meaning standalone', () => {
        expect(kindRequiresParent('floor')).toBe(true);
    });

    it('requires a parent for Room because a room belongs to a floor', () => {
        expect(kindRequiresParent('room')).toBe(true);
    });

    it('does not require a parent for Site because sites are roots', () => {
        expect(kindRequiresParent('site')).toBe(false);
    });
});

describe('visibleStepsForKind — wizard layout reacts to kind', () => {
    it('shows three steps for Site so address can be captured', () => {
        const steps = visibleStepsForKind('site');
        expect(steps.map((s) => s.id)).toEqual([1, 2, 3]);
    });

    it('hides step 2 for Room so users are not asked for an address they will inherit', () => {
        const steps = visibleStepsForKind('room');
        expect(steps.map((s) => s.id)).toEqual([1, 3]);
    });
});

describe('clampStepForKind — caller-requested step is bounded to what exists', () => {
    it('passes through a known step so callers can open mid-wizard intentionally', () => {
        expect(clampStepForKind(2, 'site')).toBe(2);
    });

    it('redirects a request for step 2 on Floor to step 3 because step 2 is hidden for that kind', () => {
        expect(clampStepForKind(2, 'floor')).toBe(3);
    });

    it('falls back to step 1 for an out-of-range request so the drawer always opens somewhere valid', () => {
        expect(clampStepForKind(99, 'site')).toBe(1);
    });
});

describe('isPossibleWhat3Words — client-side format lint only', () => {
    it('passes empty input because the field is optional', () => {
        expect(isPossibleWhat3Words('')).toBe(true);
    });

    it('accepts a well-formed three-word address so users can type it without ceremony', () => {
        expect(isPossibleWhat3Words('filled.count.soap')).toBe(true);
    });

    it('accepts the same three-word address with the official /// prefix', () => {
        expect(isPossibleWhat3Words('///filled.count.soap')).toBe(true);
    });

    it('rejects two-word inputs because w3w always has exactly three words', () => {
        expect(isPossibleWhat3Words('filled.count')).toBe(false);
    });

    it('rejects inputs containing digits because the dictionary is purely alphabetic', () => {
        expect(isPossibleWhat3Words('filled.count.soap1')).toBe(false);
    });
});

describe('isValidLatitude — coordinate range guard', () => {
    it('accepts 0 because the equator is a valid latitude', () => {
        expect(isValidLatitude(0)).toBe(true);
    });

    it('accepts the southern extreme because -90 is the south pole', () => {
        expect(isValidLatitude(-90)).toBe(true);
    });

    it('accepts the northern extreme because 90 is the north pole', () => {
        expect(isValidLatitude(90)).toBe(true);
    });

    it('rejects values past the north pole because there is no such latitude on Earth', () => {
        expect(isValidLatitude(90.0001)).toBe(false);
    });

    it('rejects NaN because typing garbage should not be treated as a valid latitude', () => {
        expect(isValidLatitude(Number.NaN)).toBe(false);
    });
});

describe('isValidLongitude — coordinate range guard', () => {
    it('accepts the prime meridian because 0 is a valid longitude', () => {
        expect(isValidLongitude(0)).toBe(true);
    });

    it('accepts the antimeridian extremes because ±180 are the dateline', () => {
        expect(isValidLongitude(180)).toBe(true);
        expect(isValidLongitude(-180)).toBe(true);
    });

    it('rejects values past the antimeridian because they wrap into nonsense', () => {
        expect(isValidLongitude(180.0001)).toBe(false);
    });

    it('rejects infinity because no real longitude is unbounded', () => {
        expect(isValidLongitude(Number.POSITIVE_INFINITY)).toBe(false);
    });
});

describe('tagRejectionReason — guardrails on the chip input', () => {
    it('returns empty for a blank candidate so the form blocks the add', () => {
        expect(tagRejectionReason({candidate: '   ', existing: []})).toBe(
            'empty'
        );
    });

    it('returns length when the trimmed value exceeds MAX_TAG_LENGTH so we never store enormous tags', () => {
        const long = 'x'.repeat(MAX_TAG_LENGTH + 1);
        expect(tagRejectionReason({candidate: long, existing: []})).toBe(
            'length'
        );
    });

    it('returns format for a tag with spaces because tags must be slug-style', () => {
        expect(
            tagRejectionReason({candidate: 'with space', existing: []})
        ).toBe('format');
    });

    it('returns duplicate when the candidate is already in the existing list because tags must be unique', () => {
        expect(
            tagRejectionReason({candidate: 'plant', existing: ['plant']})
        ).toBe('duplicate');
    });

    it('returns count when the existing list is at the maximum because we cap how many fit per location', () => {
        const full = Array.from(
            {length: MAX_TAGS_PER_LOCATION},
            (_, i) => `t${i}`
        );
        expect(tagRejectionReason({candidate: 'extra', existing: full})).toBe(
            'count'
        );
    });

    it('returns null for a clean candidate so the caller can add it', () => {
        expect(
            tagRejectionReason({candidate: 'plant', existing: []})
        ).toBeNull();
    });
});

describe('notesErrorMessage — bounded notes', () => {
    it('passes a normal note because it is well within MAX_NOTES_LENGTH', () => {
        expect(notesErrorMessage('hello world')).toBe('');
    });

    it('flags a note longer than MAX_NOTES_LENGTH so we cannot stuff JSONB with novels', () => {
        const huge = 'a'.repeat(MAX_NOTES_LENGTH + 1);
        expect(notesErrorMessage(huge)).toContain(String(MAX_NOTES_LENGTH));
    });
});

describe('nameContentErrorMessage — printable + trimmed', () => {
    it('passes a clean name so normal use does not get error-noise', () => {
        expect(nameContentErrorMessage('Paris HQ')).toBe('');
    });

    it('flags leading whitespace because it breaks sort order silently', () => {
        expect(nameContentErrorMessage('  Paris')).toContain('whitespace');
    });

    it('flags trailing whitespace for the same reason', () => {
        expect(nameContentErrorMessage('Paris  ')).toContain('whitespace');
    });

    it('flags a name containing a tab because invisible chars break search', () => {
        expect(nameContentErrorMessage('a\tb')).toContain(
            'cannot be displayed'
        );
    });
});
