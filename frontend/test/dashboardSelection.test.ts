import {describe, expect, it} from 'vitest';
import {
    deselectFiltered,
    projectSelection,
    selectFiltered
} from '@/helpers/dashboardSelection';

describe('projectSelection', () => {
    it('partitions a selection into visible and hidden buckets by filter', () => {
        const view = projectSelection(new Set(['1', '2', '3', '4']), [1, 3]);
        expect([...view.visible]).toEqual(['1', '3']);
        expect([...view.hidden].sort()).toEqual(['2', '4']);
    });

    it('returns empty visible when no ids are in the filter', () => {
        const view = projectSelection(new Set(['9']), [1, 2]);
        expect(view.visible.size).toBe(0);
        expect([...view.hidden]).toEqual(['9']);
    });

    it('returns empty hidden when every selected id is in the filter', () => {
        const view = projectSelection(new Set(['1', '2']), [1, 2, 3]);
        expect([...view.visible].sort()).toEqual(['1', '2']);
        expect(view.hidden.size).toBe(0);
    });
});

describe('deselectFiltered', () => {
    it('regression: removes only visible ids, keeping hidden selections intact', () => {
        const next = deselectFiltered(new Set(['1', '2', '3']), [1, 2]);
        expect([...next]).toEqual(['3']);
    });

    it('keeps the selection unchanged when no visible ids are selected', () => {
        const next = deselectFiltered(new Set(['9']), [1, 2]);
        expect([...next]).toEqual(['9']);
    });

    it('clears every selection when the filter contains all selected ids', () => {
        const next = deselectFiltered(new Set(['1', '2']), [1, 2, 3]);
        expect(next.size).toBe(0);
    });
});

describe('selectFiltered', () => {
    it('adds the filtered ids on top of an existing selection', () => {
        const next = selectFiltered(new Set(['9']), [1, 2]);
        expect([...next].sort()).toEqual(['1', '2', '9']);
    });

    it('is idempotent when filtered ids are already selected', () => {
        const next = selectFiltered(new Set(['1', '2']), [1, 2]);
        expect([...next].sort()).toEqual(['1', '2']);
    });
});
