import {isBluTransportStale} from '../../config/BTHomeData';
import {toIso} from '../../rpc/pgRows';
import type {RelationshipSummaryDto} from '../../types/api/device';
import type {BluetoothDeviceDto} from '../../types/api/virtualdevice';
import * as DeviceCollector from '../DeviceCollector';
import * as postgres from '../PostgresProvider';
import {
    bluetoothDeviceRelatesToCenter,
    loadBluetoothDevices,
    queryBluetoothTransportRelationshipRows,
    relationshipEndpointIsVisible,
    visibleDeviceRef
} from './deviceLoadingCore';
import {
    filterAccessibleExternalIds,
    requireOrganization
} from './relationshipShared';
import type {
    BluetoothProvenanceRow,
    BluetoothTransportRelationshipRow,
    OrganizationRelationshipLoadInput,
    RelationshipLoadInput
} from './relationshipTypes';
import type {
    RelationshipBluetoothTransportFact,
    RelationshipHistoryEventFact
} from './types';

export function bluetoothLabel(device: BluetoothDeviceDto): string {
    return device.productName ?? device.bleAddress ?? device.externalId;
}

export async function loadIncludedBluetoothTransportFacts(
    input: RelationshipLoadInput
): Promise<RelationshipBluetoothTransportFact[]> {
    if (!input.includes.has('bluetooth') || !input.organizationId) return [];
    const scopedInput = requireOrganization(input);
    const devices = await loadBluetoothDevices(scopedInput);
    const relatedDevices = devices.filter((device) =>
        bluetoothDeviceRelatesToCenter({input: scopedInput, device})
    );
    const rows = await queryBluetoothTransportRelationshipRows({
        organizationId: scopedInput.organizationId,
        externalIds: relatedDevices.map((device) => device.externalId)
    });
    const visibleRows = await visibleBluetoothTransportRows(scopedInput, rows);
    const rowsByExternalId = bluetoothTransportRowsByExternalId(visibleRows);
    return relatedDevices.flatMap((device) =>
        bluetoothTransportFacts({
            device,
            rows: rowsByExternalId.get(device.externalId) ?? []
        })
    );
}

async function visibleBluetoothTransportRows(
    input: OrganizationRelationshipLoadInput,
    rows: readonly BluetoothTransportRelationshipRow[]
): Promise<BluetoothTransportRelationshipRow[]> {
    const visibleIds = await filterAccessibleExternalIds(
        input,
        rows.flatMap(bluetoothTransportDeviceRefs)
    );
    return rows.map((row) =>
        sanitizeBluetoothTransportRow({row, input, visibleIds})
    );
}

function bluetoothTransportDeviceRefs(
    row: BluetoothTransportRelationshipRow
): string[] {
    return [
        row.shelly_device_external_id,
        row.assistant_device_external_id
    ].filter((id): id is string => typeof id === 'string');
}

function sanitizeBluetoothTransportRow(input: {
    row: BluetoothTransportRelationshipRow;
    input: RelationshipLoadInput;
    visibleIds: ReadonlySet<string>;
}): BluetoothTransportRelationshipRow {
    return {
        ...input.row,
        shelly_device_external_id: visibleDeviceRef(
            input.row.shelly_device_external_id,
            input.input,
            input.visibleIds
        ),
        assistant_device_external_id: visibleDeviceRef(
            input.row.assistant_device_external_id,
            input.input,
            input.visibleIds
        )
    };
}

function bluetoothTransportRowsByExternalId(
    rows: readonly BluetoothTransportRelationshipRow[]
): Map<string, BluetoothTransportRelationshipRow[]> {
    const grouped = new Map<string, BluetoothTransportRelationshipRow[]>();
    for (const row of rows) {
        const existing = grouped.get(row.bluetooth_external_id) ?? [];
        existing.push(row);
        grouped.set(row.bluetooth_external_id, existing);
    }
    return grouped;
}

function bluetoothTransportFacts(input: {
    device: BluetoothDeviceDto;
    rows: readonly BluetoothTransportRelationshipRow[];
}): RelationshipBluetoothTransportFact[] {
    if (input.rows.length === 0) {
        return fallbackBluetoothTransportFacts(input.device);
    }
    return input.rows.map((row) =>
        bluetoothTransportRowFact({device: input.device, row})
    );
}

