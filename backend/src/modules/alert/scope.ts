/** Pure scope matcher — no DB calls. Engine precomputes group/location/tag arrays per event. */

import type {ScopeSelector} from '../../types/api/alert';

export interface EventSubject {
    shellyID?: string;
    /** The triggering entity, or any entity on the device when the scope could match. */
    entityId?: string;
    entityIds?: readonly string[];
    /** Precomputed group-ids containing this device — one DB read per event. */
    groupIds?: readonly number[];
    /** Precomputed location-ids containing this device — same one DB read. */
    locationIds?: readonly number[];
    /** Precomputed tag-ids assigned to this device — same one DB read. */
    tagIds?: readonly number[];
}

/** Empty scope selector = "any subject in the org". */
function isWildcardScope(scope: ScopeSelector): boolean {
    return (
        !scope.deviceIds?.length &&
        !scope.componentIds?.length &&
        !scope.groupIds?.length &&
        !scope.locationIds?.length &&
        !scope.tagIds?.length
    );
}

function intersects(
    a: readonly number[] | undefined,
    b: readonly number[] | undefined
): boolean {
    if (!a?.length || !b?.length) return false;
    for (const x of a) if (b.includes(x)) return true;
    return false;
}

export function matchesScope(
    scope: ScopeSelector,
    subject: EventSubject
): boolean {
    if (isWildcardScope(scope)) return true;

    if (subject.shellyID && scope.deviceIds?.includes(subject.shellyID)) {
        return true;
    }
    const componentIds = scope.componentIds;
    if (subject.entityId && componentIds?.includes(subject.entityId)) {
        return true;
    }
    if (componentIds?.length && subject.entityIds?.length) {
        for (const id of subject.entityIds) {
            if (componentIds.includes(id)) return true;
        }
    }
    if (intersects(scope.groupIds, subject.groupIds)) return true;
    if (intersects(scope.locationIds, subject.locationIds)) return true;
    if (intersects(scope.tagIds, subject.tagIds)) return true;
    return false;
}
