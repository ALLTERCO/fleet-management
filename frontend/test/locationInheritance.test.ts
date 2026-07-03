import {describe, expect, it} from 'vitest';
import {inheritKindFieldsFromParent} from '@/helpers/location-inheritance';

// Focus: only declared, non-empty parent values reach a new child.
describe('seeding a child from its parent', () => {
    it('carries only the keys the child kind declares inheritable', () => {
        const seeded = inheritKindFieldsFromParent({
            parentKindFields: {
                timezone: 'Europe/Sofia',
                city: 'Sofia',
                notes: 'private parent note'
            },
            childInheritableFields: ['timezone', 'city']
        });

        expect(seeded).toEqual({timezone: 'Europe/Sofia', city: 'Sofia'});
    });

    it('skips empty, null, and blank values rather than seeding noise', () => {
        const seeded = inheritKindFieldsFromParent({
            parentKindFields: {
                timezone: '',
                city: null,
                tags: [],
                region: 'Sofia-grad'
            },
            childInheritableFields: ['timezone', 'city', 'tags', 'region']
        });

        expect(seeded).toEqual({region: 'Sofia-grad'});
    });

    it('returns nothing when the parent has no fields', () => {
        const seeded = inheritKindFieldsFromParent({
            parentKindFields: null,
            childInheritableFields: ['timezone']
        });

        expect(seeded).toEqual({});
    });
});
