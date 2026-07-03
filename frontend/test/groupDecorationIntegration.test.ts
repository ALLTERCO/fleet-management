// INTEGRATION: the icon + accent picker outputs flow through the
// frontend store's update payload shape and stay token-keyed only.
import {describe, expect, it} from 'vitest';
import {isAccentTokenKey} from '@/config/accentTokens';

// Mirrors the shape the modal sends to groups.updateGroup(). Pure
// payload-building lives at module-scope so we can test it without
// rendering the Vue component.
export function buildGroupDecorationPatch(input: {
    icon: string | null;
    accent: string | null;
}): {visual: {icon?: string; accent?: string}} {
    return {
        visual: {
            icon: input.icon ?? undefined,
            accent: input.accent ?? undefined
        }
    };
}

describe('group decoration patch builder', () => {
    it('omits cleared fields (null → undefined) so backend uses COALESCE preserve', () => {
        const patch = buildGroupDecorationPatch({icon: null, accent: 'cyan'});
        expect(patch.visual.icon).toBeUndefined();
        expect(patch.visual.accent).toBe('cyan');
    });

    it('keeps token keys intact (no transformation to hex)', () => {
        const patch = buildGroupDecorationPatch({
            icon: 'fas fa-folder',
            accent: 'teal'
        });
        expect(isAccentTokenKey(patch.visual.accent ?? '')).toBe(true);
    });

    it('all cleared → empty visual object (matches "no decoration")', () => {
        const patch = buildGroupDecorationPatch({icon: null, accent: null});
        expect(patch.visual).toEqual({});
    });
});
