// Curated location namespace as a factory over injected RPC access.

import type {
    LocationCustomFields,
    LocationKind,
    LocationKindFields,
    LocationSubjectType
} from '@api/location';
import type {
    HostMethod,
    HostParams,
    HostResult
} from '../../generated/contract';
import type {HostLocationListParams} from '../data-contract';
import {namespaceCaller} from '../namespace-caller';
import type {FleetRpcAccess} from '../types';

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

export type LocationAssignmentQuery = {
    subjectType?: LocationSubjectType;
    subjectId?: string;
    locationId?: number;
    locationIds?: number[];
};

export type FleetLocationDomain = ReturnType<typeof createLocationDomain>;

type LocationMethod = Extract<HostMethod, `location.${string}`>;

type LocationListRow = HostResult<'location.list'>['items'][number];
type LocationChildRow = HostResult<'location.children'>['items'][number];
type LocationAssignmentRow =
    HostResult<'location.listassignments'>['items'][number];

export function createLocationDomain(access: FleetRpcAccess) {
    const call = namespaceCaller<LocationMethod>(access);
    const domain = {
        list(params: HostLocationListParams = {}): Promise<LocationListRow[]> {
            return access.rpcListAll<LocationListRow>('location.list', params);
        },
        children(
            id: number,
            params: Omit<LocationListParams, 'parentLocationId'> = {}
        ): Promise<LocationChildRow[]> {
            return access.rpcListAll<LocationChildRow>('location.children', {
                id,
                ...params
            });
        },
        async descendants(id: number, includeSelf = true): Promise<number[]> {
            const result = await call('location.descendants', {
                id,
                includeSelf
            });
            return result.items;
        },
        get(id: number): Promise<HostResult<'location.get'>> {
            return call('location.get', {id});
        },
        async path(id: number): Promise<HostResult<'location.path'>['items']> {
            const res = await call('location.path', {id});
            return res.items ?? [];
        },
        listKinds(): Promise<HostResult<'location.listkinds'>> {
            return call('location.listkinds', {});
        },
        create(
            input: LocationCreateInput
        ): Promise<HostResult<'location.create'>> {
            return call('location.create', input);
        },
        update(
            id: number,
            patch: LocationUpdateInput
        ): Promise<HostResult<'location.update'>> {
            return call('location.update', {id, ...patch});
        },
        delete(id: number): Promise<HostResult<'location.delete'>> {
            return call('location.delete', {id});
        },
        deleteSubtree(
            id: number
        ): Promise<HostResult<'location.deletesubtree'>> {
            return call('location.deletesubtree', {id});
        },
        assign(
            subjectType: LocationSubjectType,
            subjectId: string,
            locationId: number
        ): Promise<HostResult<'location.setassignment'>> {
            return call('location.setassignment', {
                subjectType,
                subjectId,
                locationId
            });
        },
        assignDevice(
            locationId: number,
            shellyID: string
        ): Promise<HostResult<'location.setassignment'>> {
            return domain.assign('device', shellyID, locationId);
        },
        removeAssignment(
            subjectType: LocationSubjectType,
            subjectId: string
        ): Promise<HostResult<'location.removeassignment'>> {
            return call('location.removeassignment', {
                subjectType,
                subjectId
            });
        },
        removeDeviceAssignment(
            shellyID: string
        ): Promise<HostResult<'location.removeassignment'>> {
            return domain.removeAssignment('device', shellyID);
        },
        assignments(
            params: LocationAssignmentQuery = {}
        ): Promise<LocationAssignmentRow[]> {
            return access.rpcListAll<LocationAssignmentRow>(
                'location.listassignments',
                params
            );
        },
        /** Many subjects onto one location in one atomic upsert. */
        setAssignments(
            params: HostParams<'location.setassignments'>
        ): Promise<HostResult<'location.setassignments'>> {
            return call('location.setassignments', params);
        },
        /** One transaction owns device placement, selected entities and the
         * optional catalog classification. */
        configureDeviceAssignment(
            params: HostParams<'location.configuredeviceassignment'>
        ): Promise<HostResult<'location.configuredeviceassignment'>> {
            return call('location.configuredeviceassignment', params);
        },
        deviceAssignmentProfiles(
            params: HostParams<'location.listdeviceassignmentprofiles'> = {}
        ): Promise<
            HostResult<'location.listdeviceassignmentprofiles'>['items']
        > {
            return access.rpcListAll<
                HostResult<'location.listdeviceassignmentprofiles'>['items'][number]
            >('location.listdeviceassignmentprofiles', params);
        },
        listCountries(): Promise<HostResult<'location.listcountries'>> {
            return call('location.listcountries', {});
        },
        listRegions(
            params: HostParams<'location.listregions'>
        ): Promise<HostResult<'location.listregions'>> {
            return call('location.listregions', params);
        },
        /** Address lookup for the create form. `source` says whether the hit
         *  came from Fleet's own data or an upstream geocoder. */
        searchPlaces(
            params: HostParams<'location.searchplaces'>
        ): Promise<HostResult<'location.searchplaces'>> {
            return call('location.searchplaces', params);
        },
        /** Reverse a map pin through Fleet's cached and rate-limited geocoder. */
        reverseGeocode(
            params: HostParams<'location.reversegeocode'>
        ): Promise<HostResult<'location.reversegeocode'>> {
            return call('location.reversegeocode', params);
        },
        /** Geocodes locations saved before coordinates existed. Long-running
         *  and batched — `remaining` says whether to call it again. */
        backfillGeo(
            params: HostParams<'location.backfillgeo'> = {}
        ): Promise<HostResult<'location.backfillgeo'>> {
            return call('location.backfillgeo', params);
        },
        signalHeatmap(
            params: HostParams<'location.signalheatmap'> = {}
        ): Promise<HostResult<'location.signalheatmap'>> {
            return call('location.signalheatmap', params);
        },
        /** Movement over a past window, for playback on a map. */
        eventReplay(
            params: HostParams<'location.eventreplay'>
        ): Promise<HostResult<'location.eventreplay'>> {
            return call('location.eventreplay', params);
        },
        floorplan: {
            /** The upload goes to the ticket URL, not through RPC. */
            createUploadTicket(
                params: HostParams<'location.floorplan.createuploadticket'>
            ): Promise<HostResult<'location.floorplan.createuploadticket'>> {
                return call('location.floorplan.createuploadticket', params);
            }
        },
        /** Devices in this location and all descendants, resolved by Fleet's
         * canonical scope resolver (including custom-device suppression).
         * Reads `fleet.getmetrics` — the devices ride in a metrics envelope. */
        async scopedDevices(
            id: number
        ): Promise<HostResult<'fleet.getmetrics'>['devices']> {
            const result = await access.rpc<HostResult<'fleet.getmetrics'>>(
                'fleet.getmetrics',
                {scope: {locationId: id}}
            );
            return result.devices;
        }
    };
    return domain;
}
