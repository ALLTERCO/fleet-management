// Helpers for group.addmembers / removemembers payload construction.
import type {GroupMemberRef} from '@api/group';
import {subjectRefKey} from '@/helpers/subjectRefs';

export function subjectMembers(
    subjectType: GroupMemberRef['subjectType'],
    subjectIds: string[]
): GroupMemberRef[] {
    return subjectIds.map((subjectId) => ({subjectType, subjectId}));
}

export function deviceMembers(shellyIDs: string[]): GroupMemberRef[] {
    return subjectMembers('device', shellyIDs);
}

export function entityMembers(entityIds: string[]): GroupMemberRef[] {
    return subjectMembers('entity', entityIds);
}

export function locationMembers(locationIds: string[]): GroupMemberRef[] {
    return subjectMembers('location', locationIds);
}

export function chunkBy<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        out.push(items.slice(i, i + size));
    }
    return out;
}

// Diff baseline → target for minimal AddMembers/RemoveMembers calls.
export function diffMembers(
    baseline: string[],
    target: string[]
): {toAdd: string[]; toRemove: string[]} {
    const before = new Set(baseline);
    const after = new Set(target);
    return {
        toAdd: [...after].filter((d) => !before.has(d)),
        toRemove: [...before].filter((d) => !after.has(d))
    };
}

export function diffSubjectMembers(
    baseline: GroupMemberRef[],
    target: GroupMemberRef[]
): {toAdd: GroupMemberRef[]; toRemove: GroupMemberRef[]} {
    const before = new Map(
        baseline.map((member) => [subjectRefKey(member), member])
    );
    const after = new Map(
        target.map((member) => [subjectRefKey(member), member])
    );
    return {
        toAdd: [...after]
            .filter(([key]) => !before.has(key))
            .map(([, member]) => member),
        toRemove: [...before]
            .filter(([key]) => !after.has(key))
            .map(([, member]) => member)
    };
}
