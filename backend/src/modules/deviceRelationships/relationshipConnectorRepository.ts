import type {
    DeviceRelationshipInclude,
    RelationshipSummaryDto
} from '../../types/api/device';
import * as postgres from '../PostgresProvider';
import {connectorPoints} from '../virtualDevice/connectorSourceAdapters';
import {needsVirtualRelationships} from './deviceLoadingCore';
import {connectorDeviceLabel, connectorPointLabel} from './relationshipLabels';
import {connectorPointMeta, sourceMeta} from './relationshipRedaction';
import {
    filterAccessibleExternalIds,
    readRecord,
    requireOrganization,
    stringValue
} from './relationshipShared';
import type {
    ConnectorDeviceRow,
    RelationshipConnectorCache
} from './relationshipTypes';
import type {
    RelationshipConnectorPointFact,
    RelationshipDeviceFact
} from './types';

interface RelationshipConnectorInput {
    organizationId: string | undefined;
    centerExternalId: string;
    includes: ReadonlySet<DeviceRelationshipInclude>;
    cache?: RelationshipConnectorCache;
    filterAccessibleDevices?: (
        externalIds: readonly string[]
    ) => Promise<Set<string>>;
}

interface OrganizationRelationshipConnectorInput
    extends RelationshipConnectorInput {
    organizationId: string;
}

export async function loadStoredConnectorCenterDevice(input: {
    organizationId: string;
    centerExternalId: string;
}): Promise<RelationshipDeviceFact | null> {
    const rows = await queryConnectorDeviceRows({
        organizationId: input.organizationId,
        externalIds: [input.centerExternalId]
    });
    return rows[0] ? connectorDeviceRowToFact(rows[0]) : null;
}

export async function loadIncludedRelatedConnectorDevices(input: {
    relationship: RelationshipConnectorInput;
    relatedExternalIds: () => Promise<Set<string>>;
}): Promise<RelationshipDeviceFact[]> {
    if (!needsConnectorRelationships(input.relationship)) return [];
    const scopedInput = requireOrganization(input.relationship);
    const rows = await loadConnectorDeviceRows({
        input: scopedInput,
        relatedExternalIds: input.relatedExternalIds
    });
    const visibleIds = await filterAccessibleExternalIds(
        scopedInput,
        rows.map((row) => row.external_id)
    );
    return rows
        .filter((row) =>
            visibleConnectorRow({input: scopedInput, row, visibleIds})
        )
        .map(connectorDeviceRowToFact);
}

export async function loadIncludedConnectorPointFacts(input: {
    relationship: RelationshipConnectorInput;
    relatedExternalIds: () => Promise<Set<string>>;
}): Promise<RelationshipConnectorPointFact[]> {
    if (!needsConnectorRelationships(input.relationship)) return [];
    const scopedInput = requireOrganization(input.relationship);
    const rows = await loadConnectorDeviceRows({
        input: scopedInput,
        relatedExternalIds: input.relatedExternalIds
    });
    const visibleIds = await filterAccessibleExternalIds(
        scopedInput,
        rows.map((row) => row.external_id)
    );
    return rows
        .filter((row) =>
            visibleConnectorRow({input: scopedInput, row, visibleIds})
        )
        .flatMap(connectorPointFacts);
}

export async function loadConnectorRelationshipSummaries(input: {
    relationship: RelationshipConnectorInput;
    relatedExternalIds: () => Promise<Set<string>>;
}): Promise<RelationshipSummaryDto[]> {
    if (!needsConnectorRelationships(input.relationship)) return [];
    const scopedInput = requireOrganization(input.relationship);
    const rows = await loadConnectorDeviceRows({
        input: scopedInput,
        relatedExternalIds: input.relatedExternalIds
    });
    const visibleIds = await filterAccessibleExternalIds(
        scopedInput,
        rows.map((row) => row.external_id)
    );
    return rows
        .filter((row) =>
            visibleConnectorRow({input: scopedInput, row, visibleIds})
        )
        .map(connectorRelationshipSummary);
}

