import {randomUUID} from 'node:crypto';
import {
    buildListResponse,
    type ListResponse,
    paginateAndBuild
} from '../../rpc/listResponse';
import RpcError from '../../rpc/RpcError';
import type {
    BluCapability,
    BluetoothDeleteParams,
    BluetoothDeviceCandidateDto,
    BluetoothDeviceCandidateListParams,
    BluetoothDeviceDto,
    BluetoothDeviceListParams,
    BluetoothKeyClearParams,
    BluetoothKeySetRefParams,
    BluetoothPromoteFromGatewayParams,
    BluetoothSourceComponentDto,
    BluetoothTransportDto,
    BluetoothTransportSetPrimaryParams,
    BluetoothUpdateParams
} from '../../types/api/virtualdevice';
import {assertAssetBelongsToOrg} from '../asset/assetRepository';
import * as postgres from '../PostgresProvider';
import {jsonbParam} from '../postgresJsonb';
import {isoOrNull} from '../util/iso';

import type {QueryClient} from './repository';

interface RepositoryDeps {
    queryRows<T = unknown>(
        sql: string,
        params?: readonly unknown[]
    ): Promise<Array<T>>;
    withTransaction<T>(fn: (client: QueryClient) => Promise<T>): Promise<T>;
    makeUuid(): string;
}

interface BluetoothDeviceRow {
    device_list_id: number;
    external_id: string;
    stable_id: string;
    ble_address: string | null;
    product_name: string | null;
    model_id: string | null;
    capability: BluCapability;
    encryption_key_ref: string | null;
    source_components_json: unknown;
    visual_json: Record<string, unknown> | null;
    image_asset_id: string | null;
    primary_transport_id: string | null;
    primary_transport_mode: BluetoothTransportDto['mode'] | null;
    primary_transport_can_write: boolean | null;
    primary_transport_enabled: boolean | null;
    primary_transport_shelly_external_id: string | null;
    primary_transport_assistant_external_id: string | null;
    primary_transport_host_adapter_id: string | null;
    primary_transport_serial_port_ref: string | null;
    primary_transport_last_seen_at: string | Date | null;
    primary_transport_last_rssi: number | null;
}

interface BluetoothTransportRow {
    id: string;
    mode: BluetoothTransportDto['mode'];
    is_primary: boolean;
    can_write: boolean;
    enabled: boolean;
    shelly_device_external_id: string | null;
    host_adapter_id: string | null;
    assistant_device_external_id: string | null;
    serial_port_ref: string | null;
    key_distributed_at: string | Date | null;
    last_seen_at: string | Date | null;
    last_rssi: number | null;
}

interface GatewayCandidateRow {
    gateway_device_list_id: number;
    gateway_external_id: string;
    component_key: string;
    config: unknown;
    all_config: unknown;
    bluetooth_external_id: string | null;
}

interface BluetoothCandidateQuery extends BluetoothDeviceCandidateListParams {
    componentKey?: string;
}

const defaultDeps: RepositoryDeps = {
    queryRows: postgres.queryRows,
    withTransaction: postgres.withQueryTransaction,
    makeUuid: randomUUID
};

export async function listBluetoothDevices(
    organizationId: string,
    params: BluetoothDeviceListParams,
    deps: RepositoryDeps = defaultDeps
): Promise<ListResponse<BluetoothDeviceDto>> {
    const limit = params.limit ?? 200;
    const offset = params.offset ?? 0;
    const filters = buildBluetoothListFilters(organizationId, params);
    const total = await countBluetoothDevices(filters, deps);
    if (total === 0) return buildListResponse([], 0, limit, offset);
    const pagination = buildPaginationClause(filters.values.length, limit);
    const rows = await deps.queryRows<BluetoothDeviceRow>(
        `${bluetoothDeviceSelect()}
         WHERE ${filters.where.join(' AND ')}
         ORDER BY COALESCE(bd.product_name, dl.external_id) ASC
         ${pagination.sql}`,
        [...filters.values, ...pagination.params(offset)]
    );
    return buildListResponse(
        rows.map(rowToBluetoothDevice),
        total,
        limit,
        offset
    );
}

export async function getBluetoothDevice(
    organizationId: string,
    externalId: string,
    deps: RepositoryDeps = defaultDeps
): Promise<BluetoothDeviceDto | null> {
    const rows = await deps.queryRows<BluetoothDeviceRow>(
        `${bluetoothDeviceSelect()}
         WHERE bd.organization_id = $1
           AND dl.external_id = $2
           AND bd.deleted_at IS NULL
         LIMIT 1`,
        [organizationId, externalId]
    );
    return rows[0] ? rowToBluetoothDevice(rows[0]) : null;
}

export async function listBluetoothSourceKeysByGateway(
    organizationId: string | undefined,
    gatewayExternalIds: readonly string[],
    deps: Pick<RepositoryDeps, 'queryRows'> = defaultDeps
): Promise<Map<string, Set<string>>> {
    if (!organizationId || gatewayExternalIds.length === 0) return new Map();
    const rows = await deps.queryRows<{
        gateway_external_id: string;
        source_component_key: string;
    }>(
        `SELECT
            gateway.external_id AS gateway_external_id,
            component->>'componentKey' AS source_component_key
           FROM device.blu_device bd
           JOIN device.blu_transport bt
             ON bt.blu_device_list_id = bd.device_list_id
            AND bt.organization_id = bd.organization_id
            AND bt.mode = 'bthome_gateway'
            AND bt.enabled IS TRUE
           JOIN device.list gateway
             ON gateway.id = bt.shelly_device_list_id
            AND gateway.organization_id = bd.organization_id
           CROSS JOIN LATERAL jsonb_array_elements(
             COALESCE(bd.source_components_json, '[]'::jsonb)
           ) component
          WHERE bd.organization_id = $1
            AND bd.deleted_at IS NULL
            AND gateway.external_id = ANY($2::varchar[])
            AND component->>'componentKey' IS NOT NULL`,
        [organizationId, [...new Set(gatewayExternalIds)]]
    );
    return rowsToGatewaySourceKeys(rows);
}

