import type {
    Location,
    LocationAssignment,
    LocationBreadcrumbEntry,
    LocationCustomFields,
    LocationKind,
    LocationKindFields,
    LocationSubjectType
} from '@api/location';
import {computed, ref} from 'vue';
import {hostListAll, hostRpc} from './rpc';
import type {HostAsyncState} from './types';

type HostLocation = {
    id: number;
    name: string;
    kind: LocationKind;
    parentLocationId?: number | null;
    customFields?: LocationCustomFields;
};

export type LocationCreateInput = {
    name: string;
    kind: LocationKind;
    parentLocationId?: number | null;
    sortOrder?: number;
    kindFields?: LocationKindFields;
    customFields?: LocationCustomFields;
};

export type LocationUpdateInput = {
    name?: string;
    parentLocationId?: number | null;
    sortOrder?: number;
    kindFields?: LocationKindFields;
    customFields?: LocationCustomFields;
};

export type LocationListParams = {
    parentLocationId?: number | null;
    kind?: LocationKind;
    rootsOnly?: boolean;
    query?: string;
    includeSummary?: boolean;
    includeEffective?: boolean;
};

export function useLocations(
    params: LocationListParams = {}
): HostAsyncState<HostLocation[]> {
    const state = ref<'idle' | 'loading' | 'ready' | 'error'>('idle');
    const loading = computed(() => state.value === 'loading');
    const error = ref<string | null>(null);
    const items = ref<HostLocation[]>([]);
    const data = computed(() => items.value);

    async function refresh(): Promise<void> {
        state.value = 'loading';
        error.value = null;
        try {
            const rows = await locations.list(params);
            items.value = rows.map((location) => ({
                id: location.id,
                name: location.name,
                kind: location.kind,
                parentLocationId: location.parentLocationId,
                customFields: location.customFields
            }));
            state.value = 'ready';
        } catch (err) {
            error.value = err instanceof Error ? err.message : String(err);
            state.value = 'error';
        }
    }

    return {state, loading, data, error, refresh};
}

export const locations = {
    list(params: LocationListParams = {}): Promise<Location[]> {
        return hostListAll<Location>('location.list', params);
    },
    children(
        id: number,
        params: Omit<LocationListParams, 'parentLocationId'> = {}
    ) {
        return hostListAll<Location>('location.children', {id, ...params});
    },
    get(id: number): Promise<Location> {
        return hostRpc<Location>('location.get', {id});
    },
    async path(id: number): Promise<LocationBreadcrumbEntry[]> {
        const res = await hostRpc<{items: LocationBreadcrumbEntry[]}>(
            'location.path',
            {id}
        );
        return res.items ?? [];
    },
    listKinds() {
        return hostRpc('location.listkinds', {});
    },
    create(input: LocationCreateInput): Promise<Location> {
        return hostRpc<Location>('location.create', input);
    },
    update(id: number, patch: LocationUpdateInput): Promise<Location> {
        return hostRpc<Location>('location.update', {id, ...patch});
    },
    delete(id: number): Promise<{deleted: boolean}> {
        return hostRpc<{deleted: boolean}>('location.delete', {id});
    },
    assign(
        subjectType: LocationSubjectType,
        subjectId: string,
        locationId: number
    ): Promise<LocationAssignment> {
        return hostRpc<LocationAssignment>('location.setassignment', {
            subjectType,
            subjectId,
            locationId
        });
    },
    assignDevice(
        locationId: number,
        shellyID: string
    ): Promise<LocationAssignment> {
        return locations.assign('device', shellyID, locationId);
    },
    removeAssignment(subjectType: LocationSubjectType, subjectId: string) {
        return hostRpc('location.removeassignment', {subjectType, subjectId});
    },
    removeDeviceAssignment(shellyID: string) {
        return locations.removeAssignment('device', shellyID);
    },
    assignments(
        params: {
            subjectType?: LocationSubjectType;
            subjectId?: string;
            locationId?: number;
            locationIds?: number[];
        } = {}
    ): Promise<LocationAssignment[]> {
        return hostListAll<LocationAssignment>(
            'location.listassignments',
            params
        );
    }
};
