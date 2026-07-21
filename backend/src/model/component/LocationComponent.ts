import {tuning} from '../../config/tuning';
import {readableResourceAllowlistsAsync} from '../../modules/authz/evaluator/readableResourceAllowlists';
import * as DeviceCollector from '../../modules/DeviceCollector';
import * as EventDistributor from '../../modules/EventDistributor';
import {buildTripPaths, type EventReplayRow} from '../../modules/eventReplay';
import {
    cachedCountries,
    cachedRegionsFor,
    loadCountries,
    loadRegionsByCountry
} from '../../modules/geocoding/geocoding';
import {searchPlaces as runPlaceSearch} from '../../modules/geocoding/searchPlaces';
import {
    backfillGeoBatch,
    DEFAULT_BATCH_SIZE
} from '../../modules/location/backfillGeo';
import {locationCoordinateStatus} from '../../modules/location/coordinateStatus';
import {buildKindsDescribeResponse} from '../../modules/location/kindDescriptors';
import {validateKindFields} from '../../modules/location/validator';
import {
    buildSignalHeatmap,
    type DeviceAtLocation
} from '../../modules/locationHeatmap';
import * as postgres from '../../modules/PostgresProvider';
import {getCachedEventReplay} from '../../modules/repositories/EventReplayCache';
import {
    issueUploadTicket,
    uploadTicketResponse,
    uploadTicketUserFromSender
} from '../../modules/uploadTickets';
import {translatePgError} from '../../rpc/dbErrors';
import type {DescribeOutput} from '../../rpc/describe';
import {buildListResponse} from '../../rpc/listResponse';
import {toIso} from '../../rpc/pgRows';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    LOCATION_BACKFILL_GEO_PARAMS,
    LOCATION_CHILDREN_PARAMS,
    LOCATION_CREATE_PARAMS,
    LOCATION_DELETE_PARAMS,
    LOCATION_DESCRIBE,
    LOCATION_EVENT_REPLAY_PARAMS,
    LOCATION_GET_PARAMS,
    LOCATION_LIST_ASSIGNMENTS_PARAMS,
    LOCATION_LIST_COUNTRIES_PARAMS,
    LOCATION_LIST_KINDS_PARAMS,
    LOCATION_LIST_PARAMS,
    LOCATION_LIST_REGIONS_PARAMS,
    LOCATION_PATH_PARAMS,
    LOCATION_REMOVE_ASSIGNMENT_PARAMS,
    LOCATION_SEARCH_PLACES_PARAMS,
    LOCATION_SET_ASSIGNMENT_PARAMS,
    LOCATION_SET_ASSIGNMENTS_PARAMS,
    LOCATION_SIGNAL_HEATMAP_PARAMS,
    LOCATION_UPDATE_PARAMS,
    type Location,
    type LocationAssignment,
    type LocationBackfillGeoParams,
    type LocationBreadcrumbEntry,
    type LocationCustomFields,
    type LocationEffective,
    type LocationKind,
    type LocationKindFields,
    type LocationListRegionsParams,
    type LocationSearchPlacesParams,
    type LocationSubjectType
} from '../../types/api/location';
import {LOCATION_UPLOAD_TICKET_PARAMS_SCHEMA} from '../../types/api/upload';
import type CommandSender from '../CommandSender';
import Component from './Component';

interface LocationRow {
    id: number;
    organization_id: string;
    name: string;
    kind: LocationKind;
    parent_location_id: number | null;
    sort_order: number;
    timezone: string | null;
    address: Record<string, unknown> | null;
    geo: Record<string, unknown> | null;
    country_code: string | null;
    region_code: string | null;
    currency: string | null;
    regulatory_zone: string | null;
    site_type: string | null;
    building_type: string | null;
    room_type: string | null;
    operational_tier: string | null;
    access_procedure: string | null;
    energy_certification: string | null;
    floor_number: number | null;
    floor_count: number | null;
    gross_floor_area: number | string | null;
    year_built: number | null;
    capacity: number | null;
    room_number: string | null;
    compliance_tags: string[] | null;
    operating_hours: Record<string, unknown> | null;
    primary_contact: Record<string, unknown> | null;
    emergency_contact: Record<string, unknown> | null;
    environmental_setpoint: Record<string, unknown> | null;
    custom_fields: LocationCustomFields | null;
    /** Free-form JSONB sidecar. Currently holds .viz with floorPlan,
     *  devicePlacements, zones — surfaced under kindFields by buildKindFields. */
    metadata: Record<string, unknown> | null;
    created_at: Date | string;
    updated_at: Date | string | null;
    c_child_locations?: number | string | null;
    c_devices?: number | string | null;
    c_entities?: number | string | null;
    c_tags?: number | string | null;
    c_descendant_devices?: number | string | null;
    c_descendant_entities?: number | string | null;
    c_groups_referencing?: number | string | null;
}

type ListRow = Partial<LocationRow> & {total_count?: number | string};