// Reverse of promotion: given a gateway and one of its bound child component
// keys, find the promoted device's externalId (null if never promoted). Used
// to demote a child when it is unbound from the gateway.
export async function getBluetoothDeviceExternalIdBySource(
    organizationId: string,
    gatewayExternalId: string,
    componentKey: string,
    deps: Pick<RepositoryDeps, 'queryRows'> = defaultDeps
): Promise<string | null> {
    const rows = await deps.queryRows<{external_id: string}>(
        `SELECT dl.external_id AS external_id
           FROM device.blu_device bd
           JOIN device.blu_transport bt
             ON bt.blu_device_list_id = bd.device_list_id
            AND bt.organization_id = bd.organization_id
            AND bt.mode = 'bthome_gateway'
            AND bt.enabled IS TRUE
           JOIN device.list gateway
             ON gateway.id = bt.shelly_device_list_id
            AND gateway.organization_id = bd.organization_id
           JOIN device.list dl
             ON dl.id = bd.device_list_id
            AND dl.organization_id = bd.organization_id
           CROSS JOIN LATERAL jsonb_array_elements(
             COALESCE(bd.source_components_json, '[]'::jsonb)
           ) component
          WHERE bd.organization_id = $1
            AND bd.deleted_at IS NULL
            AND gateway.external_id = $2
            AND component->>'componentKey' = $3
          LIMIT 1`,
        [organizationId, gatewayExternalId, componentKey]
    );
    return rows[0]?.external_id ?? null;
}

export async function deleteBluetoothDevice(
    organizationId: string,
    input: BluetoothDeleteParams,
    deps: RepositoryDeps = defaultDeps
): Promise<{externalId: string; deleted: boolean}> {
    return deps.withTransaction(async (tx) => {
        const device = await lockBluetoothDevice(
            tx,
            organizationId,
            input.externalId
        );
        if (input.retention === 'purge') {
            await purgeBluetoothDevice(tx, organizationId, device.deviceListId);
        } else {
            await tombstoneBluetoothDevice(
                tx,
                organizationId,
                device.deviceListId
            );
        }
        return {externalId: input.externalId, deleted: true};
    });
}

function rowsToGatewaySourceKeys(
    rows: readonly {
        gateway_external_id: string;
        source_component_key: string;
    }[]
): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>();
    for (const row of rows) {
        const keys = out.get(row.gateway_external_id) ?? new Set<string>();
        keys.add(row.source_component_key);
        out.set(row.gateway_external_id, keys);
    }
    return out;
}

export async function listBluetoothCandidates(
    organizationId: string,
    params: BluetoothDeviceCandidateListParams,
    deps: RepositoryDeps = defaultDeps
): Promise<ListResponse<BluetoothDeviceCandidateDto>> {
    const rows = await deps.queryRows<GatewayCandidateRow>(
        bluetoothCandidateSql(params),
        bluetoothCandidateParams(organizationId, params)
    );
    const candidates = rows
        .map(rowToBluetoothCandidate)
        .filter(
            (candidate): candidate is BluetoothDeviceCandidateDto => !!candidate
        );
    return paginateAndBuild(candidates, params, 200);
}

export async function promoteBluetoothFromGateway(
    organizationId: string,
    input: BluetoothPromoteFromGatewayParams,
    actorId: string | null = null,
    deps: RepositoryDeps = defaultDeps
): Promise<BluetoothDeviceDto> {
    return deps.withTransaction(async (tx) => {
        const candidate = await readGatewayCandidate(tx, organizationId, input);
        const promoted = await upsertBluetoothDevice(tx, candidate);
        await upsertGatewayTransport(tx, {
            candidate,
            bluetoothDeviceListId: promoted.device.deviceListId,
            makePrimary: input.makePrimary !== false,
            transportId: deps.makeUuid()
        });
        if (promoted.created) {
            await writeBluetoothKeyEvent(tx, {
                organizationId,
                deviceListId: promoted.device.deviceListId,
                eventType: 'promote',
                keyRef: null,
                actorId,
                reason: `${candidate.gatewayExternalId}:${candidate.componentKey}`,
                id: deps.makeUuid()
            });
        }
        return requireBluetoothDevice(
            tx,
            organizationId,
            promoted.device.externalId
        );
    });
}

export async function listBluetoothTransports(
    organizationId: string,
    externalId: string,
    deps: RepositoryDeps = defaultDeps
): Promise<{items: BluetoothTransportDto[]}> {
    const device = await getBluetoothDevice(organizationId, externalId, deps);
    if (!device) throw RpcError.NotFound('bluetooth_device', externalId);
    const rows = await deps.queryRows<BluetoothTransportRow>(
        `${bluetoothTransportSelect()}
         WHERE bt.organization_id = $1
           AND bt.blu_device_list_id = $2
         ORDER BY bt.is_primary DESC, bt.created_at ASC`,
        [organizationId, device.deviceListId]
    );
    return {items: rows.map(rowToBluetoothTransport)};
}

