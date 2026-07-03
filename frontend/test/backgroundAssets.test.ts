import {describe, expect, it} from 'vitest';

import {
    applyBackgroundStyle,
    backgroundImageUrl,
    backgroundStyleState,
    initialDisplayBackground,
    isProtectedBackgroundPath
} from '@/helpers/backgroundAssets';

describe('backgroundAssets', () => {
    it('does not paint protected upload paths before they are signed', () => {
        expect(
            initialDisplayBackground('/uploads/backgrounds/app_bg_10.png')
        ).toBe('');
        expect(initialDisplayBackground('#101820')).toBe('#101820');
    });

    it('allows signed upload asset URLs with query parameters', () => {
        expect(
            backgroundImageUrl(
                '/uploads/backgrounds/app_bg_10.png?assetToken=signed-token'
            )
        ).toContain(
            '/uploads/backgrounds/app_bg_10.png?assetToken=signed-token'
        );
    });

    it('detects protected background paths', () => {
        expect(isProtectedBackgroundPath('/uploads/backgrounds/a.png')).toBe(
            true
        );
        expect(isProtectedBackgroundPath('/assets/a.png')).toBe(false);
    });

    it('returns empty style state when background is cleared', () => {
        expect(backgroundStyleState('')).toEqual({kind: 'empty'});
        expect(backgroundStyleState('undefined')).toEqual({kind: 'empty'});
    });

    it('returns color and image style states', () => {
        expect(backgroundStyleState('#101820')).toEqual({
            kind: 'color',
            color: '#101820'
        });
        const image = backgroundStyleState('/assets/background.png');
        expect(image.kind).toBe('image');
        expect(image.kind === 'image' ? image.imageUrl : '').toContain(
            '/assets/background.png'
        );
    });

    it('applies empty, color, and image style states', () => {
        const style = mutableStyle();
        applyBackgroundStyle({
            state: {kind: 'color', color: '#101820'},
            style
        });
        expect(style.values).toEqual({
            '--background-color': '#101820',
            '--background-image': 'none'
        });

        applyBackgroundStyle({
            state: {kind: 'image', imageUrl: 'https://example.test/bg.png'},
            style
        });
        expect(style.values).toEqual({
            '--background-image': 'url("https://example.test/bg.png")'
        });

        applyBackgroundStyle({state: {kind: 'empty'}, style});
        expect(style.values).toEqual({});
    });
});

function mutableStyle() {
    const values: Record<string, string> = {};
    return {
        values,
        removeProperty(name: string) {
            delete values[name];
            return '';
        },
        setProperty(name: string, value: string) {
            values[name] = value;
        }
    };
}