/** Assemble the per-kind validated object from the typed columns. */
function buildKindFields(row: LocationRow): LocationKindFields {
    const out: LocationKindFields = {};
    if (row.timezone) out.timezone = row.timezone;
    if (row.country_code) out.countryCode = row.country_code;
    if (row.region_code) out.regionCode = row.region_code;
    if (row.currency) out.currency = row.currency;
    if (row.regulatory_zone) out.regulatoryZone = row.regulatory_zone;
    if (row.site_type) out.siteType = row.site_type;
    if (row.building_type) out.buildingType = row.building_type;
    if (row.room_type) out.roomType = row.room_type;
    if (row.operational_tier) out.operationalTier = row.operational_tier;
    if (row.access_procedure) out.accessProcedure = row.access_procedure;
    if (row.energy_certification) {
        out.energyCertification = row.energy_certification;
    }
    if (row.floor_number !== null) out.floorNumber = row.floor_number;
    if (row.floor_count !== null) out.floorCount = row.floor_count;
    if (row.gross_floor_area !== null) {
        out.grossFloorArea = Number(row.gross_floor_area);
    }
    if (row.year_built !== null) out.yearBuilt = row.year_built;
    if (row.capacity !== null) out.capacity = row.capacity;
    if (row.room_number) out.roomNumber = row.room_number;
    if (row.address) out.address = row.address;
    if (row.geo) out.geo = row.geo;
    if (row.operating_hours) out.operatingHours = row.operating_hours;
    if (row.primary_contact) out.primaryContact = row.primary_contact;
    if (row.emergency_contact) out.emergencyContact = row.emergency_contact;
    if (row.environmental_setpoint) {
        out.environmentalSetpoint = row.environmental_setpoint;
    }
    if (Array.isArray(row.compliance_tags) && row.compliance_tags.length > 0) {
        out.complianceTags = row.compliance_tags;
    }
    const viz =
        row.metadata && typeof row.metadata === 'object'
            ? (row.metadata as Record<string, unknown>).viz
            : null;
    if (viz && typeof viz === 'object') {
        const v = viz as Record<string, unknown>;
        if (v.floorPlan) out.floorPlan = v.floorPlan;
        if (v.devicePlacements) out.devicePlacements = v.devicePlacements;
        if (v.zones) out.zones = v.zones;
    }
    return out;
}

function effectiveFromRow(row: LocationRow): LocationEffective {
    return {
        timezone: row.timezone,
        countryCode: row.country_code,
        currency: row.currency,
        regulatoryZone: row.regulatory_zone,
        complianceTags: row.compliance_tags ?? []
    };
}

function emptyEffective(): LocationEffective {
    return {
        timezone: null,
        countryCode: null,
        currency: null,
        regulatoryZone: null,
        complianceTags: []
    };
}

function rowToLocation(row: LocationRow): Location {
    const kindFields = buildKindFields(row);
    const loc: Location = {
        id: row.id,
        organizationId: row.organization_id,
        name: row.name,
        kind: row.kind,
        parentLocationId: row.parent_location_id,
        sortOrder: row.sort_order,
        kindFields,
        customFields: row.custom_fields ?? {},
        effective: effectiveFromRow(row),
        coordinateStatus: locationCoordinateStatus(kindFields),
        createdAt: toIso(row.created_at) ?? '',
        updatedAt: toIso(row.updated_at)
    };
    if (row.c_child_locations != null) {
        loc.counts = {
            childLocations: Number(row.c_child_locations),
            devices: Number(row.c_devices ?? 0),
            entities: Number(row.c_entities ?? 0),
            tags: Number(row.c_tags ?? 0),
            descendantDevices: Number(row.c_descendant_devices ?? 0),
            descendantEntities: Number(row.c_descendant_entities ?? 0),
            groupsReferencingLocation: Number(row.c_groups_referencing ?? 0)
        };
    }
    return loc;
}

export default class LocationComponent extends Component {
    constructor() {
        super('location', {
            set_config_methods: false,
            auto_apply_config: false,
            viewer_visible: true
        });
    }

    protected override getDefaultConfig(): Record<string, never> {
        return {};
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return LOCATION_DESCRIBE;
    }

    @Component.NoAudit
    @Component.Expose('FloorPlan.CreateUploadTicket')
    @Component.CrudPermission('locations', 'update', (p) => p?.locationId)
    async floorPlanCreateUploadTicket(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{locationId: number}>(
            params,
            LOCATION_UPLOAD_TICKET_PARAMS_SCHEMA
        );
        requireOrganizationId(sender, {});
        return uploadTicketResponse(
            await issueUploadTicket({
                kind: 'floor_plan',
                user: uploadTicketUserFromSender(sender),
                payload: {locationId: p.locationId}
            })
        );
    }