export async function setPrimaryBluetoothTransport(
    organizationId: string,
    input: BluetoothTransportSetPrimaryParams,
    deps: RepositoryDeps = defaultDeps
): Promise<{items: BluetoothTransportDto[]}> {
    return deps.withTransaction(async (tx) => {
        const device = await lockBluetoothDevice(
            tx,
            organizationId,
            input.externalId
        );
        await requireTransportForDevice(tx, {
            organizationId,
            deviceListId: device.deviceListId,
            transportId: input.transportId
        });
        await tx.query(
            `UPDATE device.blu_transport
                SET is_primary = FALSE,
                    updated_at = NOW()
              WHERE organization_id = $1
                AND blu_device_list_id = $2`,
            [organizationId, device.deviceListId]
        );
        await tx.query(
            `UPDATE device.blu_transport
                SET is_primary = TRUE,
                    enabled = TRUE,
                    updated_at = NOW()
              WHERE organization_id = $1
                AND blu_device_list_id = $2
                AND id = $3`,
            [organizationId, device.deviceListId, input.transportId]
        );
        const rows = await tx.query<BluetoothTransportRow>(
            `${bluetoothTransportSelect()}
             WHERE bt.organization_id = $1
               AND bt.blu_device_list_id = $2
             ORDER BY bt.is_primary DESC, bt.created_at ASC`,
            [organizationId, device.deviceListId]
        );
        return {items: rows.map(rowToBluetoothTransport)};
    });
}

export async function setBluetoothKeyRef(
    organizationId: string,
    input: BluetoothKeySetRefParams,
    actorId: string | null,
    deps: RepositoryDeps = defaultDeps
): Promise<BluetoothDeviceDto> {
    return deps.withTransaction(async (tx) => {
        const device = await lockBluetoothDevice(
            tx,
            organizationId,
            input.externalId
        );
        await updateBluetoothKeyRef(tx, {
            organizationId,
            deviceListId: device.deviceListId,
            keyRef: input.keyRef
        });
        await writeBluetoothKeyEvent(tx, {
            organizationId,
            deviceListId: device.deviceListId,
            eventType: 'set_ref',
            keyRef: input.keyRef,
            actorId,
            reason: input.reason ?? null,
            id: deps.makeUuid()
        });
        return requireBluetoothDevice(tx, organizationId, input.externalId);
    });
}

export async function updateBluetoothDecoration(
    organizationId: string,
    input: BluetoothUpdateParams,
    deps: RepositoryDeps = defaultDeps
): Promise<BluetoothDeviceDto> {
    await assertAssetBelongsToOrg(organizationId, input.imageAssetId);
    return deps.withTransaction(async (tx) => {
        const device = await lockBluetoothDevice(
            tx,
            organizationId,
            input.externalId
        );
        const sets: string[] = [];
        const values: unknown[] = [organizationId, device.deviceListId];
        if (input.visual !== undefined) {
            values.push(jsonbParam(input.visual));
            sets.push(`visual_json = $${values.length}::jsonb`);
        }
        if (input.imageAssetId !== undefined) {
            values.push(input.imageAssetId);
            sets.push(`image_asset_id = $${values.length}`);
        }
        if (sets.length > 0) {
            await tx.query(
                `UPDATE device.blu_device
                    SET ${sets.join(', ')}, updated_at = NOW()
                  WHERE organization_id = $1
                    AND device_list_id = $2`,
                values
            );
        }
        return requireBluetoothDevice(tx, organizationId, input.externalId);
    });
}

export async function clearBluetoothKeyRef(
    organizationId: string,
    input: BluetoothKeyClearParams,
    actorId: string | null,
    deps: RepositoryDeps = defaultDeps
): Promise<BluetoothDeviceDto> {
    return deps.withTransaction(async (tx) => {
        const device = await lockBluetoothDevice(
            tx,
            organizationId,
            input.externalId
        );
        await updateBluetoothKeyRef(tx, {
            organizationId,
            deviceListId: device.deviceListId,
            keyRef: null
        });
        await writeBluetoothKeyEvent(tx, {
            organizationId,
            deviceListId: device.deviceListId,
            eventType: 'clear_ref',
            keyRef: null,
            actorId,
            reason: input.reason ?? null,
            id: deps.makeUuid()
        });
        return requireBluetoothDevice(tx, organizationId, input.externalId);
    });
}

