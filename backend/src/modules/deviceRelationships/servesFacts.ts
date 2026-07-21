import * as postgres from '../PostgresProvider';
import {
    filterMembershipDetails,
    queryGroupMembershipDetails,
    queryLocationMembershipDetails,
    readableResourceId
} from './membershipFacts';
import {
    deviceLabelForExternalId,
    filterAccessibleExternalIds,
    requireOrganization
} from './relationshipShared';
import type {
    MembershipDetails,
    OrganizationRelationshipLoadInput,
    RelationshipLoadInput,
    ServesRelationshipRow
} from './relationshipTypes';
import type {
    RelationshipServesEndpointFact,
    RelationshipServesFact
} from './types';

export async function loadIncludedServesFacts(
    input: RelationshipLoadInput
): Promise<RelationshipServesFact[]> {
    if (!input.includes.has('serves') || !input.organizationId) return [];
    const scopedInput = requireOrganization(input);
    const rows = await queryServesRelationshipRows(scopedInput);
    const visibleRows = await visibleServesRows(scopedInput, rows);
    const details = await loadServesEndpointDetails(scopedInput, visibleRows);
    return visibleRows.map((row) => servesFact(row, details));
}

async function queryServesRelationshipRows(
    input: OrganizationRelationshipLoadInput
): Promise<ServesRelationshipRow[]> {
    return await postgres.queryRows<ServesRelationshipRow>(
        `SELECT
             'device' AS source_kind,
             source_device_id AS source_id,
             target_kind,
             target_id,
             relation,
             weight
           FROM device.v_device_serves_api
          WHERE organization_id = $1
            AND (
                source_device_id = $2
                OR (target_kind = 'device' AND target_id = $2)
            )
          ORDER BY relation, source_device_id, target_kind, target_id
          LIMIT 500`,
        [input.organizationId, input.centerExternalId]
    );
}

async function visibleServesRows(
    input: OrganizationRelationshipLoadInput,
    rows: readonly ServesRelationshipRow[]
): Promise<ServesRelationshipRow[]> {
    const visibleDevices = await filterAccessibleExternalIds(
        input,
        servesEndpointDeviceIds(input.centerExternalId, rows)
    );
    return rows.filter((row) =>
        servesRowIsVisible({input, row, visibleDevices})
    );
}

function servesEndpointDeviceIds(
    centerExternalId: string,
    rows: readonly ServesRelationshipRow[]
): string[] {
    return rows
        .flatMap((row) => [
            row.source_kind === 'device' ? row.source_id : null,
            row.target_kind === 'device' ? row.target_id : null
        ])
        .filter((id): id is string => id !== null)
        .filter((id, index, ids) => ids.indexOf(id) === index)
        .filter((id) => id !== centerExternalId);
}

function servesRowIsVisible(input: {
    input: OrganizationRelationshipLoadInput;
    row: ServesRelationshipRow;
    visibleDevices: ReadonlySet<string>;
}): boolean {
    return (
        servesEndpointIsVisible({
            input: input.input,
            kind: input.row.source_kind,
            id: input.row.source_id,
            visibleDevices: input.visibleDevices
        }) &&
        servesEndpointIsVisible({
            input: input.input,
            kind: input.row.target_kind,
            id: input.row.target_id,
            visibleDevices: input.visibleDevices
        })
    );
}

function servesEndpointIsVisible(input: {
    input: OrganizationRelationshipLoadInput;
    kind: RelationshipServesEndpointFact['kind'];
    id: string;
    visibleDevices: ReadonlySet<string>;
}): boolean {
    if (input.kind === 'device') {
        return (
            input.id === input.input.centerExternalId ||
            input.visibleDevices.has(input.id)
        );
    }
    return readableResourceId({
        allowedIds:
            input.kind === 'group'
                ? input.input.readableResources?.groups
                : input.input.readableResources?.locations,
        id: input.id
    });
}

async function loadServesEndpointDetails(
    input: OrganizationRelationshipLoadInput,
    rows: readonly ServesRelationshipRow[]
): Promise<Pick<MembershipDetails, 'groups' | 'locations'>> {
    const [groups, locations] = await Promise.all([
        queryGroupMembershipDetails({
            organizationId: input.organizationId,
            ids: servesEndpointIds(rows, 'group')
        }),
        queryLocationMembershipDetails({
            organizationId: input.organizationId,
            ids: servesEndpointIds(rows, 'location')
        })
    ]);
    return filterMembershipDetails({
        details: {groups, locations, tags: new Map()},
        readableResources: input.readableResources
    });
}

function servesEndpointIds(
    rows: readonly ServesRelationshipRow[],
    kind: 'group' | 'location'
): number[] {
    return rows
        .flatMap((row) => [
            endpointIdForKind(row.source_kind, row.source_id, kind),
            endpointIdForKind(row.target_kind, row.target_id, kind)
        ])
        .filter((id): id is number => id !== null);
}

function endpointIdForKind(
    endpointKind: RelationshipServesEndpointFact['kind'],
    id: string,
    wantedKind: 'group' | 'location'
): number | null {
    if (endpointKind !== wantedKind || !/^[1-9]\d*$/.test(id)) return null;
    return Number(id);
}

function servesFact(
    row: ServesRelationshipRow,
    details: Pick<MembershipDetails, 'groups' | 'locations'>
): RelationshipServesFact {
    return {
        source: servesEndpointFact({
            kind: row.source_kind,
            id: row.source_id,
            details
        }),
        target: servesEndpointFact({
            kind: row.target_kind,
            id: row.target_id,
            details
        }),
        relation: row.relation,
        weight: row.weight == null ? null : Number(row.weight)
    };
}

function servesEndpointFact(input: {
    kind: RelationshipServesEndpointFact['kind'];
    id: string;
    details: Pick<MembershipDetails, 'groups' | 'locations'>;
}): RelationshipServesEndpointFact {
    if (input.kind === 'device') {
        return {
            kind: 'device',
            id: input.id,
            label: deviceLabelForExternalId(input.id)
        };
    }
    const detail =
        input.kind === 'group'
            ? input.details.groups.get(Number(input.id))
            : input.details.locations.get(Number(input.id));
    return {
        kind: input.kind,
        id: input.id,
        label: detail?.label ?? `${input.kind} ${input.id}`,
        imageAssetId: detail?.imageAssetId,
        meta: detail?.meta
    };
}
