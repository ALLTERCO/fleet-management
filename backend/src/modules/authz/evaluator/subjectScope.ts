// Membership writes (group members, tag subjects) may only reach what the
// caller can already read. A scoped grant matches devices through their group
// and tag membership, so adding an unseen device would widen the grant itself.

import type CommandSender from '../../../model/CommandSender';
import {requireComponentPermissionAsync} from './componentPermission';

export interface ResolvedSubjects {
    shellyIDs: readonly string[];
    locationIds: readonly number[];
    groupIds: readonly number[];
}

export const NO_SUBJECTS: ResolvedSubjects = {
    shellyIDs: [],
    locationIds: [],
    groupIds: []
};

export function mergeSubjects(
    parts: readonly ResolvedSubjects[]
): ResolvedSubjects {
    return {
        shellyIDs: parts.flatMap((p) => p.shellyIDs),
        locationIds: parts.flatMap((p) => p.locationIds),
        groupIds: parts.flatMap((p) => p.groupIds)
    };
}

/** Throws PermissionDenied on the first subject the caller may not read. */
export async function requireSubjectsReadable(
    sender: CommandSender,
    subjects: ResolvedSubjects
): Promise<void> {
    for (const id of subjects.shellyIDs) {
        await requireComponentPermissionAsync(sender, 'devices', 'read', id);
    }
    for (const id of subjects.locationIds) {
        await requireComponentPermissionAsync(sender, 'locations', 'read', id);
    }
    for (const id of subjects.groupIds) {
        await requireComponentPermissionAsync(sender, 'groups', 'read', id);
    }
}