function fallbackBluetoothTransportFacts(
    device: BluetoothDeviceDto
): RelationshipBluetoothTransportFact[] {
    const transport = device.primaryTransport;
    if (!transport) return [];
    return [
        {
            bluetoothExternalId: device.externalId,
            transportId: transport.id,
            gatewayExternalId: transport.shellyDeviceExternalId ?? null,
            gatewayComponentKey: primaryGatewayComponentKey(device),
            label: transport.mode,
            status: bluetoothTransportStatus({
                enabled: transport.enabled,
                lastSeenAt: transport.lastSeenAt,
                modelId: device.modelId
            }),
            meta: {
                mode: transport.mode,
                isPrimary: true,
                canWrite: transport.canWrite,
                lastSeenAt: transport.lastSeenAt,
                lastRssi: transport.lastRssi
            }
        }
    ];
}

function bluetoothTransportRowFact(input: {
    device: BluetoothDeviceDto;
    row: BluetoothTransportRelationshipRow;
}): RelationshipBluetoothTransportFact {
    return {
        bluetoothExternalId: input.device.externalId,
        transportId: input.row.id,
        gatewayExternalId: input.row.shelly_device_external_id,
        gatewayComponentKey: input.row.shelly_device_external_id
            ? primaryGatewayComponentKey(input.device)
            : null,
        label: input.row.mode,
        status: bluetoothTransportStatus({
            enabled: input.row.enabled,
            lastSeenAt: input.row.last_seen_at,
            modelId: input.device.modelId
        }),
        meta: {
            mode: input.row.mode,
            isPrimary: input.row.is_primary,
            canWrite: input.row.can_write,
            assistantDeviceExternalId: input.row.assistant_device_external_id,
            hostAdapterId: input.row.host_adapter_id,
            serialPortRef: input.row.serial_port_ref,
            lastSeenAt: toIso(input.row.last_seen_at),
            lastRssi: input.row.last_rssi
        }
    };
}

function bluetoothTransportStatus(input: {
    enabled: boolean;
    lastSeenAt: Date | string | null;
    modelId: string | null;
}): RelationshipBluetoothTransportFact['status'] {
    if (!input.enabled) return 'disabled';
    return isBluTransportStale(input.lastSeenAt, input.modelId)
        ? 'stale'
        : 'healthy';
}

function primaryGatewayComponentKey(device: BluetoothDeviceDto): string | null {
    return (
        device.components.find((component) => component.role === 'identity')
            ?.componentKey ??
        device.components[0]?.componentKey ??
        null
    );
}

export async function queryBluetoothProvenanceRows(
    input: OrganizationRelationshipLoadInput
): Promise<BluetoothProvenanceRow[]> {
    return await postgres.queryRows<BluetoothProvenanceRow>(
        `SELECT
            bsp.id,
            blu_dl.external_id AS bluetooth_external_id,
            gateway_dl.external_id AS gateway_external_id,
            bsp.component_key,
            bsp.rssi,
            bsp.received_at
           FROM device.blu_sample_provenance bsp
           JOIN device.blu_device bd
             ON bd.device_list_id = bsp.blu_device_list_id
            AND bd.organization_id = $1
           JOIN device.list blu_dl
             ON blu_dl.id = bd.device_list_id
            AND blu_dl.organization_id = bd.organization_id
      LEFT JOIN device.blu_transport bt
             ON bt.id = bsp.transport_id
      LEFT JOIN device.list gateway_dl
             ON gateway_dl.id = bt.shelly_device_list_id
            AND gateway_dl.organization_id = bd.organization_id
          WHERE blu_dl.external_id = $2
             OR gateway_dl.external_id = $2
          ORDER BY bsp.received_at DESC, bsp.id DESC
          LIMIT 25`,
        [input.organizationId, input.centerExternalId]
    );
}

export function bluetoothProvenanceHistoryFact(
    row: BluetoothProvenanceRow
): RelationshipHistoryEventFact {
    return {
        id: `blu_sample:${row.id}`,
        label: `BLU sample heard by ${row.gateway_external_id ?? 'gateway'}`,
        source: 'blu_sample_provenance',
        targetExternalId: row.gateway_external_id ?? row.bluetooth_external_id,
        targetComponentKey: row.gateway_external_id
            ? row.component_key
            : undefined,
        occurredAt: toIso(row.received_at) ?? '',
        edgeType: row.gateway_external_id ? 'heard_by_gateway' : undefined,
        meta: {
            bluetoothExternalId: row.bluetooth_external_id,
            gatewayExternalId: row.gateway_external_id,
            componentKey: row.component_key,
            rssi: row.rssi
        }
    };
}

