import {toIso} from '../../rpc/pgRows';
import * as postgres from '../PostgresProvider';
import {
    bluetoothProvenanceHistoryFact,
    queryBluetoothProvenanceRows,
    visibleBluetoothProvenanceRows
} from './bluetoothFacts';
import {
    readRecord,
    requireOrganization,
    stringValue
} from './relationshipShared';
import type {
    OrganizationRelationshipLoadInput,
    RelationshipLoadInput,
    VirtualBindingEventRow
} from './relationshipTypes';
import type {RelationshipHistoryEventFact} from './types';

export async function loadIncludedHistoryEventFacts(
    input: RelationshipLoadInput
): Promise<RelationshipHistoryEventFact[]> {
    if (!needsHistoryEvents(input)) return [];
    if (!input.organizationId) return [];
    const scopedInput = requireOrganization(input);
    const [bluetoothRows, virtualRows] = await Promise.all([
        queryBluetoothProvenanceRows(scopedInput),
        queryVirtualBindingEventRows(scopedInput)
    ]);
    const visibleBluetoothRows = await visibleBluetoothProvenanceRows(
        scopedInput,
        bluetoothRows
    );
    return [
        ...visibleBluetoothRows.map(bluetoothProvenanceHistoryFact),
        ...virtualRows.flatMap(virtualBindingHistoryFacts)
    ];
}

function needsHistoryEvents(input: RelationshipLoadInput): boolean {
    return (
        input.includes.has('provenance') || input.includes.has('recentHistory')
    );
}

async function queryVirtualBindingEventRows(
    input: OrganizationRelationshipLoadInput
): Promise<VirtualBindingEventRow[]> {
    if (!input.includes.has('recentHistory')) return [];
    return await postgres.queryRows<VirtualBindingEventRow>(
        `SELECT
            e.id::text,
            e.event_type,
            COALESCE(
                e.new_source_json->>'roleKey',
                e.old_source_json->>'roleKey',
                b.role_key
            ) AS role_key,
            virtual_dl.external_id AS virtual_external_id,
            e.old_source_json,
            e.new_source_json,
            e.reason,
            e.created_at
           FROM device.virtual_device_binding_event e
           JOIN device.virtual_device vd
             ON vd.device_list_id = e.virtual_device_list_id
            AND vd.organization_id = $1
           JOIN device.list virtual_dl
             ON virtual_dl.id = vd.device_list_id
            AND virtual_dl.organization_id = vd.organization_id
      LEFT JOIN device.virtual_device_binding b
             ON b.id = e.binding_id
          WHERE virtual_dl.external_id = $2
             OR e.old_source_json->>'deviceExternalId' = $2
             OR e.new_source_json->>'deviceExternalId' = $2
          ORDER BY e.created_at DESC, e.id DESC
          LIMIT 50`,
        [input.organizationId, input.centerExternalId]
    );
}

function virtualBindingHistoryFacts(
    row: VirtualBindingEventRow
): RelationshipHistoryEventFact[] {
    return [
        ...virtualBindingSourceHistoryFact({
            row,
            source: readSourceRef(row.old_source_json),
            suffix: 'old',
            label: 'Virtual source retired',
            edgeType: 'retired_source'
        }),
        ...virtualBindingSourceHistoryFact({
            row,
            source: readSourceRef(row.new_source_json),
            suffix: 'new',
            label: 'Virtual source replacement',
            edgeType: 'replaced_source'
        })
    ];
}

function virtualBindingSourceHistoryFact(input: {
    row: VirtualBindingEventRow;
    source: {deviceExternalId: string; componentKey: string} | null;
    suffix: string;
    label: string;
    edgeType: RelationshipHistoryEventFact['edgeType'];
}): RelationshipHistoryEventFact[] {
    if (!input.source) return [];
    return [
        {
            id: `virtual_binding:${input.row.id}:${input.suffix}`,
            label: input.label,
            source: 'virtual_device_binding_event',
            targetExternalId: input.source.deviceExternalId,
            targetComponentKey: input.source.componentKey,
            occurredAt: toIso(input.row.created_at) ?? '',
            edgeType: input.edgeType,
            meta: {
                eventType: input.row.event_type,
                roleKey: input.row.role_key,
                virtualExternalId: input.row.virtual_external_id,
                reason: input.row.reason
            }
        }
    ];
}

function readSourceRef(
    value: unknown
): {deviceExternalId: string; componentKey: string} | null {
    const record = readRecord(value);
    const deviceExternalId = stringValue(record.deviceExternalId);
    const componentKey = stringValue(record.componentKey);
    if (!deviceExternalId || !componentKey) return null;
    return {deviceExternalId, componentKey};
}