function bluetoothDeviceSelect(): string {
    return `SELECT
        bd.device_list_id,
        dl.external_id,
        bd.stable_id,
        bd.ble_address,
        bd.product_name,
        bd.model_id,
        bd.capability,
        bd.encryption_key_ref,
        bd.source_components_json,
        bd.visual_json,
        bd.image_asset_id,
        pt.id            AS primary_transport_id,
        pt.mode          AS primary_transport_mode,
        pt.can_write     AS primary_transport_can_write,
        pt.enabled       AS primary_transport_enabled,
        shelly.external_id AS primary_transport_shelly_external_id,
        assistant.external_id AS primary_transport_assistant_external_id,
        pt.host_adapter_id AS primary_transport_host_adapter_id,
        pt.serial_port_ref AS primary_transport_serial_port_ref,
        pt.last_seen_at  AS primary_transport_last_seen_at,
        pt.last_rssi     AS primary_transport_last_rssi
      FROM device.blu_device bd
      JOIN device.list dl
        ON dl.id = bd.device_list_id
       AND dl.organization_id = bd.organization_id
 LEFT JOIN LATERAL (
        SELECT
            id,
            mode,
            can_write,
            enabled,
            shelly_device_list_id,
            assistant_device_list_id,
            host_adapter_id,
            serial_port_ref,
            last_seen_at,
            last_rssi
          FROM device.blu_transport
         WHERE blu_device_list_id = bd.device_list_id
           AND organization_id = bd.organization_id
           AND is_primary IS TRUE
         ORDER BY enabled DESC, last_seen_at DESC NULLS LAST
         LIMIT 1
      ) pt ON TRUE
 LEFT JOIN device.list shelly
        ON shelly.id = pt.shelly_device_list_id
       AND shelly.organization_id = bd.organization_id
 LEFT JOIN device.list assistant
        ON assistant.id = pt.assistant_device_list_id
       AND assistant.organization_id = bd.organization_id`;
}

function bluetoothTransportSelect(): string {
    return `SELECT
        bt.id,
        bt.mode,
        bt.is_primary,
        bt.can_write,
        bt.enabled,
        shelly.external_id AS shelly_device_external_id,
        bt.host_adapter_id,
        assistant.external_id AS assistant_device_external_id,
        bt.serial_port_ref,
        bt.key_distributed_at,
        bt.last_seen_at,
        bt.last_rssi
      FROM device.blu_transport bt
      LEFT JOIN device.list shelly
        ON shelly.id = bt.shelly_device_list_id
       AND shelly.organization_id = bt.organization_id
      LEFT JOIN device.list assistant
        ON assistant.id = bt.assistant_device_list_id
       AND assistant.organization_id = bt.organization_id`;
}

async function tombstoneBluetoothDevice(
    tx: QueryClient,
    organizationId: string,
    deviceListId: number
): Promise<void> {
    await tx.query(
        `UPDATE device.blu_device
            SET deleted_at = NOW(),
                updated_at = NOW()
          WHERE organization_id = $1
            AND device_list_id = $2
            AND deleted_at IS NULL`,
        [organizationId, deviceListId]
    );
    await tx.query(
        `UPDATE device.blu_transport
            SET enabled = FALSE,
                updated_at = NOW()
          WHERE organization_id = $1
            AND blu_device_list_id = $2`,
        [organizationId, deviceListId]
    );
}

async function purgeBluetoothDevice(
    tx: QueryClient,
    organizationId: string,
    deviceListId: number
): Promise<void> {
    await tx.query(
        `DELETE FROM device.list
          WHERE organization_id = $1
            AND id = $2`,
        [organizationId, deviceListId]
    );
}

function buildBluetoothListFilters(
    organizationId: string,
    params: BluetoothDeviceListParams
): {where: string[]; values: unknown[]} {
    const values: unknown[] = [organizationId];
    const where = [
        'bd.organization_id = $1',
        'bd.deleted_at IS NULL',
        "dl.kind = 'bluetooth'"
    ];
    if (params.capability) {
        values.push(params.capability);
        where.push(`bd.capability = $${values.length}`);
    }
    if (params.query) {
        values.push(`%${params.query}%`);
        where.push(
            `(dl.external_id ILIKE $${values.length}
              OR bd.stable_id ILIKE $${values.length}
              OR bd.ble_address ILIKE $${values.length}
              OR bd.product_name ILIKE $${values.length}
              OR bd.model_id ILIKE $${values.length})`
        );
    }
    return {where, values};
}

async function countBluetoothDevices(
    filters: {where: string[]; values: unknown[]},
    deps: RepositoryDeps
): Promise<number> {
    const rows = await deps.queryRows<{total_count: string | number}>(
        `SELECT COUNT(*) AS total_count
         ${bluetoothDeviceFrom()}
         WHERE ${filters.where.join(' AND ')}`,
        filters.values
    );
    return Number(rows[0]?.total_count ?? 0);
}

function bluetoothDeviceFrom(): string {
    return `FROM device.blu_device bd
      JOIN device.list dl
        ON dl.id = bd.device_list_id
       AND dl.organization_id = bd.organization_id`;
}

function buildPaginationClause(
    filterValueCount: number,
    limit: number
): {sql: string; params: (offset: number) => unknown[]} {
    if (limit === 0) {
        return {
            sql: `OFFSET $${filterValueCount + 1}`,
            params: (offset) => [offset]
        };
    }
    return {
        sql: `LIMIT $${filterValueCount + 1} OFFSET $${filterValueCount + 2}`,
        params: (offset) => [limit, offset]
    };
}

