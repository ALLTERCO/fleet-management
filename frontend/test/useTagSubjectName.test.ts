// One shared resolver for a tag assignment's subject name — used by both the
// tag detail page and the tag edit modal (no duplicate subjectName).

import {describe, expect, it, vi} from 'vitest';

const {getDeviceName} = vi.hoisted(() => ({getDeviceName: vi.fn()}));
vi.mock('@/stores/devices', () => ({
    useDevicesStore: () => ({getDeviceName})
}));
vi.mock('@/stores/locations', () => ({
    useLocationsStore: () => ({locations: {5: {name: 'Garage'}}})
}));
vi.mock('@/stores/groups', () => ({
    useGroupsStore: () => ({groups: {3: {name: 'Floor 1'}}})
}));
vi.mock('@/stores/entities', () => ({
    useEntityStore: () => ({entities: {e1: {name: 'Kitchen Sensor'}}})
}));

import {useTagSubjectName} from '@/composables/useTagSubjectName';
import type {TagAssignmentRef} from '@/stores/tags';

function ref(
    subjectType: TagAssignmentRef['subjectType'],
    subjectId: string
): TagAssignmentRef {
    return {subjectType, subjectId} as TagAssignmentRef;
}

describe('useTagSubjectName', () => {
    it('resolves every subject type to its name', () => {
        getDeviceName.mockReturnValue('Living Room Relay');
        const {subjectName} = useTagSubjectName();
        expect(subjectName(ref('device', 'shelly-1'))).toBe(
            'Living Room Relay'
        );
        expect(subjectName(ref('location', '5'))).toBe('Garage');
        expect(subjectName(ref('group', '3'))).toBe('Floor 1');
        expect(subjectName(ref('entity', 'e1'))).toBe('Kitchen Sensor');
    });

    it('falls back to the id when the subject is not loaded', () => {
        getDeviceName.mockReturnValue(undefined);
        const {subjectName} = useTagSubjectName();
        expect(subjectName(ref('location', '99'))).toBe('99');
        expect(subjectName(ref('device', 'unknown'))).toBe('unknown');
    });
});
