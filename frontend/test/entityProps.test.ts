import {describe, expect, it} from 'vitest';
import {
    entityBooleanProp,
    entityNumericProp,
    entityProps,
    entityStringListProp,
    entityStringProp
} from '@/helpers/entityProps';

// Minimal entity-shaped object for testing. The helpers only read
// `.properties` so the rest of entity_t does not matter to them.
const makeEntity = (properties: Record<string, unknown>): any => ({
    id: 'e1',
    source: 'd1',
    type: 'switch',
    name: 'Entity',
    properties
});

describe('entityProps — raw bag access', () => {
    it('returns the underlying properties object so callers can inspect it', () => {
        const e = makeEntity({foo: 1});
        expect(entityProps(e)).toEqual({foo: 1});
    });
});

describe('entityStringProp — narrowed string read', () => {
    it('returns the value when it is a string so the form binds cleanly', () => {
        expect(entityStringProp(makeEntity({label: 'Pump'}), 'label')).toBe(
            'Pump'
        );
    });

    it('returns undefined when the key is missing', () => {
        expect(entityStringProp(makeEntity({}), 'label')).toBeUndefined();
    });

    it('returns undefined when the value is the wrong type so we do not coerce', () => {
        expect(entityStringProp(makeEntity({label: 7}), 'label')).toBeUndefined();
    });
});

describe('entityNumericProp — narrowed number read', () => {
    it('returns the value when it is a number', () => {
        expect(entityNumericProp(makeEntity({count: 42}), 'count')).toBe(42);
    });

    it('returns undefined when the value is a numeric string so callers can opt in', () => {
        expect(entityNumericProp(makeEntity({count: '42'}), 'count')).toBeUndefined();
    });

    it('returns 0 as a valid number because zero is a legitimate value', () => {
        expect(entityNumericProp(makeEntity({count: 0}), 'count')).toBe(0);
    });
});

describe('entityBooleanProp — narrowed boolean read', () => {
    it('returns the value when it is true', () => {
        expect(entityBooleanProp(makeEntity({on: true}), 'on')).toBe(true);
    });

    it('returns the value when it is false because false is meaningful', () => {
        expect(entityBooleanProp(makeEntity({on: false}), 'on')).toBe(false);
    });

    it('returns undefined when the key is missing', () => {
        expect(entityBooleanProp(makeEntity({}), 'on')).toBeUndefined();
    });

    it('returns undefined when the value is truthy but not boolean so it does not coerce 1', () => {
        expect(entityBooleanProp(makeEntity({on: 1}), 'on')).toBeUndefined();
    });
});

describe('entityStringListProp — array of strings with drop-non-strings', () => {
    it('returns the array unchanged when every item is a string', () => {
        const e = makeEntity({members: ['a', 'b', 'c']});
        expect(entityStringListProp(e, 'members')).toEqual(['a', 'b', 'c']);
    });

    it('drops non-string entries so a sloppy backend payload does not crash the iterator', () => {
        const e = makeEntity({members: ['a', 7, null, 'b']});
        expect(entityStringListProp(e, 'members')).toEqual(['a', 'b']);
    });

    it('returns an empty array when the key is missing so callers can iterate directly', () => {
        expect(entityStringListProp(makeEntity({}), 'members')).toEqual([]);
    });

    it('returns an empty array when the value is not an array', () => {
        expect(entityStringListProp(makeEntity({members: 'a,b'}), 'members')).toEqual(
            []
        );
    });
});