function bluetoothCandidateSql(params: BluetoothCandidateQuery): string {
    const where = [
        "dl.kind = 'physical'",
        "(entry.key LIKE 'bthomedevice:%' OR entry.key LIKE 'blutrv:%')",
        "entry.value ? 'addr'",
        'dl.organization_id = $1'
    ];
    if (params.gatewayExternalId) where.push('dl.external_id = $2');
    if (params.componentKey) {
        where.push(
            `entry.key = $${bluetoothCandidateParamIndex(params, 'componentKey')}`
        );
    }
    if (params.query) {
        const index = bluetoothCandidateParamIndex(params, 'query');
        where.push(
            `(entry.key ILIKE $${index}
              OR entry.value->>'addr' ILIKE $${index}
              OR entry.value->>'name' ILIKE $${index}
              OR entry.value->'meta'->>'productName' ILIKE $${index}
              OR entry.value->'meta'->>'modelId' ILIKE $${index})`
        );
    }

    return `SELECT
        dl.id AS gateway_device_list_id,
        dl.external_id AS gateway_external_id,
        entry.key AS component_key,
        entry.value AS config,
        COALESCE(dl.jdoc->'settings', '{}'::jsonb) AS all_config,
        promoted.external_id AS bluetooth_external_id
      FROM device.list dl
      CROSS JOIN LATERAL jsonb_each(COALESCE(dl.jdoc->'settings', '{}'::jsonb)) entry
      LEFT JOIN device.blu_device bd
        ON bd.organization_id = dl.organization_id
       AND bd.stable_id = lower(regexp_replace(entry.value->>'addr', '[^0-9A-Fa-f]', '', 'g'))
       AND bd.deleted_at IS NULL
      LEFT JOIN device.list promoted
        ON promoted.id = bd.device_list_id
       AND promoted.organization_id = bd.organization_id
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(entry.value->>'name', entry.value->'meta'->>'productName', entry.value->>'addr') ASC`;
}

function bluetoothCandidateParams(
    organizationId: string,
    params: BluetoothCandidateQuery
): unknown[] {
    const values: unknown[] = [organizationId];
    if (params.gatewayExternalId) values.push(params.gatewayExternalId);
    if (params.componentKey) values.push(params.componentKey);
    if (params.query) values.push(`%${params.query}%`);
    return values;
}

function bluetoothCandidateParamIndex(
    params: BluetoothCandidateQuery,
    field: 'componentKey' | 'query'
): number {
    let index = 1;
    if (params.gatewayExternalId) index += 1;
    if (field === 'componentKey') return index + 1;
    if (params.componentKey) index += 1;
    return index + 1;
}

function rowToBluetoothCandidate(
    row: GatewayCandidateRow
): BluetoothDeviceCandidateDto | null {
    const config = asRecord(row.config);
    const bleAddress = stringValue(config.addr);
    const stableId = stableIdFromAddress(bleAddress);
    if (!stableId) return null;
    const allConfig = asRecord(row.all_config);
    if (isDuplicateTrvBthomeCandidate(row.component_key, bleAddress, allConfig))
        return null;
    const meta = asRecord(config.meta);
    const components = collectBluetoothSourceComponents(
        row.component_key,
        config,
        allConfig
    );
    return {
        gatewayDeviceListId: row.gateway_device_list_id,
        gatewayExternalId: row.gateway_external_id,
        componentKey: row.component_key,
        stableId,
        bleAddress: normalizeBleAddress(bleAddress ?? ''),
        name: stringValue(config.name),
        productName: stringValue(meta.productName),
        modelId: stringValue(meta.modelId),
        capability: capabilityFromSourceComponents(config, components),
        components,
        alreadyPromoted: row.bluetooth_external_id !== null,
        bluetoothExternalId: row.bluetooth_external_id
    };
}

async function readGatewayCandidate(
    tx: QueryClient,
    organizationId: string,
    input: BluetoothPromoteFromGatewayParams
): Promise<BluetoothDeviceCandidateDto> {
    const rows = await tx.query<GatewayCandidateRow>(
        `${bluetoothCandidateSql({
            gatewayExternalId: input.gatewayExternalId,
            componentKey: input.componentKey
        })}
         LIMIT 1`,
        [organizationId, input.gatewayExternalId, input.componentKey]
    );
    const candidate = rows[0] ? rowToBluetoothCandidate(rows[0]) : null;
    if (!candidate)
        throw RpcError.NotFound('bluetooth_candidate', input.componentKey);
    return candidate;
}

