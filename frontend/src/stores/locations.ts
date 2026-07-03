import type {
    Location as ApiLocation,
    LocationAssignment,
    LocationBreadcrumbEntry,
    LocationCustomFields,
    LocationKind,
    LocationKindFields,
    LocationSubjectType
} from '@api/location';
import {defineStore} from 'pinia';
import {ref} from 'vue';
import {toastRpcError} from '@/helpers/domainErrors';
import {collectDescendants} from '@/helpers/locationTree';
import {type PagedEnvelope, paginate} from '@/helpers/pagination';
import {subjectRefKey} from '@/helpers/subjectRefs';
import {runOptimisticMutation} from '@/stores/optimisticMutation';
import * as ws from '../tools/websocket';
import {createRefreshCoordinator} from './refreshCoordinator';
import {useToastStore} from './toast';

export type {
    ApiLocation,
    LocationAssignment,
    LocationBreadcrumbEntry,
    LocationCustomFields,
    LocationKind,
    LocationKindFields,
    LocationSubjectType
};

export type LocationFieldGroup =
    | 'identity'
    | 'physical'
    | 'contact'
    | 'hours'
    | 'compliance'
    | 'operational'
    | 'environmental'
    | 'custom';

export type LocationFieldWidget =
    | 'text'
    | 'number'
    | 'iso'
    | 'combobox'
    | 'multiCombobox'
    | 'address'
    | 'geo'
    | 'contact'
    | 'operatingHours'
    | 'environmentalSetpoint';

export interface LocationFieldDescriptor {
    key: string;
    label: string;
    description: string;
    group: LocationFieldGroup;
    widget: LocationFieldWidget;
    optionSet?: string;
    min?: number;
    max?: number;
    pattern?: string;
    unit?: string;
    placeholder?: string;
}

export interface LocationKindDescriptor {
    kind: LocationKind;
    label: string;
    allowedParents: LocationKind[];
    allowRoot: boolean;
    fields: LocationFieldDescriptor[];
    inheritableFields: string[];
    sortRank: number;
}

export interface LocationOptionSet {
    field: string;
    kind: 'enum' | 'combobox' | 'iso';
    values: string[];
    allowCustom: boolean;
    multi: boolean;
}

export interface LocationListKindsResponse {
    kinds: LocationKindDescriptor[];
    optionSets: Record<string, LocationOptionSet>;
}

const PAGE_MAX = 1000;
type ListResp = PagedEnvelope<ApiLocation>;
type ItemsResp<T> = {items: T[]};

export interface LocationCreateParams {
    name: string;
    kind: LocationKind;
    parentLocationId?: number | null;
    sortOrder?: number;
    kindFields?: LocationKindFields;
    customFields?: LocationCustomFields;
}

export interface LocationUpdateParams {
    name?: string;
    parentLocationId?: number | null;
    sortOrder?: number;
    kindFields?: LocationKindFields;
    customFields?: LocationCustomFields;
}