    @Component.Expose('Create')
    @Component.CrudPermission('locations', 'create')
    async create(params: unknown, sender: CommandSender): Promise<Location> {
        const p = validateOrThrow<{
            organizationId?: string;
            name: string;
            kind: LocationKind;
            parentLocationId?: number | null;
            sortOrder?: number;
            kindFields?: LocationKindFields;
            customFields?: LocationCustomFields;
        }>(params, LOCATION_CREATE_PARAMS);
        const orgId = requireOrganizationId(sender, p);
        const parentKind = await this.#parentKind(
            orgId,
            p.parentLocationId ?? null
        );
        const parentCountryCode = await this.#parentCountryCode(
            orgId,
            p.parentLocationId ?? null
        );
        const kindFields = validateKindFields(
            p.kind,
            p.kindFields,
            parentKind,
            parentCountryCode
        );
        const customFields = p.customFields ?? {};

        try {
            const result = await postgres.callMethod(
                'organization.fn_location_create',
                {
                    p_organization_id: orgId,
                    p_name: p.name.trim(),
                    p_kind: p.kind,
                    p_parent_location_id: p.parentLocationId ?? null,
                    p_sort_order: p.sortOrder ?? 0,
                    p_kind_fields: kindFields,
                    p_custom_fields: customFields
                }
            );
            const row = result?.rows?.[0] as LocationRow | undefined;
            if (!row) throw RpcError.OperationFailed('location create');
            EventDistributor.invalidateGroupCache(orgId);
            EventDistributor.emitLocationCreated(row.id, row.name, orgId);
            return rowToLocation(row);
        } catch (err: unknown) {
            throw translateDbError(err, 'create');
        }
    }

    @Component.Expose('Update')
    @Component.CrudPermission('locations', 'update', (p) => p?.id)
    async update(params: unknown, sender: CommandSender): Promise<Location> {
        const p = validateOrThrow<{
            organizationId?: string;
            id: number;
            name?: string;
            parentLocationId?: number | null;
            sortOrder?: number;
            kindFields?: LocationKindFields;
            customFields?: LocationCustomFields;
        }>(params, LOCATION_UPDATE_PARAMS);
        const orgId = requireOrganizationId(sender, p);

        const current = await this.#currentRow(orgId, p.id);
        const nextParentId =
            p.parentLocationId === undefined
                ? current.parent_location_id
                : p.parentLocationId;
        const parentKind = await this.#parentKind(orgId, nextParentId);
        const parentCountryCode = await this.#parentCountryCode(
            orgId,
            nextParentId
        );

        // Top-level shallow merge: partial patches (e.g. only floorPlan) keep
        // sibling keys (geo, devicePlacements, zones) intact. Caller can clear
        // a key by sending it as null.
        const kindFields =
            p.kindFields !== undefined
                ? validateKindFields(
                      current.kind,
                      {...buildKindFields(current), ...p.kindFields},
                      parentKind,
                      parentCountryCode
                  )
                : undefined;

        const clearParent = p.parentLocationId === null;

        try {
            const result = await postgres.callMethod(
                'organization.fn_location_update',
                {
                    p_organization_id: orgId,
                    p_id: p.id,
                    p_name: p.name?.trim() ?? null,
                    p_parent_location_id: clearParent
                        ? null
                        : (p.parentLocationId ?? null),
                    p_clear_parent: clearParent,
                    p_sort_order: p.sortOrder ?? null,
                    p_kind_fields: kindFields ?? null,
                    p_custom_fields: p.customFields ?? null
                }
            );
            const row = result?.rows?.[0] as LocationRow | undefined;
            if (!row)
                throw RpcError.Domain('LocationNotFound', {
                    details: {id: p.id}
                });
            EventDistributor.invalidateGroupCache(orgId);
            EventDistributor.emitLocationUpdated(row.id, row.name, orgId);
            return rowToLocation(row);
        } catch (err: unknown) {
            throw translateDbError(err, 'update');
        }
    }

    @Component.Expose('Delete')
    @Component.CrudPermission('locations', 'delete', (p) => p?.id)
    async delete(
        params: unknown,
        sender: CommandSender
    ): Promise<{deleted: boolean}> {
        const p = validateOrThrow<{organizationId?: string; id: number}>(
            params,
            LOCATION_DELETE_PARAMS
        );
        const orgId = requireOrganizationId(sender, p);

        try {
            const result = await postgres.callMethod(
                'organization.fn_location_delete',
                {p_organization_id: orgId, p_id: p.id}
            );
            const row = result?.rows?.[0] as {deleted: boolean} | undefined;
            const deleted = Boolean(row?.deleted);
            if (deleted) {
                EventDistributor.invalidateGroupCache(orgId);
                EventDistributor.emitLocationDeleted(p.id, orgId);
            }
            return {deleted};
        } catch (err: unknown) {
            throw translateDbError(err, 'delete');
        }
    }

    @Component.NoAudit
    @Component.Expose('Get')
    @Component.CrudPermission('locations', 'read', (p) => p?.id)
    async get(params: unknown, sender: CommandSender): Promise<Location> {
        const p = validateOrThrow<{
            organizationId?: string;
            id: number;
            includeSummary?: boolean;
        }>(params, LOCATION_GET_PARAMS);
        const orgId = requireOrganizationId(sender, p);

        const scope = await readableResourceAllowlistsAsync(sender);
        const result = await postgres.callMethod(
            'organization.fn_location_get',
            {
                p_organization_id: orgId,
                p_id: p.id,
                p_include_summary: p.includeSummary ?? false,
                p_allowed_location_ids: scope.locations,
                p_allowed_device_ids: scope.devices,
                p_allowed_group_ids: scope.groups,
                p_allowed_tag_ids: scope.tags
            }
        );
        const row = result?.rows?.[0] as LocationRow | undefined;
        if (!row)
            throw RpcError.Domain('LocationNotFound', {details: {id: p.id}});
        const loc = rowToLocation(row);
        loc.effective = await this.#resolveEffective(orgId, row.id);
        return loc;
    }

    async #resolveEffective(
        orgId: string,
        id: number
    ): Promise<LocationEffective> {
        const byId = await this.#resolveEffectiveMany(orgId, [id]);
        return byId.get(id) ?? emptyEffective();
    }

    async #resolveEffectiveMany(
        orgId: string,
        ids: readonly number[]
    ): Promise<Map<number, LocationEffective>> {
        const out = new Map<number, LocationEffective>();
        if (ids.length === 0) return out;
        const result = await postgres.callMethod(
            'organization.fn_location_resolve_effective_many',
            {p_organization_id: orgId, p_ids: ids}
        );
        const rows = (result?.rows ?? []) as {
            id: number;
            timezone: string | null;
            country_code: string | null;
            currency: string | null;
            regulatory_zone: string | null;
            compliance_tags: string[] | null;
        }[];
        for (const r of rows) {
            out.set(r.id, {
                timezone: r.timezone ?? null,
                countryCode: r.country_code ?? null,
                currency: r.currency ?? null,
                regulatoryZone: r.regulatory_zone ?? null,
                complianceTags: r.compliance_tags ?? []
            });
        }
        return out;
    }

    @Component.NoAudit
    @Component.Expose('List')
    @Component.CrudPermission('locations', 'read')
    async list(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            organizationId?: string;
            parentLocationId?: number | null;
            rootsOnly?: boolean;
            limit?: number;
            offset?: number;
            includeSummary?: boolean;
            includeEffective?: boolean;
        }>(params, LOCATION_LIST_PARAMS);
        const orgId = requireOrganizationId(sender, p);
        const rootsOnly = p.rootsOnly ?? p.parentLocationId === null;
        const parentId =
            typeof p.parentLocationId === 'number' ? p.parentLocationId : null;
        return this.#listLocations(sender, {
            orgId,
            parentId,
            rootsOnly,
            limit: p.limit ?? 200,
            offset: p.offset ?? 0,
            includeSummary: p.includeSummary ?? false,
            includeEffective: p.includeEffective ?? false
        });
    }

    // Shared body for List/Children — differ only in parentId/rootsOnly.
    async #listLocations(
        sender: CommandSender,
        opts: {
            orgId: string;
            parentId: number | null;
            rootsOnly: boolean;
            limit: number;
            offset: number;
            includeSummary: boolean;
            includeEffective: boolean;
        }
    ) {
        const scope = await readableResourceAllowlistsAsync(sender);
        const result = await postgres.callMethod(
            'organization.fn_location_list',
            {
                p_organization_id: opts.orgId,
                p_parent_id: opts.parentId,
                p_roots_only: opts.rootsOnly,
                p_limit: opts.limit,
                p_offset: opts.offset,
                p_allowed_ids: scope.locations,
                p_include_summary: opts.includeSummary,
                p_allowed_device_ids: scope.devices,
                p_allowed_group_ids: scope.groups,
                p_allowed_tag_ids: scope.tags
            }
        );
        const rows = (result?.rows ?? []) as ListRow[];
        const total = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
        const items: Location[] = [];
        for (const r of rows) {
            if (r.id == null) continue;
            items.push(rowToLocation(r as LocationRow));
        }
        if (opts.includeEffective && items.length > 0) {
            const byId = await this.#resolveEffectiveMany(
                opts.orgId,
                items.map((i) => i.id)
            );
            for (const loc of items) {
                const eff = byId.get(loc.id);
                if (eff) loc.effective = eff;
            }
        }
        return buildListResponse(items, total, opts.limit, opts.offset);
    }

    @Component.NoAudit
    @Component.Expose('Children')
    @Component.CrudPermission('locations', 'read', (p) => p?.id)
    async children(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            organizationId?: string;
            id: number;
            limit?: number;
            offset?: number;
            includeSummary?: boolean;
            includeEffective?: boolean;
        }>(params, LOCATION_CHILDREN_PARAMS);
        const orgId = requireOrganizationId(sender, p);
        return this.#listLocations(sender, {
            orgId,
            parentId: p.id,
            rootsOnly: false,
            limit: p.limit ?? 200,
            offset: p.offset ?? 0,
            includeSummary: p.includeSummary ?? false,
            includeEffective: p.includeEffective ?? false
        });
    }

    @Component.NoAudit
    @Component.Expose('Path')
    @Component.CrudPermission('locations', 'read', (p) => p?.id)
    async path(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{organizationId?: string; id: number}>(
            params,
            LOCATION_PATH_PARAMS
        );
        const orgId = requireOrganizationId(sender, p);

        const result = await postgres.callMethod(
            'organization.fn_location_path',
            {p_organization_id: orgId, p_id: p.id}
        );
        const rows = (result?.rows ?? []) as Array<{
            id: number;
            name: string;
            kind: LocationKind;
        }>;
        if (rows.length === 0)
            throw RpcError.Domain('LocationNotFound', {details: {id: p.id}});
        const items: LocationBreadcrumbEntry[] = rows.map((r) => ({
            id: r.id,
            name: r.name,
            kind: r.kind
        }));
        return {items};
    }

    @Component.NoAudit
    @Component.Expose('ListKinds')
    @Component.NoPermissions
    listKinds(params: unknown) {
        validateOrThrow<Record<string, never>>(
            params,
            LOCATION_LIST_KINDS_PARAMS
        );
        return buildKindsDescribeResponse();
    }

    @Component.NoAudit
    @Component.Expose('SearchPlaces')
    @Component.CrudPermission('locations', 'read')
    async searchPlaces(params: unknown) {
        const p = validateOrThrow<LocationSearchPlacesParams>(
            params,
            LOCATION_SEARCH_PLACES_PARAMS
        );
        return await runPlaceSearch({
            query: p.query,
            biasCountryCode: p.biasCountryCode ?? null,
            limit: p.limit ?? 5,
            precision: p.precision
        });
    }

    @Component.NoAudit
    @Component.Expose('ListCountries')
    @Component.NoPermissions
    async listCountries(params: unknown) {
        validateOrThrow<Record<string, never>>(
            params,
            LOCATION_LIST_COUNTRIES_PARAMS
        );
        const countries = cachedCountries() ?? (await loadCountries());
        return {countries};
    }

    @Component.NoAudit
    @Component.Expose('ListRegions')
    @Component.NoPermissions
    async listRegions(params: unknown) {
        const p = validateOrThrow<LocationListRegionsParams>(
            params,
            LOCATION_LIST_REGIONS_PARAMS
        );
        const code = p.countryCode.toUpperCase();
        const cached = cachedRegionsFor(code);
        if (cached !== null) return {regions: cached};
        // Cache miss = either the import hasn't run yet or this country
        // has no regions. Re-query so the caller still works.
        const all = await loadRegionsByCountry();
        return {regions: all.get(code) ?? []};
    }

    @Component.Expose('BackfillGeo')
    @Component.CrudPermission('locations', 'update')
    async backfillGeo(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<LocationBackfillGeoParams>(
            params,
            LOCATION_BACKFILL_GEO_PARAMS
        );
        const organizationId = requireOrganizationId(sender, {
            organizationId: p.organizationId
        });
        return await backfillGeoBatch({
            organizationId,
            batchSize: p.batchSize ?? DEFAULT_BATCH_SIZE,
            forceRefresh: p.forceRefresh ?? false
        });
    }

    @Component.NoAudit
    @Component.Expose('SignalHeatmap')
    @Component.CrudPermission('locations', 'read')
    async signalHeatmap(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{organizationId?: string}>(
            params,
            LOCATION_SIGNAL_HEATMAP_PARAMS
        );
        const orgId = requireOrganizationId(sender, p);
        const scope = await readableResourceAllowlistsAsync(sender);
        const args: unknown[] = [orgId];
        let scopeFilter = '';
        if (scope.locations !== null) {
            args.push(scope.locations);
            scopeFilter = ` AND l.id = ANY($${args.length}::int[])`;
        }
        const rows = await postgres.queryRows<{
            shelly_id: string;
            lat: number;
            lng: number;
        }>(
            `SELECT dl.external_id AS shelly_id,
                    (l.geo->>'lat')::float8 AS lat,
                    (l.geo->>'lng')::float8 AS lng
               FROM organization.location_assignments la
               JOIN device.list dl
                 ON dl.organization_id = la.organization_id
                AND dl.id = la.device_id
               JOIN organization.locations l
                 ON l.id = la.location_id
                AND l.organization_id = la.organization_id
              WHERE la.organization_id = $1
                AND la.subject_type = 'device'
                AND l.geo IS NOT NULL
                AND l.geo ? 'lat'
                AND l.geo ? 'lng'${scopeFilter}`,
            args
        );
        const candidates: DeviceAtLocation[] = [];
        for (const row of rows) {
            const device = DeviceCollector.getDevice(row.shelly_id);
            const rssi =
                typeof device?.status?.wifi?.rssi === 'number'
                    ? (device.status.wifi.rssi as number)
                    : null;
            candidates.push({
                shellyID: row.shelly_id,
                rssi,
                lat: row.lat,
                lng: row.lng
            });
        }
        return {points: buildSignalHeatmap(candidates)};
    }

    @Component.NoAudit
    @Component.Expose('EventReplay')
    @Component.CrudPermission('locations', 'read')
    async eventReplay(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            organizationId?: string;
            from: string;
            to: string;
            eventTypes?: string[];
            maxDevices?: number;
        }>(params, LOCATION_EVENT_REPLAY_PARAMS);
        const orgId = requireOrganizationId(sender, p);
        const maxDevices = p.maxDevices ?? 200;
        const scope = await readableResourceAllowlistsAsync(sender);

        // L2 cache is org-keyed — only safe for org-wide callers; scoped callers bypass.
        if (scope.locations !== null) {
            return runEventReplayQuery(orgId, p, maxDevices, scope.locations);
        }
        return getCachedEventReplay(
            orgId,
            {
                from: p.from,
                to: p.to,
                eventTypes: p.eventTypes,
                maxDevices
            },
            () => runEventReplayQuery(orgId, p, maxDevices, null)
        );
    }

    @Component.Expose('SetAssignment')
    @Component.CrudPermission('locations', 'update', (p) => p?.locationId)
    async setAssignment(
        params: unknown,
        sender: CommandSender
    ): Promise<LocationAssignment> {
        const p = validateOrThrow<{
            organizationId?: string;
            subjectType: LocationSubjectType;
            subjectId: string;
            locationId: number;
        }>(params, LOCATION_SET_ASSIGNMENT_PARAMS);
        const orgId = requireOrganizationId(sender, p);
        await assertLocationSubjectBelongsToOrg(
            orgId,
            p.subjectType,
            p.subjectId
        );

        try {
            const result = await postgres.callMethod(
                'organization.fn_location_set_assignment',
                {
                    p_organization_id: orgId,
                    p_subject_type: p.subjectType,
                    p_subject_id: p.subjectId,
                    p_location_id: p.locationId
                }
            );
            const row = result?.rows?.[0] as AssignmentRow | undefined;
            if (!row) throw RpcError.OperationFailed('location setAssignment');
            EventDistributor.invalidateGroupCache(orgId);
            EventDistributor.emitLocationAssignmentSet(
                p.subjectType,
                p.subjectId,
                p.locationId,
                orgId
            );
            return rowToAssignment(row);
        } catch (err: unknown) {
            if (err instanceof RpcError) throw err;
            throw translatePgError(err, 'location setAssignment');
        }
    }

    // Assign many subjects to one location in a single atomic upsert, instead
    // of one SetAssignment RPC per subject. Validation failure (a subject not
    // in the org) rejects the whole batch; the write itself is all-or-nothing.
    @Component.Expose('SetAssignments')
    @Component.CrudPermission('locations', 'update', (p) => p?.locationId)
    async setAssignments(
        params: unknown,
        sender: CommandSender
    ): Promise<{locationId: number; assigned: LocationAssignment[]}> {
        const p = validateOrThrow<{
            organizationId?: string;
            locationId: number;
            subjects: Array<{
                subjectType: LocationSubjectType;
                subjectId: string;
            }>;
        }>(params, LOCATION_SET_ASSIGNMENTS_PARAMS);
        const orgId = requireOrganizationId(sender, p);

        // Dedup by subject: the PK-conflict upsert cannot touch a row twice in
        // one statement.
        const bySubject = new Map<
            string,
            {subjectType: LocationSubjectType; subjectId: string}
        >();
        for (const s of p.subjects) {
            bySubject.set(`${s.subjectType}:${s.subjectId}`, s);
        }
        const subjects = [...bySubject.values()];

        await assertLocationSubjectsBelongToOrg(orgId, subjects);

        try {
            const result = await postgres.callMethod(
                'organization.fn_location_set_assignment_batch',
                {
                    p_organization_id: orgId,
                    p_location_id: p.locationId,
                    p_subject_types: subjects.map((s) => s.subjectType),
                    p_subject_ids: subjects.map((s) => s.subjectId)
                }
            );
            const rows = (result?.rows ?? []) as AssignmentRow[];
            EventDistributor.invalidateGroupCache(orgId);
            EventDistributor.emitLocationAssignmentsSet(p.locationId, orgId);
            return {
                locationId: p.locationId,
                assigned: rows.map(rowToAssignment)
            };
        } catch (err: unknown) {
            if (err instanceof RpcError) throw err;
            throw translatePgError(err, 'location setAssignments');
        }
    }

    @Component.Expose('RemoveAssignment')
    @Component.CrudPermission('locations', 'update')
    async removeAssignment(
        params: unknown,
        sender: CommandSender
    ): Promise<{removed: boolean; assignment: LocationAssignment | null}> {
        const p = validateOrThrow<{
            organizationId?: string;
            subjectType: LocationSubjectType;
            subjectId: string;
        }>(params, LOCATION_REMOVE_ASSIGNMENT_PARAMS);
        const orgId = requireOrganizationId(sender, p);

        try {
            const result = await postgres.callMethod(
                'organization.fn_location_remove_assignment',
                {
                    p_organization_id: orgId,
                    p_subject_type: p.subjectType,
                    p_subject_id: p.subjectId
                }
            );
            const row = result?.rows?.[0] as AssignmentRow | undefined;
            if (!row) return {removed: false, assignment: null};
            EventDistributor.invalidateGroupCache(orgId);
            EventDistributor.emitLocationAssignmentRemoved(
                p.subjectType,
                p.subjectId,
                row.location_id,
                orgId
            );
            return {removed: true, assignment: rowToAssignment(row)};
        } catch (err: unknown) {
            if (err instanceof RpcError) throw err;
            throw translatePgError(err, 'location removeAssignment');
        }
    }

    @Component.NoAudit
    @Component.Expose('ListAssignments')
    @Component.CrudPermission('locations', 'read')
    async listAssignments(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            organizationId?: string;
            subjectType?: LocationSubjectType;
            subjectId?: string;
            locationId?: number;
            locationIds?: number[];
            limit?: number;
            offset?: number;
        }>(params, LOCATION_LIST_ASSIGNMENTS_PARAMS);
        const orgId = requireOrganizationId(sender, p);
        const limit = p.limit ?? 200;
        const offset = p.offset ?? 0;

        const result = await postgres.callMethod(
            'organization.fn_location_list_assignments',
            {
                p_organization_id: orgId,
                p_subject_type: p.subjectType ?? null,
                p_subject_id: p.subjectId ?? null,
                p_location_id: p.locationId ?? null,
                p_location_ids:
                    Array.isArray(p.locationIds) && p.locationIds.length > 0
                        ? p.locationIds
                        : null,
                p_limit: limit,
                p_offset: offset,
                p_allowed_ids: (await readableResourceAllowlistsAsync(sender))
                    .locations
            }
        );
        const rows = (result?.rows ?? []) as AssignmentListRow[];
        const total = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
        const items: LocationAssignment[] = [];
        for (const r of rows) {
            if (r.subject_id == null) continue;
            items.push(rowToAssignment(r as AssignmentRow));
        }
        return buildListResponse(items, total, limit, offset);
    }

    async #currentRow(orgId: string, id: number): Promise<LocationRow> {
        const res = await postgres.callMethod('organization.fn_location_get', {
            p_organization_id: orgId,
            p_id: id,
            p_include_summary: false,
            p_allowed_location_ids: null,
            p_allowed_device_ids: null,
            p_allowed_group_ids: null,
            p_allowed_tag_ids: null
        });
        const row = res?.rows?.[0] as LocationRow | undefined;
        if (!row) throw RpcError.Domain('LocationNotFound', {details: {id}});
        return row;
    }

    async #parentKind(
        orgId: string,
        parentId: number | null
    ): Promise<LocationKind | null> {
        if (parentId == null) return null;
        return (await this.#currentRow(orgId, parentId)).kind;
    }

    async #parentCountryCode(
        orgId: string,
        parentId: number | null
    ): Promise<string | undefined> {
        if (parentId == null) return undefined;
        const row = await this.#currentRow(orgId, parentId);
        return row.country_code ?? undefined;
    }
}