async function loadConnectorDeviceRows(input: {
    input: OrganizationRelationshipConnectorInput;
    relatedExternalIds: () => Promise<Set<string>>;
}): Promise<ConnectorDeviceRow[]> {
    if (!input.input.cache) {
        return await queryRelatedConnectorDeviceRows(input);
    }
    input.input.cache.connectorDeviceRows ??=
        queryRelatedConnectorDeviceRows(input);
    return await input.input.cache.connectorDeviceRows;
}

async function queryRelatedConnectorDeviceRows(input: {
    input: OrganizationRelationshipConnectorInput;
    relatedExternalIds: () => Promise<Set<string>>;
}): Promise<ConnectorDeviceRow[]> {
    const externalIds = await input.relatedExternalIds();
    return await queryConnectorDeviceRows({
        organizationId: input.input.organizationId,
        externalIds: [...externalIds]
    });
}

async function queryConnectorDeviceRows(input: {
    organizationId: string;
    externalIds: readonly string[];
}): Promise<ConnectorDeviceRow[]> {
    if (input.externalIds.length === 0) return [];
    return await postgres.queryRows<ConnectorDeviceRow>(
        `SELECT
            dl.external_id,
            dl.jdoc,
            dl.jdoc->'info'->>'name' AS name,
            COALESCE(vd.enabled, TRUE) AS enabled
           FROM device.list dl
      LEFT JOIN device.virtual_device vd
             ON vd.device_list_id = dl.id
            AND vd.organization_id = dl.organization_id
            AND vd.deleted_at IS NULL
          WHERE dl.organization_id = $1
            AND dl.kind = 'connector'
            AND dl.external_id = ANY($2::text[])
          ORDER BY dl.external_id ASC`,
        [input.organizationId, [...new Set(input.externalIds)]]
    );
}

function connectorDeviceRowToFact(
    row: ConnectorDeviceRow
): RelationshipDeviceFact {
    return {
        externalId: row.external_id,
        label: connectorDeviceLabel({
            externalId: row.external_id,
            jdocName: stringValue(readRecord(readRecord(row.jdoc).info).name),
            rowName: row.name
        }),
        nodeType: 'device.connector',
        status: row.enabled ? 'unknown' : 'disabled',
        kind: 'connector',
        meta: sourceMeta('connector_jdoc')
    };
}

function connectorPointFacts(
    row: ConnectorDeviceRow
): RelationshipConnectorPointFact[] {
    return connectorPoints(row.jdoc ?? {}).map((point) => ({
        connectorExternalId: row.external_id,
        pointId: point.pointId ?? point.componentKey,
        componentKey: point.componentKey,
        label: connectorPointLabel({
            label: point.label,
            componentKey: point.componentKey
        }),
        protocol: point.protocol,
        status: row.enabled ? 'unknown' : 'disabled',
        meta: connectorPointMeta({
            valueType: point.valueType,
            writable: point.writable
        })
    }));
}

function visibleConnectorRow(input: {
    input: OrganizationRelationshipConnectorInput;
    row: ConnectorDeviceRow;
    visibleIds: ReadonlySet<string>;
}): boolean {
    return (
        input.row.external_id === input.input.centerExternalId ||
        input.visibleIds.has(input.row.external_id)
    );
}

function connectorRelationshipSummary(
    row: ConnectorDeviceRow
): RelationshipSummaryDto {
    return {
        severity: 'info',
        text: `Connector ${row.external_id} relationships are derived from connector jdoc; full connector runtime mappings are not expanded yet.`,
        nodeIds: [`device:${row.external_id}`],
        reasonCode: 'connector_relationships_sparse'
    };
}

function needsConnectorRelationships(
    input: RelationshipConnectorInput
): boolean {
    return (
        Boolean(input.organizationId) &&
        needsVirtualRelationships(input.includes)
    );
}
