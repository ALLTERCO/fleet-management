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
import {
    type CursorPage,
    paginateByCursor
} from '@/shell/template-host/core/pagination';
import {runOptimisticMutation} from '@/stores/optimisticMutation';
import {createBatchCoalescer} from '../tools/coalesce';
import {deferWhileHidden} from '../tools/hiddenTabDeferral';
import * as ws from '../tools/websocket';
import {LOCATION_EVENT} from '../tools/wsEvents';
import {createRefreshCoordinator} from './refreshCoordinator';
import {createStaleGuard, type StaleGuard} from './staleGuard';
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

    // Bumped on mutations and WS writes only; stale read merges are discarded.
    const locationsGuard = createStaleGuard();

    // Mutation write: bumps so in-flight reads discard themselves.
    function writeLocations(
        next: Record<number, ApiLocation>,
        roots: number[]
    ): void {
        locationsGuard.bump();
        locations.value = next;
        rootIds.value = roots;
    }

    // Read merge: never bumps — reads must not discard refreshes or each other.
    function mergeLocations(items: ApiLocation[]): void {
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
        const token = locationsGuard.current();
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
            // A write landed mid-flight; merging would overwrite newer state.
            if (locationsGuard.isStale(token)) return;
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
        const token = locationsGuard.current();
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
            // A write landed mid-flight; merging would overwrite newer state.
            if (locationsGuard.isStale(token)) return items;
            mergeLocations(items);
            return items;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load child locations');
            return [];
        }
    }

    async function fetchLocation(id: number): Promise<ApiLocation | null> {
        const token = locationsGuard.current();
        try {
            const loc = await ws.sendRPC<ApiLocation>(
                'FLEET_MANAGER',
                'location.get',
                {id, includeSummary: true}
            );
            // A write landed mid-flight; merging would overwrite newer state.
            if (locationsGuard.isStale(token)) return loc;
            mergeLocations([loc]);
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
            const roots =
                loc.parentLocationId == null && !rootIds.value.includes(loc.id)
                    ? [...rootIds.value, loc.id]
                    : rootIds.value;
            writeLocations({...locations.value, [loc.id]: loc}, roots);
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
            // Parent change may have moved this node in/out of the roots.
            const roots =
                loc.parentLocationId == null
                    ? rootIds.value.includes(loc.id)
                        ? rootIds.value
                        : [...rootIds.value, loc.id]
                    : rootIds.value.filter((r) => r !== loc.id);
            writeLocations({...locations.value, [loc.id]: loc}, roots);
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
            writeLocations(
                next,
                rootIds.value.filter((r) => r !== id)
            );
            const nextAssign = {...assignmentsByLocation.value};
            delete nextAssign[id];
            writeAssignments(nextAssign, [id]);
            return true;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to delete location');
            return false;
        }
    }

    // The backend owns the subtree transaction. The store only reconciles the
    // returned ids into its local snapshot.
    async function deleteLocationCascade(id: number): Promise<boolean> {
        try {
            const result = await ws.sendRPC<{deletedIds: number[]}>(
                'FLEET_MANAGER',
                'location.deletesubtree',
                {id}
            );
            const deleted = new Set(result.deletedIds);
            const next = {...locations.value};
            const nextAssignments = {...assignmentsByLocation.value};
            for (const deletedId of deleted) {
                delete next[deletedId];
                delete nextAssignments[deletedId];
            }
            writeLocations(
                next,
                rootIds.value.filter((rootId) => !deleted.has(rootId))
            );
            writeAssignments(nextAssignments, [...deleted]);
            return true;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to delete location subtree');
            return false;
        }
    }

    async function setAssignment(
        subjectType: LocationSubjectType,
        subjectId: string,
        locationId: number
    ): Promise<boolean> {
        try {
            await runOptimisticMutation({
                // Scoped to the touched locations so rollback cannot erase
                // another subject's concurrent state.
                snapshot: () =>
                    snapshotAssignmentRows([
                        ...new Set([
                            ...locationsHoldingSubject({
                                subjectType,
                                subjectId
                            }),
                            locationId
                        ])
                    ]),
                apply: (snapshot) =>
                    applyLocationAssignment(
                        {subjectType, subjectId, locationId},
                        snapshotLocationIds(snapshot)
                    ),
                commit: () =>
                    commitLocationAssignment({
                        subjectType,
                        subjectId,
                        locationId
                    }),
                rollback: restoreAssignmentRows,
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
                // Scoped to the locations holding the subject — see setAssignment.
                snapshot: () =>
                    snapshotAssignmentRows(
                        locationsHoldingSubject({subjectType, subjectId})
                    ),
                apply: (snapshot) => {
                    const touched = snapshotLocationIds(snapshot);
                    writeAssignments(
                        removeSubjectFromLocations(touched, {
                            subjectType,
                            subjectId
                        }),
                        touched
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
                rollback: restoreAssignmentRows,
                reconcile: async () => {},
                onError: (err) =>
                    toastRpcError(toast, err, 'Failed to remove assignment')
            });
            return true;
        } catch {
            return false;
        }
    }

    // Per-location guards: a write for one location must not discard another
    // location's in-flight read.
    const assignmentGuards = new Map<number, StaleGuard>();

    function assignmentsGuardFor(locationId: number): StaleGuard {
        let guard = assignmentGuards.get(locationId);
        if (!guard) {
            guard = createStaleGuard();
            assignmentGuards.set(locationId, guard);
        }
        return guard;
    }

    // Mutation write: bumps only the touched locations' guards.
    function writeAssignments(
        next: Record<number, LocationAssignment[]>,
        touchedLocationIds: number[]
    ): void {
        for (const id of touchedLocationIds) assignmentsGuardFor(id).bump();
        assignmentsByLocation.value = next;
    }

    // undefined marks a location that had no loaded rows to restore.
    type AssignmentRowsSnapshot = Record<
        number,
        LocationAssignment[] | undefined
    >;

    function snapshotAssignmentRows(
        locationIds: number[]
    ): AssignmentRowsSnapshot {
        const snapshot: AssignmentRowsSnapshot = {};
        for (const id of locationIds) {
            const rows = assignmentsByLocation.value[id];
            snapshot[id] = rows ? [...rows] : undefined;
        }
        return snapshot;
    }

    function snapshotLocationIds(
        snapshot: AssignmentRowsSnapshot | undefined
    ): number[] {
        return Object.keys(snapshot ?? {}).map(Number);
    }

    // Rollback is a write: restores only the snapshotted locations and bumps them.
    function restoreAssignmentRows(
        snapshot: AssignmentRowsSnapshot | undefined
    ): void {
        const next = {...assignmentsByLocation.value};
        for (const [id, rows] of Object.entries(snapshot ?? {})) {
            if (rows) next[Number(id)] = rows;
            else delete next[Number(id)];
        }
        writeAssignments(next, snapshotLocationIds(snapshot));
    }

    function locationsHoldingSubject(input: {
        subjectType: LocationSubjectType;
        subjectId: string;
    }): number[] {
        const key = subjectRefKey(input);
        return Object.entries(assignmentsByLocation.value)
            .filter(([, items]) =>
                items.some((item) => subjectRefKey(item) === key)
            )
            .map(([id]) => Number(id));
    }

    function applyLocationAssignment(
        input: {
            subjectType: LocationSubjectType;
            subjectId: string;
            locationId: number;
        },
        touchedLocationIds: number[]
    ): void {
        const next = removeSubjectFromLocations(touchedLocationIds, input);
        const current = next[input.locationId] ?? [];
        next[input.locationId] = [...current, buildLocationAssignment(input)];
        writeAssignments(next, touchedLocationIds);
    }

    function removeSubjectFromLocations(
        locationIds: number[],
        input: {
            subjectType: LocationSubjectType;
            subjectId: string;
        }
    ): Record<number, LocationAssignment[]> {
        const next = {...assignmentsByLocation.value};
        const removedKey = subjectRefKey(input);
        for (const id of locationIds) {
            const items = next[id];
            if (items) {
                next[id] = items.filter(
                    (item) => subjectRefKey(item) !== removedKey
                );
            }
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
        const guard = assignmentsGuardFor(locationId);
        const token = guard.current();
        try {
            const items = await listAssignments({locationId});
            // A write for this location landed mid-flight; the read is stale.
            if (guard.isStale(token)) return items;
            // Read merge: never bumps, so concurrent reads all land.
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

        const tokens = new Map(
            ids.map((id) => [id, assignmentsGuardFor(id).current()])
        );
        try {
            const items = await listAssignments({locationIds: ids});
            for (const item of items) {
                (grouped[item.locationId] ??= []).push(item);
            }
            // Read merge per location: skip only the ones a write invalidated.
            const fresh: Record<number, LocationAssignment[]> = {};
            for (const id of ids) {
                const token = tokens.get(id);
                if (token === undefined) continue;
                if (assignmentsGuardFor(id).isStale(token)) continue;
                fresh[id] = grouped[id] ?? [];
            }
            assignmentsByLocation.value = {
                ...assignmentsByLocation.value,
                ...fresh
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
        // Cursor pages: offset paging stops at the server's offset cap.
        const pass = await paginateByCursor((cursor) =>
            ws.sendRPC<CursorPage<LocationAssignment>>(
                'FLEET_MANAGER',
                'location.listassignments',
                {...params, limit: PAGE_MAX, ...(cursor ? {cursor} : {})}
            )
        );
        return pass.items;
    }

    // Only the batch-assign event lacks its rows. A burst becomes one bulk
    // read of the loaded locations it names; none while the tab is hidden.
    const staleAssignmentIds = new Set<number>();
    const staleAssignmentsRefresh = deferWhileHidden(() => {
        const ids = [...staleAssignmentIds];
        staleAssignmentIds.clear();
        void fetchAssignmentsBulk(ids);
    });
    const assignmentRefetch = createBatchCoalescer<number>(
        (ids) => {
            for (const id of ids) staleAssignmentIds.add(id);
            staleAssignmentsRefresh.request();
        },
        400,
        2000
    );

    function isAssignmentLoaded(locationId: number): boolean {
        return assignmentsByLocation.value[locationId] !== undefined;
    }

    function readAssignmentEvent(params: Record<string, unknown>): {
        subjectType: LocationSubjectType;
        subjectId: string;
        locationId: number;
    } | null {
        const {subjectType, subjectId, locationId} = params;
        if (typeof subjectType !== 'string') return null;
        if (typeof subjectId !== 'string') return null;
        if (typeof locationId !== 'number') return null;
        return {
            subjectType: subjectType as LocationSubjectType,
            subjectId,
            locationId
        };
    }

    // A batch event, or one without the subject, rereads that location.
    function scheduleAssignmentRead(params: Record<string, unknown>): void {
        const locationId = params.locationId;
        if (typeof locationId !== 'number') return;
        if (isAssignmentLoaded(locationId)) {
            assignmentRefetch.schedule(locationId);
        }
    }

    // The event names the subject and its new location: patch loaded rows.
    function applyAssignmentSetEvent(params: Record<string, unknown>): void {
        const input = readAssignmentEvent(params);
        if (!input) {
            scheduleAssignmentRead(params);
            return;
        }
        const key = subjectRefKey(input);
        const target = assignmentsByLocation.value[input.locationId];
        if (target?.some((item) => subjectRefKey(item) === key)) return;
        const touched = locationsHoldingSubject(input);
        if (!isAssignmentLoaded(input.locationId)) {
            if (touched.length === 0) return;
            writeAssignments(
                removeSubjectFromLocations(touched, input),
                touched
            );
            return;
        }
        applyLocationAssignment(input, [...touched, input.locationId]);
    }

    function applyAssignmentRemovedEvent(
        params: Record<string, unknown>
    ): void {
        const input = readAssignmentEvent(params);
        if (!input) {
            scheduleAssignmentRead(params);
            return;
        }
        if (!isAssignmentLoaded(input.locationId)) return;
        writeAssignments(
            removeSubjectFromLocations([input.locationId], input),
            [input.locationId]
        );
    }

    ws.onLocationEvent((e) => {
        const id = e.params.id as number | undefined;
        if (e.method === LOCATION_EVENT.DELETED) {
            if (typeof id === 'number') {
                const next = {...locations.value};
                delete next[id];
                writeLocations(
                    next,
                    rootIds.value.filter((r) => r !== id)
                );
                const nextAssign = {...assignmentsByLocation.value};
                delete nextAssign[id];
                writeAssignments(nextAssign, [id]);
            }
            return;
        }
        if (e.method === LOCATION_EVENT.ASSIGNMENT_SET) {
            applyAssignmentSetEvent(e.params);
            return;
        }
        if (e.method === LOCATION_EVENT.ASSIGNMENT_REMOVED) {
            applyAssignmentRemovedEvent(e.params);
            return;
        }
        if (e.method === LOCATION_EVENT.ASSIGNMENTS_SET) {
            scheduleAssignmentRead(e.params);
            return;
        }
        if (typeof id === 'number') void fetchLocation(id);
    });

    // location_assignments holds devices, entities and groups in one table, so
    // one write path serves all three. assignDevices/assignGroups only name the
    // subject type for their caller.
    async function assignDevices(
        deviceIds: string[],
        locationId: number
    ): Promise<{ok: boolean; succeeded: string[]; failed: string[]}> {
        return assignSubjectsOfType('device', deviceIds, locationId);
    }

    async function assignGroups(
        groupIds: number[],
        locationId: number
    ): Promise<{ok: boolean; succeeded: string[]; failed: string[]}> {
        return assignSubjectsOfType(
            'group',
            groupIds.map((id) => String(id)),
            locationId
        );
    }

    async function assignSubjectsOfType(
        subjectType: LocationSubjectType,
        subjectIds: string[],
        locationId: number
    ): Promise<{ok: boolean; succeeded: string[]; failed: string[]}> {
        const ids = [...new Set(subjectIds)];
        if (ids.length === 0) {
            return {ok: true, succeeded: [], failed: []};
        }
        const subjects = ids.map((id) => ({
            subjectType,
            subjectId: id
        }));
        try {
            // One atomic batch RPC instead of one setAssignment per device.
            await runOptimisticMutation({
                snapshot: () =>
                    snapshotAssignmentRows([
                        ...new Set([
                            ...subjects.flatMap((s) =>
                                locationsHoldingSubject(s)
                            ),
                            locationId
                        ])
                    ]),
                apply: (snapshot) => {
                    const touched = snapshotLocationIds(snapshot);
                    for (const s of subjects) {
                        applyLocationAssignment({...s, locationId}, touched);
                    }
                },
                commit: async () => {
                    await ws.sendRPC(
                        'FLEET_MANAGER',
                        'location.setassignments',
                        {locationId, subjects}
                    );
                },
                rollback: restoreAssignmentRows,
                reconcile: async () => {
                    await fetchAssignments(locationId);
                },
                onError: (err) =>
                    toastRpcError(
                        toast,
                        err,
                        `Failed to assign ${subjectType === 'group' ? 'groups' : 'devices'}`
                    )
            });
            // Atomic: all landed, or the mutation threw and rolled back.
            return {ok: true, succeeded: ids, failed: []};
        } catch {
            return {ok: false, succeeded: [], failed: ids};
        }
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
        assignDevices,
        assignGroups
    };
});
