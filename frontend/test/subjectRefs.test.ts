import {describe, expect, it} from 'vitest';
import {subjectRefKey} from '@/helpers/subjectRefs';

describe('subjectRefKey', () => {
    it('keys subject refs by type and id', () => {
        expect(subjectRefKey({subjectType: 'device', subjectId: 'abc'})).toBe(
            'device:abc'
        );
    });
});
