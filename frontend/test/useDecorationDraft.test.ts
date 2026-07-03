import {describe, expect, it} from 'vitest';
import type {VisualAsset} from '@/api/assetRpc';
import {useDecorationDraft} from '@/composables/useDecorationDraft';

function asset(id: string): VisualAsset {
    return {
        id,
        url: `/api/assets/${id}`,
        sha256: 'x'.repeat(64),
        contentType: 'image/png',
        sizeBytes: 1,
        label: null,
        uploadedBy: null,
        context: 'general',
        created: '2026-01-01T00:00:00Z'
    };
}

describe('useDecorationDraft', () => {
    it('begins with nothing selected', () => {
        const d = useDecorationDraft();
        expect(d.icon.value).toBe(null);
        expect(d.accent.value).toBe(null);
        expect(d.imageAssetId.value).toBe(null);
        expect(d.hasDecoration.value).toBe(false);
    });

    it('keeps an icon and its accent together', () => {
        const d = useDecorationDraft();
        d.onSelectIcon({icon: 'mdi-lamp', accent: 'blue'});
        expect(d.icon.value).toBe('mdi-lamp');
        expect(d.accent.value).toBe('blue');
        expect(d.hasDecoration.value).toBe(true);
    });

    it('drops an existing image when an icon is chosen', () => {
        const d = useDecorationDraft();
        d.onSelectAsset(asset('img-1'));
        d.onSelectIcon({icon: 'mdi-fan', accent: null});
        expect(d.imageAssetId.value).toBe(null);
        expect(d.icon.value).toBe('mdi-fan');
    });

    it('drops an existing icon and accent when an image is chosen', () => {
        const d = useDecorationDraft();
        d.onSelectIcon({icon: 'mdi-fan', accent: 'red'});
        d.onSelectAsset(asset('img-9'));
        expect(d.imageAssetId.value).toBe('img-9');
        expect(d.icon.value).toBe(null);
        expect(d.accent.value).toBe(null);
    });

    it('does not treat a lone accent as a decoration', () => {
        const d = useDecorationDraft();
        d.reset({accent: 'blue'});
        expect(d.accent.value).toBe('blue');
        expect(d.hasDecoration.value).toBe(false);
    });

    it('wipes every field when cleared', () => {
        const d = useDecorationDraft();
        d.onSelectIcon({icon: 'mdi-lamp', accent: 'amber'});
        d.onClear();
        expect(d.icon.value).toBe(null);
        expect(d.accent.value).toBe(null);
        expect(d.imageAssetId.value).toBe(null);
        expect(d.hasDecoration.value).toBe(false);
    });

    it('hydrates from a stored value', () => {
        const d = useDecorationDraft();
        d.reset({icon: 'mdi-cube', accent: 'emerald', imageAssetId: null});
        expect(d.icon.value).toBe('mdi-cube');
        expect(d.accent.value).toBe('emerald');
        expect(d.hasDecoration.value).toBe(true);
    });
});