// Live PG path for event-replay. Wrapped by EventReplayCache for L2 (org-keyed; scoped callers bypass).
async function runEventReplayQuery(
    orgId: string,
    p: {from: string; to: string; eventTypes?: string[]},
    maxDevices: number,
    allowedLocationIds: number[] | null
): Promise<{trips: ReturnType<typeof buildTripPaths>}> {
    const args: unknown[] = [orgId, p.from, p.to];
    let eventFilter = '';
    if (p.eventTypes && p.eventTypes.length > 0) {
        args.push(p.eventTypes);
        eventFilter = ` AND a.event_type = ANY($${args.length})`;
    }
    let scopeFilter = '';
    if (allowedLocationIds !== null) {
        args.push(allowedLocationIds);
        scopeFilter = ` AND l.id = ANY($${args.length}::int[])`;
    }
    args.push(tuning.device.eventReplayMaxRows);
    const limitPlaceholder = `$${args.length}`;

    const rows = await postgres.queryRows<{
        shelly_id: string;
        ts_epoch: number | string;
        lat: number;
        lng: number;
    }>(
        `SELECT a.shelly_id,
                EXTRACT(EPOCH FROM a.ts) AS ts_epoch,
                (l.geo->>'lat')::float8 AS lat,
                (l.geo->>'lng')::float8 AS lng
           FROM logging.audit_log a
           JOIN organization.location_assignments la
             ON la.subject_type = 'device'
            AND la.organization_id = $1
           JOIN device.list dl
             ON dl.organization_id = la.organization_id
            AND dl.id = la.device_id
            AND dl.external_id = a.shelly_id
           JOIN organization.locations l
             ON l.id = la.location_id
            AND l.organization_id = la.organization_id
          WHERE a.organization_id = $1
            AND a.ts >= $2 AND a.ts < $3
            AND a.shelly_id IS NOT NULL
            AND l.geo IS NOT NULL
            AND l.geo ? 'lat'
            AND l.geo ? 'lng'${eventFilter}${scopeFilter}
          ORDER BY a.shelly_id, a.ts
          LIMIT ${limitPlaceholder}`,
        args
    );

    const replayRows: EventReplayRow[] = rows.map((r) => ({
        shellyID: r.shelly_id,
        tsEpoch: Number(r.ts_epoch),
        lat: r.lat,
        lng: r.lng
    }));
    return {trips: buildTripPaths(replayRows, maxDevices)};
}

