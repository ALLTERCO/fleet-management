import {describe, expect, it} from 'vitest';
import {getLogoFromModel, modelForCard} from '@/helpers/device';

// A waiting-room device often has no sys.device.model (the sanitized ingress
// snapshot drops it), but the shellyID prefix always identifies the model.
describe('modelForCard', () => {
    it('uses the explicit model when present', () => {
        expect(modelForCard('shelly2pmg3-aabbcc', 'S3SW-002P16EU')).toBe(
            'S3SW-002P16EU'
        );
    });

    it('derives the model from the shellyID prefix when model is missing', () => {
        expect(modelForCard('shellyplus2pm-aabbcc', '')).toBe('SPSW-202PE16EU');
    });

    it('trims and prefers an explicit model over the prefix', () => {
        expect(modelForCard('shellyplus2pm-aabbcc', '  S3SW-002P16EU ')).toBe(
            'S3SW-002P16EU'
        );
    });

    it('returns empty when neither model nor a known prefix is available', () => {
        expect(modelForCard('totally-unknown-xyz', '')).toBe('');
    });

    // Regression: a waiting-room entry with no sys.device.model must still
    // resolve a real device picture (via the shellyID prefix), never blank.
    it('a model-less entry with a known prefix resolves a device picture', () => {
        const url = getLogoFromModel(modelForCard('shellyplus2pm-aabbcc', ''));
        expect(url).toMatch(/^\/images\/devices\/.+\.png$/); // local, not blank
    });
});