export async function loadBluetoothRelationshipSummaries(
    input: OrganizationRelationshipLoadInput
): Promise<RelationshipSummaryDto[]> {
    if (!input.includes.has('bluetooth')) return [];
    const devices = await loadRelatedBluetoothDevices(input);
    const [provenanceRows, transportRows] = await Promise.all([
        queryLatestBluetoothProvenanceRows({
            organizationId: input.organizationId,
            externalIds: devices.map((device) => device.externalId)
        }),
        queryBluetoothTransportRelationshipRows({
            organizationId: input.organizationId,
            externalIds: devices.map((device) => device.externalId)
        })
    ]);
    const visibleTransportRows = await visibleBluetoothTransportRows(
        input,
        transportRows
    );
    const visibleProvenanceRows = await visibleBluetoothProvenanceRows(
        input,
        provenanceRows
    );
    const provenanceByDevice = bluetoothProvenanceRowsByExternalId(
        visibleProvenanceRows
    );
    const transportsByDevice =
        bluetoothTransportRowsByExternalId(visibleTransportRows);
    return devices.flatMap((device) =>
        bluetoothRelationshipSummaries({
            device,
            latestProvenance: provenanceByDevice.get(device.externalId),
            transports: transportsByDevice.get(device.externalId) ?? []
        })
    );
}

export async function visibleBluetoothProvenanceRows(
    input: OrganizationRelationshipLoadInput,
    rows: readonly BluetoothProvenanceRow[]
): Promise<BluetoothProvenanceRow[]> {
    const visibleIds = await filterAccessibleExternalIds(
        input,
        rows
            .flatMap((row) => [
                row.bluetooth_external_id,
                row.gateway_external_id
            ])
            .filter((id): id is string => typeof id === 'string')
    );
    return rows
        .filter((row) =>
            relationshipEndpointIsVisible(row.bluetooth_external_id, {
                input,
                visibleIds
            })
        )
        .map((row) => ({
            ...row,
            gateway_external_id: visibleDeviceRef(
                row.gateway_external_id,
                input,
                visibleIds
            )
        }));
}

async function loadRelatedBluetoothDevices(
    input: OrganizationRelationshipLoadInput
): Promise<BluetoothDeviceDto[]> {
    const devices = await loadBluetoothDevices(input);
    return devices.filter((device) =>
        bluetoothDeviceRelatesToCenter({input, device})
    );
}

async function queryLatestBluetoothProvenanceRows(input: {
    organizationId: string;
    externalIds: readonly string[];
}): Promise<BluetoothProvenanceRow[]> {
    if (input.externalIds.length === 0) return [];
    return await postgres.queryRows<BluetoothProvenanceRow>(
        `SELECT DISTINCT ON (blu_dl.external_id)
            bsp.id,
            blu_dl.external_id AS bluetooth_external_id,
            gateway_dl.external_id AS gateway_external_id,
            bsp.component_key,
            bsp.rssi,
            bsp.received_at
           FROM device.blu_sample_provenance bsp
           JOIN device.blu_device bd
             ON bd.device_list_id = bsp.blu_device_list_id
            AND bd.organization_id = $1
           JOIN device.list blu_dl
             ON blu_dl.id = bd.device_list_id
            AND blu_dl.organization_id = bd.organization_id
      LEFT JOIN device.blu_transport bt
             ON bt.id = bsp.transport_id
      LEFT JOIN device.list gateway_dl
             ON gateway_dl.id = bt.shelly_device_list_id
            AND gateway_dl.organization_id = bd.organization_id
          WHERE blu_dl.external_id = ANY($2::text[])
          ORDER BY blu_dl.external_id, bsp.received_at DESC, bsp.id DESC`,
        [input.organizationId, input.externalIds]
    );
}

function bluetoothProvenanceRowsByExternalId(
    rows: readonly BluetoothProvenanceRow[]
): Map<string, BluetoothProvenanceRow> {
    const byDevice = new Map<string, BluetoothProvenanceRow>();
    for (const row of rows) byDevice.set(row.bluetooth_external_id, row);
    return byDevice;
}

function bluetoothRelationshipSummaries(input: {
    device: BluetoothDeviceDto;
    latestProvenance: BluetoothProvenanceRow | undefined;
    transports: readonly BluetoothTransportRelationshipRow[];
}): RelationshipSummaryDto[] {
    return [
        ...bluetoothGatewayHealthSummaries(input),
        bluetoothLastSeenSummary(input)
    ];
}

function bluetoothGatewayHealthSummaries(input: {
    device: BluetoothDeviceDto;
    transports: readonly BluetoothTransportRelationshipRow[];
}): RelationshipSummaryDto[] {
    const gatewayExternalId = primaryBluetoothGatewayExternalId(input);
    if (!gatewayExternalId) return [];
    const gateway = DeviceCollector.getDevice(gatewayExternalId);
    if (!gateway || gateway.presence !== 'offline') return [];
    return [
        {
            severity: 'critical',
            text: `Primary BLU gateway ${gatewayExternalId} for ${bluetoothLabel(input.device)} is offline.`,
            nodeIds: [
                `device:${input.device.externalId}`,
                `device:${gatewayExternalId}`
            ],
            reasonCode: 'blu_primary_gateway_offline'
        }
    ];
}

