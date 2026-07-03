// Tests the reserved-keys SoT helper. RESERVED_METADATA_KEYS drives both
// the picker form's filtering and the modal's load-time extraction —
// drift between those two would silently leak system fields into the
// user-editable bag (or hide user fields). Pin the contract here.

import {describe, expect, it} from 'vitest';
import {
    extractKindMetadata,
    isReservedMetadataKey,
    RESERVED_METADATA_KEYS
} from '@/helpers/groupMetadataKeys';

describe('RESERVED_METADATA_KEYS', () => {
    it('contains policy + configProfile', () => {
        expect(RESERVED_METADATA_KEYS.has('policy')).toBe(true);
        expect(RESERVED_METADATA_KEYS.has('configProfile')).toBe(true);
    });

    it('size is locked — adding a reserved key requires updating callers', () => {
        // If this changes, audit every consumer of extractKindMetadata
        // and the metadata-form's invisibleFields computed.
        expect(RESERVED_METADATA_KEYS.size).toBe(2);
    });
});

describe('isReservedMetadataKey', () => {
    it('returns true for reserved keys', () => {
        expect(isReservedMetadataKey('policy')).toBe(true);
        expect(isReservedMetadataKey('configProfile')).toBe(true);
    });

    it('returns false for ordinary keys', () => {
        expect(isReservedMetadataKey('voltage')).toBe(false);
        expect(isReservedMetadataKey('legacyNotes')).toBe(false);
    });
});

describe('extractKindMetadata', () => {
    it('returns {} for null', () => {
        expect(extractKindMetadata(null)).toEqual({});
    });

    it('returns {} for undefined', () => {
        expect(extractKindMetadata(undefined)).toEqual({});
    });

    it('returns {} for primitives', () => {
        expect(extractKindMetadata('hello')).toEqual({});
        expect(extractKindMetadata(42)).toEqual({});
        expect(extractKindMetadata(true)).toEqual({});
    });

    it('returns {} for arrays (not a metadata-shape record)', () => {
        expect(extractKindMetadata([1, 2, 3])).toEqual({});
    });

    it('strips policy and configProfile keys', () => {
        const out = extractKindMetadata({
            voltage: 240,
            policy: {severityFloor: 'warning'},
            configProfile: 'plant-default',
            rated_amps: 16
        });
        expect(out).toEqual({voltage: 240, rated_amps: 16});
    });

    it('preserves every non-reserved key including falsy values', () => {
        const out = extractKindMetadata({
            count: 0,
            enabled: false,
            label: '',
            notes: null
        });
        expect(out).toEqual({
            count: 0,
            enabled: false,
            label: '',
            notes: null
        });
    });

    it('returns a fresh object — caller can mutate without aliasing input', () => {
        const input = {voltage: 240};
        const out = extractKindMetadata(input);
        out.voltage = 999;
        expect(input.voltage).toBe(240);
    });
});
