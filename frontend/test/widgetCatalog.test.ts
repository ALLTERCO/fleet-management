// One focused test per exported helper / table — describes the rule, not
// the function symbol, so failures point at the broken behaviour.

import {describe, expect, it} from 'vitest';
import {
    ACCENT_RGB,
    COMPACT_ENTITY_TYPES,
    DEFAULT_ACCENT_RGB,
    defaultSizeForEntityType,
    rgbForAccent,
    WIDGET_CATEGORIES,
    WIDGET_SIZES
} from '@/helpers/widgetCatalog';

describe('WIDGET_CATEGORIES — top-level catalog tabs', () => {
    it('exposes every category id so the UI can iterate without missing one', () => {
        const ids = WIDGET_CATEGORIES.map((c) => c.id);
        expect(ids).toEqual([
            'devices',
            'groups',
            'locations',
            'tags',
            'actions',
            'widgets'
        ]);
    });

    it('attaches an icon to every category so the rail is never bare', () => {
        for (const c of WIDGET_CATEGORIES) {
            expect(c.icon).toMatch(/^fas /);
        }
    });
});

describe('WIDGET_SIZES — three card sizes available', () => {
    it('lists exactly small / wide / large because the grid does not offer more', () => {
        expect(WIDGET_SIZES.map((s) => s.value)).toEqual(['1x1', '2x1', '2x2']);
    });
});

describe('defaultSizeForEntityType — initial card size by entity type', () => {
    it('defaults to 1×1 when no type is given because tiny is safer than wide', () => {
        expect(defaultSizeForEntityType(undefined)).toBe('1x1');
    });

    it('returns 1×1 for compact types so simple toggles get a small tile', () => {
        expect(defaultSizeForEntityType('switch')).toBe('1x1');
        expect(defaultSizeForEntityType('temperature')).toBe('1x1');
    });

    it('returns 2×1 for non-compact types so rich previews have room', () => {
        expect(defaultSizeForEntityType('em')).toBe('2x1');
        expect(defaultSizeForEntityType('cover')).toBe('2x1');
    });
});

describe('rgbForAccent — accent-name to RGB triplet', () => {
    it('returns the matching triplet for every known accent', () => {
        expect(rgbForAccent('blue')).toBe(ACCENT_RGB.blue);
        expect(rgbForAccent('amber')).toBe(ACCENT_RGB.amber);
    });

    it('falls back to the brand blue for an unknown name so the card never goes black', () => {
        expect(rgbForAccent('chartreuse')).toBe(DEFAULT_ACCENT_RGB);
    });

    it('falls back to the brand blue for undefined input because callers may not have computed an accent', () => {
        expect(rgbForAccent(undefined)).toBe(DEFAULT_ACCENT_RGB);
    });
});

describe('COMPACT_ENTITY_TYPES — discoverable set', () => {
    it('includes every type that should default to a small tile', () => {
        expect(COMPACT_ENTITY_TYPES.has('switch')).toBe(true);
        expect(COMPACT_ENTITY_TYPES.has('temperature')).toBe(true);
        expect(COMPACT_ENTITY_TYPES.has('boolean')).toBe(true);
    });

    it('excludes energy / cover types because those tiles need 2×1 to read', () => {
        expect(COMPACT_ENTITY_TYPES.has('em')).toBe(false);
        expect(COMPACT_ENTITY_TYPES.has('cover')).toBe(false);
    });
});
