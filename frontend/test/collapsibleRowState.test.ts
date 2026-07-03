import {describe, expect, it} from 'vitest';
import {reseedOpenIds} from '@/helpers/collapsibleRowState';

describe('reseedOpenIds', () => {
    it('preserves user-toggled state for ids that are still in the list', () => {
        const next = reseedOpenIds(
            ['a', 'b', 'c'],
            new Set(['a', 'b', 'c']),
            new Set(['b']),
            false
        );
        expect([...next]).toEqual(['b']);
    });

    it('drops state for ids no longer in the list', () => {
        const next = reseedOpenIds(
            ['a', 'c'],
            new Set(['a', 'b', 'c']),
            new Set(['b']),
            false
        );
        expect([...next]).toEqual([]);
    });

    it('opens new ids when defaultExpanded is true', () => {
        const next = reseedOpenIds(
            ['a', 'b', 'c'],
            new Set(['a']),
            new Set(['a']),
            true
        );
        expect([...next].sort()).toEqual(['a', 'b', 'c']);
    });

    it('keeps new ids closed when defaultExpanded is false', () => {
        const next = reseedOpenIds(
            ['a', 'b'],
            new Set(['a']),
            new Set(['a']),
            false
        );
        expect([...next]).toEqual(['a']);
    });

    it('regression: items prop changing identity does not clobber user state', () => {
        // The component receives a new array reference every render via .map();
        // the helper must NOT collapse existing rows the user explicitly opened.
        let known = new Set<string>(['1', '2', '3']);
        let open = new Set<string>(['2']);
        for (let i = 0; i < 5; i++) {
            const next = reseedOpenIds(['1', '2', '3'], known, open, false);
            known = new Set(['1', '2', '3']);
            open = next as Set<string>;
        }
        expect([...open]).toEqual(['2']);
    });
});