async function upsertBluetoothDevice(
    tx: QueryClient,
    candidate: BluetoothDeviceCandidateDto
): Promise<{device: BluetoothDeviceDto; created: boolean}> {
    const existing = await findBluetoothDeviceByStableId(
        tx,
        candidate.gatewayDeviceListId,
        candidate.stableId
    );
    if (existing) {
        await updateBluetoothDeviceMetadata(
            tx,
            existing.deviceListId,
            candidate
        );
        return {
            device: await requireBluetoothDevice(
                tx,
                await organizationIdForDevice(
                    tx,
                    candidate.gatewayDeviceListId
                ),
                existing.externalId
            ),
            created: false
        };
    }
    const organizationId = await organizationIdForDevice(
        tx,
        candidate.gatewayDeviceListId
    );
    // Re-promoting a soft-deleted beacon resurrects the tombstoned row rather
    // than colliding on its still-present blu_<MAC> device.list id.
    const resurrected = await resurrectTombstonedBluetoothDevice(
        tx,
        organizationId,
        candidate
    );
    if (resurrected) return {device: resurrected, created: false};
    // blu_<MAC> is global; a duplicate insert here means another org owns it.
    const externalId = `blu_${candidate.stableId}`;
    let rows: {id: number}[];
    try {
        rows = await tx.query<{id: number}>(
            `INSERT INTO device.list (
                external_id,
                control_access,
                jdoc,
                organization_id,
                kind
            )
            VALUES ($1, 3, '{}'::jsonb, $2, 'bluetooth')
            RETURNING id`,
            [externalId, organizationId]
        );
    } catch (err) {
        if ((err as {code?: string}).code === '23505') {
            throw RpcError.InvalidParams(
                `Bluetooth device ${externalId} is already registered to another organization`
            );
        }
        throw err;
    }
    const deviceListId = rows[0]?.id;
    if (!deviceListId) throw RpcError.OperationFailed('bluetooth promote');
    await tx.query(
        `INSERT INTO device.blu_device (
            device_list_id,
            organization_id,
            stable_id,
            ble_address,
            product_name,
            model_id,
            capability,
            source_components_json
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [
            deviceListId,
            organizationId,
            candidate.stableId,
            candidate.bleAddress,
            candidate.productName ?? candidate.name,
            candidate.modelId,
            candidate.capability,
            jsonbParam(candidate.components)
        ]
    );
    return {
        device: await requireBluetoothDevice(tx, organizationId, externalId),
        created: true
    };
}

// Un-delete a same-org tombstoned beacon and refresh its metadata; null when
// none exists. Lets a re-promote reuse the row instead of a colliding insert.
async function resurrectTombstonedBluetoothDevice(
    tx: QueryClient,
    organizationId: string,
    candidate: BluetoothDeviceCandidateDto
): Promise<BluetoothDeviceDto | null> {
    const rows = await tx.query<{device_list_id: number; external_id: string}>(
        `UPDATE device.blu_device bd
            SET deleted_at = NULL, updated_at = NOW()
           FROM device.list dl
          WHERE dl.id = bd.device_list_id
            AND bd.organization_id = $1
            AND bd.stable_id = $2
            AND bd.deleted_at IS NOT NULL
          RETURNING bd.device_list_id, dl.external_id`,
        [organizationId, candidate.stableId]
    );
    const row = rows[0];
    if (!row) return null;
    await updateBluetoothDeviceMetadata(tx, row.device_list_id, candidate);
    return requireBluetoothDevice(tx, organizationId, row.external_id);
}

async function findBluetoothDeviceByStableId(
    tx: QueryClient,
    gatewayDeviceListId: number,
    stableId: string
): Promise<BluetoothDeviceDto | null> {
    const organizationId = await organizationIdForDevice(
        tx,
        gatewayDeviceListId
    );
    const rows = await tx.query<BluetoothDeviceRow>(
        `${bluetoothDeviceSelect()}
         WHERE bd.organization_id = $1
           AND bd.stable_id = $2
           AND bd.deleted_at IS NULL
         LIMIT 1`,
        [organizationId, stableId]
    );
    return rows[0] ? rowToBluetoothDevice(rows[0]) : null;
}

async function updateBluetoothDeviceMetadata(
    tx: QueryClient,
    deviceListId: number,
    candidate: BluetoothDeviceCandidateDto
): Promise<void> {
    await tx.query(
        `UPDATE device.blu_device
            SET ble_address = COALESCE($2, ble_address),
                product_name = COALESCE($3, product_name),
                model_id = COALESCE($4, model_id),
                capability = $5,
                source_components_json = $6::jsonb,
                updated_at = NOW()
          WHERE device_list_id = $1`,
        [
            deviceListId,
            candidate.bleAddress,
            candidate.productName ?? candidate.name,
            candidate.modelId,
            candidate.capability,
            jsonbParam(candidate.components)
        ]
    );
}

async function upsertGatewayTransport(
    tx: QueryClient,
    input: {
        candidate: BluetoothDeviceCandidateDto;
        bluetoothDeviceListId: number;
        makePrimary: boolean;
        transportId: string;
    }
): Promise<void> {
    const organizationId = await organizationIdForDevice(
        tx,
        input.candidate.gatewayDeviceListId
    );
    if (input.makePrimary) {
        await tx.query(
            `UPDATE device.blu_transport
                SET is_primary = FALSE,
                    updated_at = NOW()
              WHERE organization_id = $1
                AND blu_device_list_id = $2`,
            [organizationId, input.bluetoothDeviceListId]
        );
    }
    const existing = await tx.query<{id: string}>(
        `SELECT id
           FROM device.blu_transport
          WHERE organization_id = $1
            AND blu_device_list_id = $2
            AND mode = 'bthome_gateway'
            AND shelly_device_list_id = $3
          LIMIT 1`,
        [
            organizationId,
            input.bluetoothDeviceListId,
            input.candidate.gatewayDeviceListId
        ]
    );
    if (existing[0]) {
        const canWrite = candidateTransportCanWrite(input.candidate);
        await tx.query(
            `UPDATE device.blu_transport
                SET enabled = TRUE,
                    is_primary = CASE WHEN $4 THEN TRUE ELSE is_primary END,
                    can_write = CASE WHEN $5 THEN TRUE ELSE can_write END,
                    updated_at = NOW()
              WHERE organization_id = $1
                AND blu_device_list_id = $2
                AND id = $3`,
            [
                organizationId,
                input.bluetoothDeviceListId,
                existing[0].id,
                input.makePrimary,
                canWrite
            ]
        );
        return;
    }
    await tx.query(
        `INSERT INTO device.blu_transport (
            id,
            blu_device_list_id,
            organization_id,
            mode,
            is_primary,
            can_write,
            shelly_device_list_id,
            enabled
        )
        VALUES ($1, $2, $3, 'bthome_gateway', $4, $6, $5, TRUE)`,
        [
            input.transportId,
            input.bluetoothDeviceListId,
            organizationId,
            input.makePrimary,
            input.candidate.gatewayDeviceListId,
            candidateTransportCanWrite(input.candidate)
        ]
    );
}

async function requireBluetoothDevice(
    tx: QueryClient,
    organizationId: string,
    externalId: string
): Promise<BluetoothDeviceDto> {
    const rows = await tx.query<BluetoothDeviceRow>(
        `${bluetoothDeviceSelect()}
         WHERE bd.organization_id = $1
           AND dl.external_id = $2
           AND bd.deleted_at IS NULL
         LIMIT 1`,
        [organizationId, externalId]
    );
    if (!rows[0]) throw RpcError.NotFound('bluetooth_device', externalId);
    return rowToBluetoothDevice(rows[0]);
}

async function lockBluetoothDevice(
    tx: QueryClient,
    organizationId: string,
    externalId: string
): Promise<BluetoothDeviceDto> {
    const rows = await tx.query<BluetoothDeviceRow>(
        `${bluetoothDeviceSelect()}
         WHERE bd.organization_id = $1
           AND dl.external_id = $2
           AND bd.deleted_at IS NULL
         FOR UPDATE OF bd`,
        [organizationId, externalId]
    );
    if (!rows[0]) throw RpcError.NotFound('bluetooth_device', externalId);
    return rowToBluetoothDevice(rows[0]);
}

async function requireTransportForDevice(
    tx: QueryClient,
    input: {organizationId: string; deviceListId: number; transportId: string}
): Promise<void> {
    const rows = await tx.query<{id: string}>(
        `SELECT id
           FROM device.blu_transport
          WHERE organization_id = $1
            AND blu_device_list_id = $2
            AND id = $3
          LIMIT 1`,
        [input.organizationId, input.deviceListId, input.transportId]
    );
    if (!rows[0])
        throw RpcError.NotFound('bluetooth_transport', input.transportId);
}

async function updateBluetoothKeyRef(
    tx: QueryClient,
    input: {organizationId: string; deviceListId: number; keyRef: string | null}
): Promise<void> {
    await tx.query(
        `UPDATE device.blu_device
            SET encryption_key_ref = $3,
                updated_at = NOW()
          WHERE organization_id = $1
            AND device_list_id = $2`,
        [input.organizationId, input.deviceListId, input.keyRef]
    );
}

async function writeBluetoothKeyEvent(
    tx: QueryClient,
    input: {
        id: string;
        organizationId: string;
        deviceListId: number;
        eventType: 'promote' | 'set_ref' | 'clear_ref';
        keyRef: string | null;
        actorId: string | null;
        reason: string | null;
    }
): Promise<void> {
    await tx.query(
        `INSERT INTO device.blu_key_event (
            id,
            blu_device_list_id,
            organization_id,
            event_type,
            key_ref,
            actor_id,
            reason
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
            input.id,
            input.deviceListId,
            input.organizationId,
            input.eventType,
            input.keyRef,
            input.actorId,
            input.reason
        ]
    );
}

