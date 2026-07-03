import {describe, expect, it, vi} from 'vitest';
import {effectScope} from 'vue';
import {useTagVisual} from '@/composables/useTagVisual';

vi.mock('@/helpers/deviceLogo', () => ({
    resolveAssetSrc: (id: string) => `/assets/${id}`
}));

type Tag = {icon?: string; imageAssetId?: string | null};

function run(tag: Tag) {
    const scope = effectScope();
    const result = scope.run(() => useTagVisual(() => tag as never));
    if (!result) throw new Error('composable failed to run');
    return result;
}

describe('useTagVisual', () => {
    it('collapses when the tag has no image and no glyph', () => {
        const v = run({});
        expect(v.hasImage.value).toBe(false);
        expect(v.hasGlyph.value).toBe(false);
        expect(v.hasVisual.value).toBe(false);
    });

    it('uses the glyph when there is an icon but no image', () => {
        const v = run({icon: 'star'});
        expect(v.hasGlyph.value).toBe(true);
        expect(v.hasVisual.value).toBe(true);
        expect(v.iconClass.value).toBe('fas fa-star');
        expect(v.hasImage.value).toBe(false);
    });

    it('passes through a fully-qualified icon class unchanged', () => {
        const v = run({icon: 'fas fa-bell'});
        expect(v.iconClass.value).toBe('fas fa-bell');
    });

    it('prefers a usable image', () => {
        const v = run({imageAssetId: 'a1'});
        expect(v.hasImage.value).toBe(true);
        expect(v.assetSrc.value).toBe('/assets/a1');
        expect(v.hasVisual.value).toBe(true);
    });

    it('collapses a broken image rather than leaving an empty box', () => {
        const v = run({imageAssetId: 'a1'});
        expect(v.hasImage.value).toBe(true);
        v.onImageError();
        expect(v.hasImage.value).toBe(false);
        expect(v.hasVisual.value).toBe(false);
    });
});