export const useLocationsStore = defineStore('locations', () => {
    const locations = ref<Record<number, ApiLocation>>({});
    const rootIds = ref<number[]>([]);
    const kinds = ref<LocationKindDescriptor[]>([]);
    const optionSets = ref<Record<string, LocationOptionSet>>({});
    const assignmentsByLocation = ref<Record<number, LocationAssignment[]>>({});
    const loading = ref(true);
    const toast = useToastStore();

    function upsertMany(items: ApiLocation[]) {
        const next = {...locations.value};
        for (const l of items) next[l.id] = l;
        locations.value = next;
    }

    const locationsRefresh = createRefreshCoordinator(refreshLocations);

    async function fetchLocations() {
        await locationsRefresh.request();
    }

    async function refreshLocations(): Promise<void> {
        loading.value = true;
        try {
            const items = await paginate<ApiLocation>(
                (offset) =>
                    ws.sendRPC<ListResp>('FLEET_MANAGER', 'location.list', {
                        limit: PAGE_MAX,
                        offset,
                        includeSummary: true
                    }),
                PAGE_MAX
            );
            const next: Record<number, ApiLocation> = {};
            const roots: number[] = [];
            for (const l of items) {
                next[l.id] = l;
                if (l.parentLocationId == null) roots.push(l.id);
            }
            locations.value = next;
            rootIds.value = roots;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load locations');
        } finally {
            loading.value = false;
        }
    }

    async function fetchChildren(parentId: number): Promise<ApiLocation[]> {
        try {
            const items = await paginate<ApiLocation>(
                (offset) =>
                    ws.sendRPC<ListResp>('FLEET_MANAGER', 'location.children', {
                        id: parentId,
                        limit: PAGE_MAX,
                        offset,
                        includeSummary: true
                    }),
                PAGE_MAX
            );
            upsertMany(items);
            return items;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load child locations');
            return [];
        }
    }

    async function fetchLocation(id: number): Promise<ApiLocation | null> {
        try {
            const loc = await ws.sendRPC<ApiLocation>(
                'FLEET_MANAGER',
                'location.get',
                {id, includeSummary: true}
            );
            locations.value = {...locations.value, [loc.id]: loc};
            return loc;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load location');
            return null;
        }
    }

    async function fetchPath(id: number): Promise<LocationBreadcrumbEntry[]> {
        try {
            const res = await ws.sendRPC<ItemsResp<LocationBreadcrumbEntry>>(
                'FLEET_MANAGER',
                'location.path',
                {id}
            );
            return res.items ?? [];
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load location path');
            return [];
        }
    }

    async function fetchKinds(): Promise<LocationKindDescriptor[]> {
        if (kinds.value.length > 0) return kinds.value;
        try {
            const res = await ws.sendRPC<LocationListKindsResponse>(
                'FLEET_MANAGER',
                'location.listkinds',
                {}
            );
            kinds.value = (res.kinds ?? []).sort(
                (a, b) => a.sortRank - b.sortRank
            );
            optionSets.value = res.optionSets ?? {};
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load location kinds');
        }
        return kinds.value;
    }

    function kindDescriptor(kind: LocationKind): LocationKindDescriptor | null {
        return kinds.value.find((k) => k.kind === kind) ?? null;
    }

    function kindLabel(kind: LocationKind): string {
        return kindDescriptor(kind)?.label ?? kind;
    }

    async function createLocation(
        params: LocationCreateParams
    ): Promise<ApiLocation | null> {
        try {
            const loc = await ws.sendRPC<ApiLocation>(
                'FLEET_MANAGER',
                'location.create',
                params
            );
            locations.value = {...locations.value, [loc.id]: loc};
            if (
                loc.parentLocationId == null &&
                !rootIds.value.includes(loc.id)
            ) {
                rootIds.value = [...rootIds.value, loc.id];
            }
            return loc;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to create location');
            return null;
        }
    }

    async function updateLocation(
        id: number,
        patch: LocationUpdateParams
    ): Promise<ApiLocation | null> {
        try {
            const loc = await ws.sendRPC<ApiLocation>(
                'FLEET_MANAGER',
                'location.update',
                {id, ...patch}
            );
            locations.value = {...locations.value, [loc.id]: loc};
            // Parent change may have moved this node in/out of the roots.
            if (loc.parentLocationId == null) {
                if (!rootIds.value.includes(loc.id)) {
                    rootIds.value = [...rootIds.value, loc.id];
                }
            } else {
                rootIds.value = rootIds.value.filter((r) => r !== loc.id);
            }
            return loc;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to update location');
            return null;
        }
    }

    async function deleteLocation(id: number): Promise<boolean> {
        try {
            await ws.sendRPC('FLEET_MANAGER', 'location.delete', {id});
            const next = {...locations.value};
            delete next[id];
            locations.value = next;
            rootIds.value = rootIds.value.filter((r) => r !== id);
            const nextAssign = {...assignmentsByLocation.value};
            delete nextAssign[id];
            assignmentsByLocation.value = nextAssign;
            return true;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to delete location');
            return false;
        }
    }

    // Delete a location together with its whole subtree. The backend refuses
    // to delete a node that still has children (LocationDeleteBlockedHasChildren),
    // so we delete deepest-first: descendants ordered by depth desc, then the
    // node itself. Any single failure (e.g. a descendant still holds device
    // assignments) stops the cascade and surfaces via deleteLocation's toast.
    async function deleteLocationCascade(id: number): Promise<boolean> {
        const depthOf = (n: number): number => {
            let depth = 0;
            let cursor: number | null = n;
            const seen = new Set<number>();
            while (cursor != null && !seen.has(cursor)) {
                seen.add(cursor);
                const parent: number | null =
                    locations.value[cursor]?.parentLocationId ?? null;
                if (parent == null) break;
                depth += 1;
                cursor = parent;
            }
            return depth;
        };
        const ids = [id, ...collectDescendants(id, locations.value)];
        ids.sort((a, b) => depthOf(b) - depthOf(a));
        for (const target of ids) {
            const ok = await deleteLocation(target);
            if (!ok) return false;
        }
        return true;
    }

    async function setAssignment(
        subjectType: LocationSubjectType,
        subjectId: string,
        locationId: number
    ): Promise<boolean> {
        try {
            await runOptimisticMutation({
                snapshot: snapshotAssignmentsByLocation,
                apply: () =>
                    applyLocationAssignment({
                        subjectType,
                        subjectId,
                        locationId
                    }),
                commit: () =>
                    commitLocationAssignment({
                        subjectType,
                        subjectId,
                        locationId
                    }),
                rollback: restoreAssignmentsByLocation,
                reconcile: async () => {
                    await fetchAssignments(locationId);
                },
                onError: (err) =>
                    toastRpcError(toast, err, 'Failed to set assignment')
            });
            return true;
        } catch {
            return false;
        }
    }

    // Unassign a subject from wherever it currently sits. A subject lives at
    // one location, so the backend keys removal by subject — no locationId.
    async function removeAssignment(
        subjectType: LocationSubjectType,
        subjectId: string
    ): Promise<boolean> {
        try {
            await runOptimisticMutation({
                snapshot: snapshotAssignmentsByLocation,
                apply: () => {
                    assignmentsByLocation.value = removeSubjectFromAllLocations(
                        {
                            subjectType,
                            subjectId
                        }
                    );
                },
                commit: async () => {
                    await ws.sendRPC(
                        'FLEET_MANAGER',
                        'location.removeassignment',
                        {
                            subjectType,
                            subjectId
                        }
                    );
                },
                rollback: restoreAssignmentsByLocation,
                reconcile: async () => {},
                onError: (err) =>
                    toastRpcError(toast, err, 'Failed to remove assignment')
            });
            return true;
        } catch {
            return false;
        }
    }

    function snapshotAssignmentsByLocation(): Record<
        number,
        LocationAssignment[]
    > {
        return Object.fromEntries(
            Object.entries(assignmentsByLocation.value).map(([id, items]) => [
                Number(id),
                [...items]
            ])
        );
    }

    function restoreAssignmentsByLocation(
        previous: Record<number, LocationAssignment[]>
    ): void {
        assignmentsByLocation.value = previous;
    }

    function applyLocationAssignment(input: {
        subjectType: LocationSubjectType;
        subjectId: string;
        locationId: number;
    }): void {
        const next = removeSubjectFromAllLocations(input);
        const current = next[input.locationId] ?? [];
        next[input.locationId] = [...current, buildLocationAssignment(input)];
        assignmentsByLocation.value = next;
    }

    function removeSubjectFromAllLocations(input: {
        subjectType: LocationSubjectType;
        subjectId: string;
    }): Record<number, LocationAssignment[]> {
        const next: Record<number, LocationAssignment[]> = {};
        const removedKey = subjectRefKey(input);
        for (const [id, items] of Object.entries(assignmentsByLocation.value)) {
            next[Number(id)] = items.filter(
                (item) => subjectRefKey(item) !== removedKey
            );
        }
        return next;
    }

    function buildLocationAssignment(input: {
        subjectType: LocationSubjectType;
        subjectId: string;
        locationId: number;
    }): LocationAssignment {
        return {
            organizationId:
                locations.value[input.locationId]?.organizationId ?? '',
            subjectType: input.subjectType,
            subjectId: input.subjectId,
            locationId: input.locationId,
            createdAt: new Date().toISOString(),
            updatedAt: null
        };
    }

    async function commitLocationAssignment(input: {
        subjectType: LocationSubjectType;
        subjectId: string;
        locationId: number;
    }): Promise<void> {
        await ws.sendRPC('FLEET_MANAGER', 'location.setassignment', input);
    }

    async function fetchAssignments(
        locationId: number
    ): Promise<LocationAssignment[]> {
        try {
            const items = await listAssignments({locationId});
            assignmentsByLocation.value = {
                ...assignmentsByLocation.value,
                [locationId]: items
            };
            return items;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load assignments');
            return [];
        }
    }

    async function fetchAssignmentsBulk(
        locationIds: number[]
    ): Promise<Record<number, LocationAssignment[]>> {
        const ids = [...new Set(locationIds.filter((id) => id > 0))];
        const grouped: Record<number, LocationAssignment[]> = {};
        for (const id of ids) grouped[id] = [];
        if (ids.length === 0) return grouped;

        try {
            const items = await listAssignments({locationIds: ids});
            for (const item of items) {
                (grouped[item.locationId] ??= []).push(item);
            }
            assignmentsByLocation.value = {
                ...assignmentsByLocation.value,
                ...grouped
            };
            return grouped;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load assignments');
            return grouped;
        }
    }

    async function listAssignments(params: {
        locationId?: number;
        locationIds?: number[];
    }): Promise<LocationAssignment[]> {
        return paginate<LocationAssignment>(
            (offset) =>
                ws.sendRPC<PagedEnvelope<LocationAssignment>>(
                    'FLEET_MANAGER',
                    'location.listassignments',
                    {...params, limit: PAGE_MAX, offset}
                ),
            PAGE_MAX
        );
    }

    ws.onLocationEvent((e) => {
        const id = e.params.id as number | undefined;
        if (e.method === 'Location.Deleted') {
            if (typeof id === 'number') {
                const next = {...locations.value};
                delete next[id];
                locations.value = next;
                rootIds.value = rootIds.value.filter((r) => r !== id);
                const nextAssign = {...assignmentsByLocation.value};
                delete nextAssign[id];
                assignmentsByLocation.value = nextAssign;
            }
            return;
        }
        if (
            e.method === 'Location.AssignmentSet' ||
            e.method === 'Location.AssignmentRemoved'
        ) {
            const locationId = e.params.locationId as number | undefined;
            if (typeof locationId === 'number') {
                void fetchAssignments(locationId);
            }
            return;
        }
        if (typeof id === 'number') void fetchLocation(id);
    });

    async function assignDevices(
        deviceIds: string[],
        locationId: number
    ): Promise<{ok: boolean; succeeded: string[]; failed: string[]}> {
        const succeeded: string[] = [];
        const failed: string[] = [];
        if (deviceIds.length === 0) {
            return {ok: true, succeeded, failed};
        }
        // Continue past failures so the caller learns which IDs landed
        // server-side — early-return left silent partial-success.
        for (const subjectId of deviceIds) {
            const ok = await setAssignment('device', subjectId, locationId);
            (ok ? succeeded : failed).push(subjectId);
        }
        return {ok: failed.length === 0, succeeded, failed};
    }

    return {
        locations,
        rootIds,
        kinds,
        optionSets,
        assignmentsByLocation,
        loading,
        fetchLocations,
        fetchChildren,
        fetchLocation,
        fetchPath,
        fetchKinds,
        kindDescriptor,
        kindLabel,
        createLocation,
        updateLocation,
        deleteLocation,
        deleteLocationCascade,
        setAssignment,
        removeAssignment,
        fetchAssignments,
        fetchAssignmentsBulk,
        assignDevices
    };
});