async function organizationIdForDevice(
    tx: QueryClient,
    deviceListId: number
): Promise<string> {
    const rows = await tx.query<{organization_id: string}>(
        `SELECT organization_id
           FROM device.list
          WHERE id = $1
          LIMIT 1`,
        [deviceListId]
    );
    const organizationId = rows[0]?.organization_id;
    if (!organizationId) throw RpcError.NotFound('device', deviceListId);
    return organizationId;
}

function rowToBluetoothDevice(row: BluetoothDeviceRow): BluetoothDeviceDto {
    return {
        deviceListId: row.device_list_id,
        externalId: row.external_id,
        stableId: row.stable_id,
        bleAddress: row.ble_address,
        productName: row.product_name,
        modelId: row.model_id,
        imageAssetId: row.image_asset_id,
        capability: row.capability,
        keyRefSet: !!row.encryption_key_ref,
        components: parseSourceComponents(row.source_components_json),
        visual: (row.visual_json ?? {}) as BluetoothDeviceDto['visual'],
        primaryTransport: row.primary_transport_id
            ? {
                  id: row.primary_transport_id,
                  mode: row.primary_transport_mode!,
                  canWrite: row.primary_transport_can_write === true,
                  enabled: row.primary_transport_enabled === true,
                  shellyDeviceExternalId:
                      row.primary_transport_shelly_external_id,
                  assistantDeviceExternalId:
                      row.primary_transport_assistant_external_id,
                  hostAdapterId: row.primary_transport_host_adapter_id,
                  serialPortRef: row.primary_transport_serial_port_ref,
                  lastSeenAt: isoOrNull(row.primary_transport_last_seen_at),
                  lastRssi: row.primary_transport_last_rssi
              }
            : null
    };
}

function rowToBluetoothTransport(
    row: BluetoothTransportRow
): BluetoothTransportDto {
    return {
        id: row.id,
        mode: row.mode,
        primary: row.is_primary,
        canWrite: row.can_write,
        enabled: row.enabled,
        shellyDeviceExternalId: row.shelly_device_external_id,
        hostAdapterId: row.host_adapter_id,
        assistantDeviceExternalId: row.assistant_device_external_id,
        serialPortRef: row.serial_port_ref,
        keyDistributedAt: isoOrNull(row.key_distributed_at),
        lastSeenAt: isoOrNull(row.last_seen_at),
        lastRssi: row.last_rssi
    };
}

function capabilityFromSourceComponents(
    config: Record<string, unknown>,
    components: readonly BluetoothSourceComponentDto[]
): BluCapability {
    if (components.some((component) => component.role === 'writable_control')) {
        return 'controllable';
    }
    if (components.some((component) => component.role === 'event_control')) {
        return 'event_only';
    }
    if (components.some((component) => component.role === 'telemetry')) {
        return 'telemetry_only';
    }
    const meta = asRecord(config.meta);
    const controls = Array.isArray(meta.controls) ? meta.controls : [];
    if (controls.length > 0 || meta.isRemote === true) return 'event_only';
    return 'telemetry_only';
}

