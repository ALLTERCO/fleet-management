// UNIT: reverse-index composable. The store carries assignments grouped
// by tag; the index inverts to (subjectType:subjectId) → tagIds so callers
// can ask "what tags does X have?" without iterating every tag.
import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it} from 'vitest';
import {useTagsBySubject} from '@/composables/useTagsBySubject';
import {useTagsStore} from '@/stores/tags';

describe('useTagsBySubject', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    it('returns empty when no tags are loaded', () => {
        const {tagIdsFor} = useTagsBySubject();
        expect(tagIdsFor('device', 'shelly-1')).toEqual([]);
    });

    it('inverts the store assignments into a (subject) → tagIds map', () => {
        const store = useTagsStore();
        store.assignments = {
            10: [
                {subjectType: 'device', subjectId: 'shelly-1'},
                {subjectType: 'group', subjectId: '7'}
            ],
            11: [{subjectType: 'device', subjectId: 'shelly-1'}],
            12: [{subjectType: 'location', subjectId: '99'}]
        };
        const {tagIdsFor} = useTagsBySubject();
        expect(tagIdsFor('device', 'shelly-1').sort()).toEqual([10, 11]);
        expect(tagIdsFor('group', '7')).toEqual([10]);
        expect(tagIdsFor('location', '99')).toEqual([12]);
    });

    it('returns empty for a subject that has no tags', () => {
        const store = useTagsStore();
        store.assignments = {
            10: [{subjectType: 'device', subjectId: 'shelly-1'}]
        };
        const {tagIdsFor} = useTagsBySubject();
        expect(tagIdsFor('device', 'shelly-NEVER')).toEqual([]);
    });

    it('uses a stable (type:id) key separator that survives colons in subjectId', () => {
        const store = useTagsStore();
        store.assignments = {
            10: [{subjectType: 'entity', subjectId: 'switch:0'}]
        };
        const {keyFor, tagIdsFor} = useTagsBySubject();
        expect(keyFor('entity', 'switch:0')).toBe('entity:switch:0');
        expect(tagIdsFor('entity', 'switch:0')).toEqual([10]);
    });
});