type LocationOp = 'create' | 'update' | 'delete';

interface AssignmentRow {
    organization_id: string;
    subject_type: LocationSubjectType;
    subject_id: string;
    location_id: number;
    created_at: Date | string;
    updated_at: Date | string | null;
}

async function assertGroupBelongsToOrg(
    orgId: string,
    subjectId: string
): Promise<void> {
    const groupId = Number(subjectId);
    if (!Number.isInteger(groupId)) throw RpcError.NotFound('group', subjectId);
    const rows = await postgres.queryRows(
        `SELECT 1 FROM organization.groups
          WHERE organization_id = $1 AND id = $2
          LIMIT 1`,
        [orgId, groupId]
    );
    if (rows.length === 0) throw RpcError.NotFound('group', subjectId);
}

async function assertDeviceSubjectBelongsToOrg(
    orgId: string,
    subjectType: LocationSubjectType,
    subjectId: string
): Promise<void> {
    let shellyID = subjectId;
    if (subjectType === 'entity') {
        const ref = DeviceCollector.findEntityAndDevice(subjectId);
        if (!ref) {
            const rows = await postgres.queryRows(
                `SELECT 1
                   FROM organization.fn_normalize_entity_subject($1, $2)
                  WHERE device_id IS NOT NULL`,
                [orgId, subjectId]
            );
            if (rows.length === 0) throw RpcError.NotFound('entity', subjectId);
            return;
        }
        shellyID = ref.device.shellyID;
    }
    const rows = await postgres.queryRows(
        `SELECT 1 FROM device.list
          WHERE organization_id = $1
            AND external_id = $2
          LIMIT 1`,
        [orgId, shellyID]
    );
    if (rows.length === 0) throw RpcError.NotFound(subjectType, subjectId);
}