function collectBluetoothSourceComponents(
    deviceComponentKey: string,
    deviceConfig: Record<string, unknown>,
    allConfig: Record<string, unknown>
): BluetoothSourceComponentDto[] {
    const bleAddress = stringValue(deviceConfig.addr);
    const components = [
        primarySourceComponent(deviceComponentKey, deviceConfig)
    ];
    for (const [componentKey, value] of Object.entries(allConfig)) {
        if (!isBTHomeChildComponentKey(componentKey)) continue;
        const config = asRecord(value);
        if (!sameBleAddress(bleAddress, stringValue(config.addr))) continue;
        components.push(
            sourceComponentFromConfig(
                componentKey,
                config,
                childKind(componentKey)
            )
        );
    }
    return components.sort((a, b) =>
        a.componentKey.localeCompare(b.componentKey)
    );
}

function primarySourceComponent(
    componentKey: string,
    config: Record<string, unknown>
): BluetoothSourceComponentDto {
    if (componentKey.startsWith('blutrv:')) {
        return sourceComponentFromConfig(componentKey, config, 'trv');
    }
    return sourceComponentFromConfig(componentKey, config, 'device');
}

function isDuplicateTrvBthomeCandidate(
    componentKey: string,
    bleAddress: string | null,
    allConfig: Record<string, unknown>
): boolean {
    if (!componentKey.startsWith('bthomedevice:')) return false;
    return Object.entries(allConfig).some(([key, value]) => {
        if (!key.startsWith('blutrv:')) return false;
        return sameBleAddress(bleAddress, stringValue(asRecord(value).addr));
    });
}

function sourceComponentFromConfig(
    componentKey: string,
    config: Record<string, unknown>,
    kind: BluetoothSourceComponentDto['kind']
): BluetoothSourceComponentDto {
    return {
        componentKey,
        kind,
        role: sourceComponentRole(kind, config),
        objectId: numberValue(config.obj_id),
        index: numberValue(config.idx ?? config.obj_idx),
        name: stringValue(config.name) ?? stringValue(config.obj_name),
        canWrite:
            kind === 'trv' ||
            config.can_write === true ||
            config.writable === true
    };
}

function sourceComponentRole(
    kind: BluetoothSourceComponentDto['kind'],
    config: Record<string, unknown>
): BluetoothSourceComponentDto['role'] {
    if (kind === 'device') return 'identity';
    if (kind === 'trv') return 'writable_control';
    if (kind === 'sensor') return 'telemetry';
    return config.can_write === true || config.writable === true
        ? 'writable_control'
        : 'event_control';
}

function candidateTransportCanWrite(
    candidate: BluetoothDeviceCandidateDto
): boolean {
    return candidate.components.some(
        (component) => component.role === 'writable_control'
    );
}

function isBTHomeChildComponentKey(componentKey: string): boolean {
    return (
        componentKey.startsWith('bthomesensor:') ||
        componentKey.startsWith('bthomecontrol:')
    );
}

function childKind(componentKey: string): 'sensor' | 'control' {
    return componentKey.startsWith('bthomecontrol:') ? 'control' : 'sensor';
}

function sameBleAddress(left: string | null, right: string | null): boolean {
    const stableLeft = stableIdFromAddress(left);
    const stableRight = stableIdFromAddress(right);
    return !!stableLeft && stableLeft === stableRight;
}

function parseSourceComponents(value: unknown): BluetoothSourceComponentDto[] {
    if (!Array.isArray(value)) return [];
    return value
        .map(parseSourceComponent)
        .filter(
            (component): component is BluetoothSourceComponentDto =>
                component !== null
        );
}

function parseSourceComponent(
    value: unknown
): BluetoothSourceComponentDto | null {
    const record = asRecord(value);
    const componentKey = stringValue(record.componentKey);
    const kind = stringValue(record.kind);
    const role = stringValue(record.role);
    if (!componentKey || !isSourceComponentKind(kind) || !isSourceRole(role)) {
        return null;
    }
    return {
        componentKey,
        kind,
        role,
        objectId: numberValue(record.objectId),
        index: numberValue(record.index),
        name: stringValue(record.name),
        canWrite: record.canWrite === true
    };
}

function isSourceComponentKind(
    value: string | null
): value is BluetoothSourceComponentDto['kind'] {
    return (
        value === 'device' ||
        value === 'sensor' ||
        value === 'control' ||
        value === 'trv'
    );
}

function isSourceRole(
    value: string | null
): value is BluetoothSourceComponentDto['role'] {
    return (
        value === 'identity' ||
        value === 'telemetry' ||
        value === 'event_control' ||
        value === 'writable_control'
    );
}

function stableIdFromAddress(value: string | null): string | null {
    if (!value) return null;
    const stableId = value.replace(/[^0-9a-f]/gi, '').toLowerCase();
    return stableId.length === 12 ? stableId : null;
}

function normalizeBleAddress(value: string): string {
    const stableId = stableIdFromAddress(value);
    if (!stableId || stableId.length !== 12) return value.toLowerCase();
    return stableId.match(/.{1,2}/g)?.join(':') ?? value.toLowerCase();
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function stringValue(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0
        ? value.trim()
        : null;
}

function numberValue(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