function primaryBluetoothGatewayExternalId(input: {
    device: BluetoothDeviceDto;
    transports: readonly BluetoothTransportRelationshipRow[];
}): string | null {
    const primaryRow = input.transports.find(
        (transport) => transport.is_primary
    );
    return (
        primaryRow?.shelly_device_external_id ??
        input.device.primaryTransport?.shellyDeviceExternalId ??
        null
    );
}

function bluetoothLastSeenSummary(input: {
    device: BluetoothDeviceDto;
    latestProvenance: BluetoothProvenanceRow | undefined;
    transports: readonly BluetoothTransportRelationshipRow[];
}): RelationshipSummaryDto {
    if (input.latestProvenance) {
        return bluetoothProvenanceSummary(input.device, input.latestProvenance);
    }
    const transport = primaryBluetoothTransport(input);
    if (!transport?.lastSeenAt) return bluetoothNeverSeenSummary(input.device);
    return bluetoothTransportLastSeenSummary({
        device: input.device,
        gatewayExternalId: transport.gatewayExternalId,
        lastSeenAt: transport.lastSeenAt,
        lastRssi: transport.lastRssi
    });
}

function bluetoothProvenanceSummary(
    device: BluetoothDeviceDto,
    row: BluetoothProvenanceRow
): RelationshipSummaryDto {
    const stale = isBluTransportStale(row.received_at, device.modelId);
    return {
        severity: stale ? 'warning' : 'info',
        text: `${bluetoothLabel(device)} was last heard by ${row.gateway_external_id ?? 'a gateway'} at ${toIso(row.received_at) ?? 'an unknown time'}.`,
        nodeIds: bluetoothHeardByNodeIds({
            bluetoothExternalId: device.externalId,
            gatewayExternalId: row.gateway_external_id
        }),
        reasonCode: stale ? 'blu_last_seen_stale' : 'blu_last_seen'
    };
}

function primaryBluetoothTransport(input: {
    device: BluetoothDeviceDto;
    transports: readonly BluetoothTransportRelationshipRow[];
}): {
    gatewayExternalId: string | null;
    lastSeenAt: Date | string | null;
    lastRssi: number | null;
} | null {
    const primaryRow = input.transports.find(
        (transport) => transport.is_primary
    );
    if (primaryRow) return bluetoothTransportLastSeen(primaryRow);
    const primaryTransport = input.device.primaryTransport;
    if (!primaryTransport) return null;
    return {
        gatewayExternalId: primaryTransport.shellyDeviceExternalId ?? null,
        lastSeenAt: primaryTransport.lastSeenAt,
        lastRssi: primaryTransport.lastRssi
    };
}

function bluetoothTransportLastSeen(row: BluetoothTransportRelationshipRow): {
    gatewayExternalId: string | null;
    lastSeenAt: Date | string | null;
    lastRssi: number | null;
} {
    return {
        gatewayExternalId: row.shelly_device_external_id,
        lastSeenAt: row.last_seen_at,
        lastRssi: row.last_rssi
    };
}

function bluetoothNeverSeenSummary(
    device: BluetoothDeviceDto
): RelationshipSummaryDto {
    return {
        severity: 'warning',
        text: `${bluetoothLabel(device)} has no BLU sample provenance or transport last-seen timestamp.`,
        nodeIds: [`device:${device.externalId}`],
        reasonCode: 'blu_last_seen_missing'
    };
}

function bluetoothTransportLastSeenSummary(input: {
    device: BluetoothDeviceDto;
    gatewayExternalId: string | null;
    lastSeenAt: Date | string;
    lastRssi: number | null;
}): RelationshipSummaryDto {
    const stale = isBluTransportStale(input.lastSeenAt, input.device.modelId);
    return {
        severity: stale ? 'warning' : 'info',
        text: `${bluetoothLabel(input.device)} transport was last seen by ${input.gatewayExternalId ?? 'a gateway'} at ${toIso(input.lastSeenAt) ?? 'an unknown time'}.`,
        nodeIds: bluetoothHeardByNodeIds({
            bluetoothExternalId: input.device.externalId,
            gatewayExternalId: input.gatewayExternalId
        }),
        reasonCode: stale ? 'blu_last_seen_stale' : 'blu_last_seen'
    };
}

function bluetoothHeardByNodeIds(input: {
    bluetoothExternalId: string;
    gatewayExternalId: string | null;
}): string[] {
    return input.gatewayExternalId
        ? [
              `device:${input.bluetoothExternalId}`,
              `device:${input.gatewayExternalId}`
          ]
        : [`device:${input.bluetoothExternalId}`];
}