async function assertLocationSubjectBelongsToOrg(
    orgId: string,
    subjectType: LocationSubjectType,
    subjectId: string
): Promise<void> {
    if (subjectType === 'group') {
        return assertGroupBelongsToOrg(orgId, subjectId);
    }
    return assertDeviceSubjectBelongsToOrg(orgId, subjectType, subjectId);
}

// Batched membership check for a set of subjects — one query per subject type
// instead of one query per subject (a bulk assign of N would otherwise fire N
// concurrent SELECTs). Same errors as the singular assert.
async function assertLocationSubjectsBelongToOrg(
    orgId: string,
    subjects: Array<{subjectType: LocationSubjectType; subjectId: string}>
): Promise<void> {
    // shellyID -> its original subject, so a missing device reports the right
    // subjectType/subjectId (entity vs device).
    const deviceCheck = new Map<
        string,
        {subjectType: LocationSubjectType; subjectId: string}
    >();
    const legacyEntityCheck = new Map<
        string,
        {subjectType: LocationSubjectType; subjectId: string}
    >();
    const groupIds: number[] = [];
    for (const s of subjects) {
        if (s.subjectType === 'group') {
            const gid = Number(s.subjectId);
            if (!Number.isInteger(gid)) {
                throw RpcError.NotFound('group', s.subjectId);
            }
            groupIds.push(gid);
        } else if (s.subjectType === 'entity') {
            const ref = DeviceCollector.findEntityAndDevice(s.subjectId);
            if (!ref) {
                legacyEntityCheck.set(s.subjectId, s);
                continue;
            }
            deviceCheck.set(ref.device.shellyID, s);
        } else {
            deviceCheck.set(s.subjectId, s);
        }
    }

    if (legacyEntityCheck.size > 0) {
        const ids = [...legacyEntityCheck.keys()];
        const rows = await postgres.queryRows<{subject_id: string}>(
            `SELECT input.subject_id
               FROM unnest($2::text[]) input(subject_id)
               CROSS JOIN LATERAL organization.fn_normalize_entity_subject(
                   $1, input.subject_id
               ) normalized
              WHERE normalized.device_id IS NOT NULL`,
            [orgId, ids]
        );
        const found = new Set(rows.map((row) => row.subject_id));
        for (const [subjectId] of legacyEntityCheck) {
            if (!found.has(subjectId)) {
                throw RpcError.NotFound('entity', subjectId);
            }
        }
    }

    if (deviceCheck.size > 0) {
        const ids = [...deviceCheck.keys()];
        const rows = await postgres.queryRows(
            `SELECT external_id FROM device.list
              WHERE organization_id = $1 AND external_id = ANY($2)`,
            [orgId, ids]
        );
        const found = new Set(rows.map((r) => r.external_id as string));
        for (const [shellyID, subj] of deviceCheck) {
            if (!found.has(shellyID)) {
                throw RpcError.NotFound(subj.subjectType, subj.subjectId);
            }
        }
    }

    if (groupIds.length > 0) {
        const rows = await postgres.queryRows(
            `SELECT id FROM organization.groups
              WHERE organization_id = $1 AND id = ANY($2)`,
            [orgId, groupIds]
        );
        const found = new Set(rows.map((r) => Number(r.id)));
        for (const gid of groupIds) {
            if (!found.has(gid)) throw RpcError.NotFound('group', String(gid));
        }
    }
}

type AssignmentListRow = Partial<AssignmentRow> & {
    total_count?: number | string;
};

function rowToAssignment(row: AssignmentRow): LocationAssignment {
    return {
        organizationId: row.organization_id,
        subjectType: row.subject_type,
        subjectId: row.subject_id,
        locationId: row.location_id,
        createdAt: toIso(row.created_at) ?? '',
        updatedAt: toIso(row.updated_at)
    };
}

function translateDbError(err: unknown, operation: LocationOp): RpcError {
    return translatePgError(err, `location ${operation}`, {
        unique: (constraint) =>
            constraint === 'locations_code_unique'
                ? 'LocationCodeConflict'
                : 'LocationNameConflict',
        foreignKey:
            operation === 'delete'
                ? (constraint) =>
                      constraint.startsWith('location_assignments')
                          ? 'LocationDeleteBlockedHasAssignments'
                          : 'LocationDeleteBlockedHasChildren'
                : undefined
    });
}
