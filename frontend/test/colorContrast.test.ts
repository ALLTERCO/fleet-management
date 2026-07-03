import {describe, expect, it} from 'vitest';
import {
    isHexColor,
    readableForeground,
    relativeLuminance
} from '@/helpers/colorContrast';

describe('isHexColor — three accepted hex shapes', () => {
    it('accepts #rgb short form so admin paste of #fff still validates', () => {
        expect(isHexColor('#fff')).toBe(true);
    });

    it('accepts #rrggbb full form because it is the canonical hex shape', () => {
        expect(isHexColor('#1f73d6')).toBe(true);
    });

    it('accepts #rrggbbaa alpha form so transparent admin colors pass', () => {
        expect(isHexColor('#1f73d680')).toBe(true);
    });

    it('rejects rgb() functional notation because the parser is hex-only', () => {
        expect(isHexColor('rgb(255,0,0)')).toBe(false);
    });

    it('rejects named colors because Zitadel forwards them but luminance cannot read them', () => {
        expect(isHexColor('red')).toBe(false);
    });
});

describe('relativeLuminance — WCAG luminance with safe fallback', () => {
    it('returns 0 for pure black because black has no luminance', () => {
        expect(relativeLuminance('#000000')).toBe(0);
    });

    it('returns 1 for pure white because white is at full luminance', () => {
        expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
    });

    it('returns mid-luminance for an unparseable color so callers do not branch on null', () => {
        expect(relativeLuminance('whatever')).toBe(0.5);
    });

    it('treats #rgb as if it were #rrggbb because that is how CSS does', () => {
        expect(relativeLuminance('#fff')).toBeCloseTo(
            relativeLuminance('#ffffff'),
            5
        );
    });
});

describe('readableForeground — pick text color against a background', () => {
    it('returns dark text on a light background so contrast is readable', () => {
        expect(readableForeground('#ffffff')).toBe('#0f172a');
    });

    it('returns light text on a dark background', () => {
        expect(readableForeground('#000000')).toBe('#ffffff');
    });

    it('respects custom light/dark overrides so callers can hit brand tokens', () => {
        const fg = readableForeground('#000000', {light: '#fafafa', dark: '#111'});
        expect(fg).toBe('#fafafa');
    });

    it('falls back to light text when the background does not parse so it never looks broken', () => {
        // Unparseable → luminance returns 0.5 (the threshold), so the
        // function picks the *light* foreground for the not-strictly-greater
        // branch.
        expect(readableForeground('garbage')).toBe('#ffffff');
    });
});
