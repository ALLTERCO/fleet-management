import {describe, expect, it} from 'vitest';
import {ref} from 'vue';
import {useNameSearch} from '@/composables/useNameSearch';

describe('useNameSearch — picker grid substring matcher', () => {
    it('passes everything when the query is empty so the grid renders the full catalogue', () => {
        const {matches} = useNameSearch(ref(''));
        expect(matches('Anything')).toBe(true);
    });

    it('passes everything when the query is one character because a single letter is too noisy', () => {
        const {matches} = useNameSearch(ref('a'));
        expect(matches('Pump')).toBe(true);
    });

    it('matches case-insensitively so admins do not need to match brand casing', () => {
        const {matches} = useNameSearch(ref('PUMP'));
        expect(matches('Main pump')).toBe(true);
    });

    it('trims surrounding whitespace because admins paste with stray spaces', () => {
        const {matches} = useNameSearch(ref('  pump  '));
        expect(matches('Main pump')).toBe(true);
    });

    it('rejects items that do not contain the query substring', () => {
        const {matches} = useNameSearch(ref('valve'));
        expect(matches('Main pump')).toBe(false);
    });

    it('reads the search ref reactively so the parent can drive it via v-model', () => {
        const search = ref('lobby');
        const {matches} = useNameSearch(search);
        expect(matches('Lobby fan')).toBe(true);
        search.value = 'roof';
        expect(matches('Lobby fan')).toBe(false);
    });

    it('accepts a getter function so callers can pass a computed source', () => {
        const search = ref('pump');
        const {matches} = useNameSearch(() => search.value);
        expect(matches('Pump 1')).toBe(true);
    });
});
