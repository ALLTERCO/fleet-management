import {describe, expect, it} from 'vitest';
import {
    allSelectionScopeSelected,
    toggleSelectionScope
} from '@/helpers/selectionScope';

describe('selection scope', () => {
    it('selects only visible ids and preserves an existing hidden selection', () => {
        const next = toggleSelectionScope(
            ['hidden-device'],
            ['visible-a', 'visible-b']
        );

        expect(new Set(next)).toEqual(
            new Set(['hidden-device', 'visible-a', 'visible-b'])
        );
        expect(
            allSelectionScopeSelected(
                new Set(next),
                ['visible-a', 'visible-b']
            )
        ).toBe(true);
    });

    it('deselects only the visible scope when all visible ids are selected', () => {
        const next = toggleSelectionScope(
            ['hidden-device', 'visible-a', 'visible-b'],
            ['visible-a', 'visible-b']
        );

        expect(next).toEqual(['hidden-device']);
    });

    it('does not report an empty scope as fully selected', () => {
        expect(allSelectionScopeSelected(new Set(['hidden-device']), [])).toBe(
            false
        );
    });
});
