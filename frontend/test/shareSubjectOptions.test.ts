import {describe, expect, it} from 'vitest';
import {
    buildShareSubjectOptions,
    type ShareSubjectOptionsInput
} from '@/helpers/shareSubjectOptions';

function baseInput(): ShareSubjectOptionsInput {
    return {
        selectedType: 'user',
        query: '',
        users: [
            {
                userId: 'u-1',
                displayName: 'Ada Lovelace',
                userName: 'ada',
                email: 'ada@example.test'
            },
            {
                userId: 'u-2',
                userName: 'grace',
                email: 'grace@example.test'
            }
        ],
        groups: [
            {
                id: 'g-1',
                name: 'Maintenance Team',
                description: 'Floor 2 devices'
            }
        ]
    };
}

describe('shareSubjectOptions', () => {
    it('builds searchable user options', () => {
        const options = buildShareSubjectOptions({
            ...baseInput(),
            query: 'ada'
        });

        expect(options).toEqual([
            expect.objectContaining({
                type: 'user',
                id: 'u-1',
                label: 'Ada Lovelace',
                detail: 'ada@example.test'
            })
        ]);
    });

    it('builds searchable group options', () => {
        const options = buildShareSubjectOptions({
            ...baseInput(),
            selectedType: 'user_group',
            query: 'floor'
        });

        expect(options).toEqual([
            expect.objectContaining({
                type: 'user_group',
                id: 'g-1',
                label: 'Maintenance Team',
                detail: 'Floor 2 devices'
            })
        ]);
    });

    it('applies a stable limit', () => {
        const options = buildShareSubjectOptions({
            ...baseInput(),
            limit: 1
        });

        expect(options).toHaveLength(1);
    });
});
