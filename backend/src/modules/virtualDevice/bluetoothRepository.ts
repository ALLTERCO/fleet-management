import {randomUUID} from 'node:crypto';
import {
    BLU_TRV_MODEL_ID,
    isBTHomeControlObjectId,
    resolveBluDeviceInfo,
    resolveBluPresentationImageModel
} from '../../config/BTHomeData';
import {
    bluStableIdFromAddress,
    normalizeBleAddress
} from '../../model/bluIdentity';
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

interface BluetoothDeviceRef {
    deviceListId: number;
    externalId: string;
}

interface BluetoothPromotionCandidate {
    candidate: BluetoothDeviceCandidateDto;
    imageModel?: string;
}

export interface BluetoothGatewayPromotionOutcome {
    componentKey: string;
    device: BluetoothDeviceDto;
    created: boolean;
    changed: boolean;
    /** Other gateways whose cached status routes no longer match this child. */
    staleRouteGatewayExternalIds: string[];
}

export interface BluetoothStatusRoute {
    deviceListId: number;
    externalId: string;
    organizationId: string;
    transportId: string;
    primary: boolean;
    components: BluetoothSourceComponentDto[];
    modelId: string | null;
    productName: string | null;
    bleAddress: string | null;
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
         ORDER BY COALESCE(bd.product_name, dl.external_id) ASC, bd.device_list_id ASC
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

export async function listBluetoothDevicesByExternalIds(
    organizationId: string,
    externalIds: readonly string[],
    deps: RepositoryDeps = defaultDeps
): Promise<BluetoothDeviceDto[]> {
    const ids = [...new Set(externalIds)];
    if (ids.length === 0) return [];
    const rows = await deps.queryRows<BluetoothDeviceRow>(
        `${bluetoothDeviceSelect()}
         WHERE bd.organization_id = $1
           AND dl.external_id = ANY($2::varchar[])
           AND bd.deleted_at IS NULL`,
        [organizationId, ids]
    );
    return rows.map(rowToBluetoothDevice);
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
            component.component_key AS source_component_key
           FROM device.blu_device bd
           JOIN device.blu_transport bt
             ON bt.blu_device_list_id = bd.device_list_id
            AND bt.organization_id = bd.organization_id
            AND bt.mode = 'bthome_gateway'
            AND bt.enabled IS TRUE
           JOIN device.list gateway
             ON gateway.id = bt.shelly_device_list_id
            AND gateway.organization_id = bd.organization_id
           JOIN device.blu_transport_component component
             ON component.transport_id = bt.id
          WHERE bd.organization_id = $1
            AND bd.deleted_at IS NULL
            AND gateway.external_id = ANY($2::varchar[])`,
        [organizationId, [...new Set(gatewayExternalIds)]]
    );
    return rowsToGatewaySourceKeys(rows);
}

export async function listBluetoothStatusRoutesByGateway(
    organizationId: string | undefined,
    gatewayExternalIds: readonly string[],
    deps: Pick<RepositoryDeps, 'queryRows'> = defaultDeps
): Promise<Map<string, Map<string, BluetoothStatusRoute>>> {
    if (!organizationId || gatewayExternalIds.length === 0) return new Map();
    const rows = await deps.queryRows<GatewayStatusRouteRow>(
        `SELECT
            gateway.external_id AS gateway_external_id,
            bd.device_list_id,
            dl.external_id,
            bd.organization_id,
            bt.id AS transport_id,
            bt.is_primary,
            component.component_key AS source_component_key,
            component.position,
            component.component_json,
            bd.model_id,
            bd.product_name,
            bd.ble_address
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
           JOIN device.blu_transport_component component
             ON component.transport_id = bt.id
          WHERE bd.organization_id = $1
            AND bd.deleted_at IS NULL
            AND gateway.external_id = ANY($2::varchar[])
          ORDER BY gateway.external_id,
                   component.component_key,
                   bt.is_primary DESC,
                   bd.device_list_id`,
        [organizationId, [...new Set(gatewayExternalIds)]]
    );
    return rowsToGatewayStatusRoutes(rows);
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
           JOIN device.blu_transport_component component
             ON component.transport_id = bt.id
            AND component.component_key = $3
          WHERE bd.organization_id = $1
            AND bd.deleted_at IS NULL
            AND gateway.external_id = $2
          ORDER BY bt.is_primary DESC, bd.device_list_id
          LIMIT 1`,
        [organizationId, gatewayExternalId, componentKey]
    );
    return rows[0]?.external_id ?? null;
}

// Keys each transport's gateway assigned, in the order the pass stored them.
export async function listBluetoothTransportComponentKeys(
    organizationId: string,
    deviceListId: number,
    deps: Pick<RepositoryDeps, 'queryRows'> = defaultDeps
): Promise<Map<string, string[]>> {
    const rows = await deps.queryRows<{
        transport_id: string;
        component_keys: string[];
    }>(
        `SELECT bt.id AS transport_id,
                array_agg(component.component_key ORDER BY component.position)
                    AS component_keys
           FROM device.blu_transport bt
           JOIN device.blu_transport_component component
             ON component.transport_id = bt.id
          WHERE bt.organization_id = $1
            AND bt.blu_device_list_id = $2
          GROUP BY bt.id`,
        [organizationId, deviceListId]
    );
    return new Map(rows.map((row) => [row.transport_id, row.component_keys]));
}

export async function deleteBluetoothDevice(
    organizationId: string,
    input: BluetoothDeleteParams,
    deps: RepositoryDeps = defaultDeps
): Promise<{externalId: string; deleted: boolean}> {
    const {externalId, deleted} = await deleteBluetoothDeviceWithOutcome(
        organizationId,
        input,
        deps
    );
    return {externalId, deleted};
}

// Also names the gateways whose cached status routes still list the device.
export async function deleteBluetoothDeviceWithOutcome(
    organizationId: string,
    input: BluetoothDeleteParams,
    deps: RepositoryDeps = defaultDeps
): Promise<{
    externalId: string;
    deleted: boolean;
    staleRouteGatewayExternalIds: string[];
}> {
    return deps.withTransaction(async (tx) => {
        const device = await lockBluetoothDeviceForRemoval(tx, {
            organizationId,
            externalId: input.externalId
        });
        if (input.retention === 'purge') {
            await purgeBluetoothDevice(tx, device.deviceListId);
        } else {
            await tombstoneBluetoothDevice(
                tx,
                organizationId,
                device.deviceListId
            );
        }
        return {
            externalId: input.externalId,
            deleted: true,
            staleRouteGatewayExternalIds: device.linkedGatewayExternalIds
        };
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

interface GatewayStatusRouteRow {
    gateway_external_id: string;
    device_list_id: number;
    external_id: string;
    organization_id: string;
    transport_id: string;
    is_primary: boolean;
    source_component_key: string;
    position: number;
    component_json: unknown;
    model_id: string | null;
    product_name: string | null;
    ble_address: string | null;
}

// Rows come ordered so a key held by two transports of one gateway (a pass
// not yet run) resolves the same way on every load: primary first.
function rowsToGatewayStatusRoutes(
    rows: readonly GatewayStatusRouteRow[]
): Map<string, Map<string, BluetoothStatusRoute>> {
    const out = new Map<string, Map<string, BluetoothStatusRoute>>();
    const transports = new Map<
        string,
        {
            route: BluetoothStatusRoute;
            components: Array<{
                position: number;
                component: BluetoothSourceComponentDto;
            }>;
        }
    >();
    for (const row of rows) {
        const transportKey = `${row.gateway_external_id}|${row.transport_id}`;
        let transport = transports.get(transportKey);
        if (!transport) {
            transport = {
                route: {
                    deviceListId: row.device_list_id,
                    externalId: row.external_id,
                    organizationId: row.organization_id,
                    transportId: row.transport_id,
                    primary: row.is_primary,
                    components: [],
                    modelId: row.model_id,
                    productName: row.product_name,
                    bleAddress: row.ble_address
                },
                components: []
            };
            transports.set(transportKey, transport);
        }
        const component = parseSourceComponent(row.component_json);
        if (component) {
            transport.components.push({position: row.position, component});
        }
        const routes =
            out.get(row.gateway_external_id) ??
            new Map<string, BluetoothStatusRoute>();
        if (!routes.has(row.source_component_key)) {
            routes.set(row.source_component_key, transport.route);
        }
        out.set(row.gateway_external_id, routes);
    }
    for (const {route, components} of transports.values()) {
        route.components = components
            .sort((a, b) => a.position - b.position)
            .map((entry) => entry.component);
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
    const outcome = await promoteBluetoothFromGatewayWithOutcome(
        organizationId,
        input,
        actorId,
        deps
    );
    return outcome.device;
}

// Internal auto-promotion needs the transaction's authoritative created flag.
// A preflight "already promoted" read is stale when several gateways discover
// the same child concurrently and must not drive Created/Updated events.
export async function promoteBluetoothFromGatewayWithOutcome(
    organizationId: string,
    input: BluetoothPromoteFromGatewayParams,
    actorId: string | null = null,
    deps: RepositoryDeps = defaultDeps
): Promise<Omit<BluetoothGatewayPromotionOutcome, 'componentKey'>> {
    return deps.withTransaction(async (tx) => {
        const promotion = await readGatewayCandidate(tx, organizationId, input);
        const [outcome] = await promoteGatewayChildren(
            {tx, actorId, makeUuid: deps.makeUuid},
            [{...promotion, makePrimary: input.makePrimary !== false}]
        );
        return {
            device: await requireBluetoothDevice(
                tx,
                organizationId,
                outcome.ref.externalId
            ),
            created: outcome.created,
            changed: outcome.changed,
            staleRouteGatewayExternalIds: outcome.staleRouteGatewayExternalIds
        };
    });
}

export async function promoteBluetoothGatewayChildrenWithOutcome(
    organizationId: string,
    gatewayExternalId: string,
    componentKeys: readonly string[],
    actorId: string | null = null,
    deps: RepositoryDeps = defaultDeps
): Promise<BluetoothGatewayPromotionOutcome[]> {
    if (componentKeys.length === 0) return [];
    const requested = new Set(componentKeys);
    return deps.withTransaction(async (tx) => {
        const rows = await tx.query<GatewayCandidateRow>(
            bluetoothCandidateSql({gatewayExternalId}),
            [organizationId, gatewayExternalId]
        );
        const promotions = rows
            .filter((row) => requested.has(row.component_key))
            .map(rowToBluetoothPromotionCandidate)
            .filter(
                (promotion): promotion is BluetoothPromotionCandidate =>
                    !!promotion
            );
        const found = new Set(
            promotions.map(({candidate}) => candidate.componentKey)
        );
        const missing = componentKeys.find((key) => !found.has(key));
        if (missing) throw RpcError.NotFound('bluetooth_candidate', missing);

        const outcomes = await promoteGatewayChildren(
            {tx, actorId, makeUuid: deps.makeUuid},
            promotions.map((promotion) => ({...promotion, makePrimary: false}))
        );
        // One read for the whole pass: the per-child reads held a connection per child.
        const devices = await requireBluetoothDevices(
            tx,
            organizationId,
            outcomes.map((outcome) => outcome.ref)
        );
        return outcomes.map((outcome, index) => ({
            componentKey: outcome.componentKey,
            device: devices[index],
            created: outcome.created,
            changed: outcome.changed,
            staleRouteGatewayExternalIds: outcome.staleRouteGatewayExternalIds
        }));
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

// Also names the gateways that held the primary before, whose cached status
// routes still mark it primary.
export async function setPrimaryBluetoothTransport(
    organizationId: string,
    input: BluetoothTransportSetPrimaryParams,
    deps: RepositoryDeps = defaultDeps
): Promise<{
    items: BluetoothTransportDto[];
    previousPrimaryGatewayExternalIds: string[];
}> {
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
        const previous = await tx.query<{gateway_external_id: string | null}>(
            `UPDATE device.blu_transport bt
                SET is_primary = FALSE,
                    updated_at = NOW()
              WHERE bt.organization_id = $1
                AND bt.blu_device_list_id = $2
                AND bt.is_primary IS TRUE
              RETURNING (
                    SELECT gateway.external_id
                      FROM device.list gateway
                     WHERE gateway.id = bt.shelly_device_list_id
                ) AS gateway_external_id`,
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
        return {
            items: rows.map(rowToBluetoothTransport),
            previousPrimaryGatewayExternalIds: [
                ...new Set(
                    previous.flatMap((row) =>
                        row.gateway_external_id ? [row.gateway_external_id] : []
                    )
                )
            ]
        };
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
        COALESCE(pc.components, bd.source_components_json)
            AS source_components_json,
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
 LEFT JOIN LATERAL (
        -- The device's components are the keys its primary gateway assigned;
        -- a primary without stored keys keeps the last stored list.
        SELECT jsonb_agg(component_json ORDER BY position) AS components
          FROM device.blu_transport_component
         WHERE transport_id = pt.id
      ) pc ON TRUE
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
    deviceListId: number
): Promise<void> {
    // The wired delete. A plain DELETE trips the RESTRICT foreign key from
    // alert history; fn_full_delete detaches and unscopes first.
    await tx.query('SELECT device.fn_full_delete($1)', [deviceListId]);
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
    const stableId = bluStableIdFromAddress(bleAddress);
    if (!stableId) return null;
    const allConfig = asRecord(row.all_config);
    if (isDuplicateTrvBthomeCandidate(row.component_key, bleAddress, allConfig))
        return null;
    const meta = asRecord(config.meta);
    const modelId =
        stringValue(meta.modelId) ??
        stringValue(config.model) ??
        (row.component_key.startsWith('blutrv:') ? BLU_TRV_MODEL_ID : null);
    const identity = resolveBluDeviceInfo(modelId ?? undefined);
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
        productName:
            stringValue(meta.productName) ??
            (identity.productName === 'BLE Device'
                ? null
                : identity.productName),
        modelId,
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
): Promise<BluetoothPromotionCandidate> {
    const rows = await tx.query<GatewayCandidateRow>(
        `${bluetoothCandidateSql({
            gatewayExternalId: input.gatewayExternalId,
            componentKey: input.componentKey
        })}
         LIMIT 1`,
        [organizationId, input.gatewayExternalId, input.componentKey]
    );
    const promotion = rows[0]
        ? rowToBluetoothPromotionCandidate(rows[0])
        : null;
    if (!promotion)
        throw RpcError.NotFound('bluetooth_candidate', input.componentKey);
    return promotion;
}

function rowToBluetoothPromotionCandidate(
    row: GatewayCandidateRow
): BluetoothPromotionCandidate | null {
    const candidate = rowToBluetoothCandidate(row);
    if (!candidate) return null;
    const meta = asRecord(asRecord(row.config).meta);
    const visual = asRecord(meta.visual);
    return {
        candidate,
        imageModel: resolveBluPresentationImageModel(
            candidate.modelId,
            stringValue(visual.imageModel)
        )
    };
}

// Bounds the array size bound into one statement.
const MAX_CHILDREN_PER_STATEMENT = 200;

interface ChildPromotion extends BluetoothPromotionCandidate {
    makePrimary: boolean;
}

interface ChildPromotionOutcome {
    componentKey: string;
    ref: BluetoothDeviceRef;
    created: boolean;
    changed: boolean;
    staleRouteGatewayExternalIds: string[];
}

interface DeviceRefresh {
    changed: Set<number>;
    /** Rows whose routed details (address, name, model) or tombstone
     *  changed; other gateways cache those details. */
    detailsChanged: Set<number>;
}

interface TransportRefresh {
    changed: Set<number>;
    /** This gateway's transport per child, in child order. */
    transportIds: string[];
    lostPrimary: Map<number, string[]>;
    linkedGateways: Map<number, string[]>;
}

interface PromotionScope {
    tx: QueryClient;
    actorId: string | null;
    makeUuid(): string;
}

interface PromotionContext extends PromotionScope {
    organizationId: string;
    gatewayDeviceListId: number;
}

type DeviceState = 'existing' | 'tombstoned' | 'created';

type DevicePlacement =
    | {state: DeviceState; ref: BluetoothDeviceRef}
    | {state: 'rejected'; error: RpcError};

interface LockedChild {
    promotion: ChildPromotion;
    ref: BluetoothDeviceRef;
    state: DeviceState;
}

interface PlacedChild extends LockedChild {
    transportId: string;
    keyEventId: string | null;
}

interface StoredBluetoothDeviceRow {
    device_list_id: number;
    external_id: string;
    stable_id: string;
    live: boolean;
    list_in_org: boolean;
}

interface GatewayTransportStateRow {
    blu_device_list_id: number;
    stale_changed: boolean;
    has_no_primary: boolean;
    gateway_transport_id: string | null;
    linked_gateway_external_ids: string[];
}

// A gateway pass runs a fixed number of statements per group of children
// instead of about twelve per child. Children sharing one BLE address go to
// later groups, so each group touches a BLU device once, in the given order.
async function promoteGatewayChildren(
    scope: PromotionScope,
    children: readonly ChildPromotion[]
): Promise<ChildPromotionOutcome[]> {
    if (children.length === 0) return [];
    const {gatewayDeviceListId} = children[0].candidate;
    const ctx: PromotionContext = {
        ...scope,
        gatewayDeviceListId,
        organizationId: await organizationIdForDevice(
            scope.tx,
            gatewayDeviceListId
        )
    };
    const outcomes: ChildPromotionOutcome[] = [];
    for (const group of independentChildGroups(children)) {
        outcomes.push(...(await promoteIndependentChildren(ctx, group)));
    }
    return outcomes;
}

function independentChildGroups(
    children: readonly ChildPromotion[]
): ChildPromotion[][] {
    const groups: ChildPromotion[][] = [];
    let group: ChildPromotion[] = [];
    let stableIds = new Set<string>();
    for (const child of children) {
        const {stableId} = child.candidate;
        if (
            stableIds.has(stableId) ||
            group.length === MAX_CHILDREN_PER_STATEMENT
        ) {
            groups.push(group);
            group = [];
            stableIds = new Set();
        }
        group.push(child);
        stableIds.add(stableId);
    }
    groups.push(group);
    return groups;
}

async function promoteIndependentChildren(
    ctx: PromotionContext,
    children: readonly ChildPromotion[]
): Promise<ChildPromotionOutcome[]> {
    const placements = await placeBluetoothDevices(ctx, children);
    const lockedLive = await lockPlacedBluetoothDevices(ctx, placements);
    const placed = assignPromotionIds(
        ctx,
        requirePlacedChildren(children, {placements, lockedLive})
    );
    const transports = await refreshGatewayTransports(ctx, placed);
    const componentsChanged = await writeTransportComponents(
        ctx,
        placed,
        transports.transportIds
    );
    const devices = await refreshPlacedBluetoothDevices(ctx, placed);
    await writePromoteKeyEvents(ctx, placed);
    return placed.map((child) => {
        const id = child.ref.deviceListId;
        return {
            componentKey: child.promotion.candidate.componentKey,
            ref: child.ref,
            created: child.state === 'created',
            changed:
                devices.changed.has(id) ||
                transports.changed.has(id) ||
                componentsChanged.has(id),
            staleRouteGatewayExternalIds: staleRouteGateways(id, {
                devices,
                transports
            })
        };
    });
}

// Other gateways whose cached routes no longer match: the one that lost the
// primary, and every linked gateway when the routed details changed.
function staleRouteGateways(
    deviceListId: number,
    input: {devices: DeviceRefresh; transports: TransportRefresh}
): string[] {
    const gateways = new Set(
        input.transports.lostPrimary.get(deviceListId) ?? []
    );
    if (input.devices.detailsChanged.has(deviceListId)) {
        for (const gateway of input.transports.linkedGateways.get(
            deviceListId
        ) ?? []) {
            gateways.add(gateway);
        }
    }
    return [...gateways].sort();
}

// Reads without locks; rows are locked later in one id order, after the
// device.list inserts, so concurrent gateway passes cannot wait on each other
// in a cycle.
async function placeBluetoothDevices(
    ctx: PromotionContext,
    children: readonly ChildPromotion[]
): Promise<DevicePlacement[]> {
    const stored = await readStoredBluetoothDevices(
        ctx,
        children.map((child) => child.candidate.stableId)
    );
    const found = children.map((child) =>
        storedPlacement(stored.get(child.candidate.stableId) ?? [])
    );
    const inserted = await insertBluetoothDevices(
        ctx,
        children.filter((_, index) => found[index] === null)
    );
    return children.map(
        (child, index) =>
            found[index] ??
            inserted.get(child.candidate.stableId) ?? {
                state: 'rejected',
                error: RpcError.OperationFailed('bluetooth promote')
            }
    );
}

async function readStoredBluetoothDevices(
    ctx: PromotionContext,
    stableIds: readonly string[]
): Promise<Map<string, StoredBluetoothDeviceRow[]>> {
    const rows = await ctx.tx.query<StoredBluetoothDeviceRow>(
        `SELECT bd.device_list_id,
                dl.external_id,
                bd.stable_id,
                bd.deleted_at IS NULL AS live,
                COALESCE(dl.organization_id = bd.organization_id, FALSE)
                    AS list_in_org
           FROM device.blu_device bd
           JOIN device.list dl
             ON dl.id = bd.device_list_id
          WHERE bd.organization_id = $1
            AND bd.stable_id = ANY($2::varchar[])`,
        [ctx.organizationId, stableIds]
    );
    const byStableId = new Map<string, StoredBluetoothDeviceRow[]>();
    for (const row of rows) {
        byStableId.set(row.stable_id, [
            ...(byStableId.get(row.stable_id) ?? []),
            row
        ]);
    }
    return byStableId;
}

// A live row is reused; a same-org tombstone is resurrected rather than
// colliding on its still-present blu_<MAC> device.list id.
function storedPlacement(
    rows: readonly StoredBluetoothDeviceRow[]
): DevicePlacement | null {
    const live = rows.find((row) => row.live && row.list_in_org);
    if (live) return {state: 'existing', ref: storedRef(live)};
    const tombstoned = rows.find((row) => !row.live);
    if (tombstoned) return {state: 'tombstoned', ref: storedRef(tombstoned)};
    return null;
}

function storedRef(row: StoredBluetoothDeviceRow): BluetoothDeviceRef {
    return {deviceListId: row.device_list_id, externalId: row.external_id};
}

// blu_<MAC> is global. Concurrent gateways in one org can both miss the
// initial lookup, so avoid a unique-violation (which aborts the tx), then
// inspect the row that won. device.list carries both the canonical global
// external-id index and an older non-physical partial index; omitting a
// conflict target makes PostgreSQL arbitrate every applicable uniqueness
// constraint instead of allowing the non-target index to race. The insert
// waits for the winner, and the following statement gets a fresh READ
// COMMITTED snapshot of its row. Sorted inserts keep that wait order stable.
async function insertBluetoothDevices(
    ctx: PromotionContext,
    children: readonly ChildPromotion[]
): Promise<Map<string, DevicePlacement>> {
    const placements = new Map<string, DevicePlacement>();
    if (children.length === 0) return placements;
    const insertedIds = await insertBluetoothListRows(
        ctx,
        children.map(bluetoothExternalId)
    );
    const created = children.flatMap((child) => {
        const externalId = bluetoothExternalId(child);
        const deviceListId = insertedIds.get(externalId);
        return deviceListId === undefined
            ? []
            : [{child, ref: {deviceListId, externalId}}];
    });
    await insertBluetoothDeviceRows(ctx, created);
    for (const {child, ref} of created) {
        placements.set(child.candidate.stableId, {state: 'created', ref});
    }
    const lost = children.filter(
        (child) => !insertedIds.has(bluetoothExternalId(child))
    );
    for (const [stableId, placement] of await placeConflictWinners(ctx, lost)) {
        placements.set(stableId, placement);
    }
    return placements;
}

function bluetoothExternalId(child: ChildPromotion): string {
    return `blu_${child.candidate.stableId}`;
}

async function insertBluetoothListRows(
    ctx: PromotionContext,
    externalIds: readonly string[]
): Promise<Map<string, number>> {
    const rows = await ctx.tx.query<{id: number; external_id: string}>(
        `INSERT INTO device.list (
            external_id,
            control_access,
            jdoc,
            organization_id,
            kind
        )
        SELECT child.external_id, 3, '{}'::jsonb, $2, 'bluetooth'
          FROM unnest($1::varchar[]) AS child(external_id)
         ORDER BY child.external_id
        ON CONFLICT DO NOTHING
        RETURNING id, external_id`,
        [externalIds, ctx.organizationId]
    );
    return new Map(rows.map((row) => [row.external_id, row.id]));
}

async function insertBluetoothDeviceRows(
    ctx: PromotionContext,
    created: ReadonlyArray<{child: ChildPromotion; ref: BluetoothDeviceRef}>
): Promise<void> {
    if (created.length === 0) return;
    await ctx.tx.query(
        `INSERT INTO device.blu_device (
            device_list_id,
            organization_id,
            stable_id,
            ble_address,
            product_name,
            model_id,
            capability,
            source_components_json,
            visual_json
        )
        SELECT child.device_list_id,
               $1,
               child.stable_id,
               child.ble_address,
               child.product_name,
               child.model_id,
               child.capability,
               child.source_components_json::jsonb,
               child.visual_json::jsonb
          FROM unnest(
                $2::integer[],
                $3::varchar[],
                $4::varchar[],
                $5::varchar[],
                $6::varchar[],
                $7::varchar[],
                $8::text[],
                $9::text[]
               ) AS child(
                device_list_id,
                stable_id,
                ble_address,
                product_name,
                model_id,
                capability,
                source_components_json,
                visual_json
               )
         ORDER BY child.device_list_id`,
        [
            ctx.organizationId,
            created.map(({ref}) => ref.deviceListId),
            created.map(({child}) => child.candidate.stableId),
            ...bluetoothMetadataColumns(created.map(({child}) => child))
        ]
    );
}

async function placeConflictWinners(
    ctx: PromotionContext,
    children: readonly ChildPromotion[]
): Promise<Map<string, DevicePlacement>> {
    const placements = new Map<string, DevicePlacement>();
    if (children.length === 0) return placements;
    const owners = await ctx.tx.query<{
        id: number;
        external_id: string;
        organization_id: string | null;
    }>(
        `SELECT id, external_id, organization_id
           FROM device.list
          WHERE external_id = ANY($1::varchar[])`,
        [children.map(bluetoothExternalId)]
    );
    const byExternalId = new Map(owners.map((row) => [row.external_id, row]));
    for (const child of children) {
        const externalId = bluetoothExternalId(child);
        placements.set(
            child.candidate.stableId,
            conflictWinnerPlacement(ctx, {
                externalId,
                owner: byExternalId.get(externalId)
            })
        );
    }
    return placements;
}

function conflictWinnerPlacement(
    ctx: PromotionContext,
    input: {
        externalId: string;
        owner?: {id: number; organization_id: string | null};
    }
): DevicePlacement {
    if (!input.owner) {
        return {
            state: 'rejected',
            error: RpcError.OperationFailed('bluetooth promote')
        };
    }
    if (input.owner.organization_id !== ctx.organizationId) {
        return {
            state: 'rejected',
            error: RpcError.InvalidParams(
                `Bluetooth device ${input.externalId} is already registered to another organization`
            )
        };
    }
    return {
        state: 'existing',
        ref: {deviceListId: input.owner.id, externalId: input.externalId}
    };
}

// Primary transport replacement is a read-modify-write sequence protected by
// a partial unique index. Serialize only contenders for these BLU devices, in
// one id order, so concurrent gateways cannot both insert an enabled primary
// transport and cannot deadlock on each other's devices.
async function lockPlacedBluetoothDevices(
    ctx: PromotionContext,
    placements: readonly DevicePlacement[]
): Promise<Map<number, boolean>> {
    const ids = placements.flatMap((placement) =>
        placement.state === 'rejected' ? [] : [placement.ref.deviceListId]
    );
    if (ids.length === 0) return new Map();
    const rows = await ctx.tx.query<{device_list_id: number; live: boolean}>(
        `SELECT bd.device_list_id, bd.deleted_at IS NULL AS live
           FROM device.list gateway
           JOIN device.blu_device bd
             ON bd.device_list_id = ANY($2::integer[])
            AND bd.organization_id = gateway.organization_id
          WHERE gateway.id = $1
          ORDER BY bd.device_list_id
          FOR UPDATE OF bd`,
        [ctx.gatewayDeviceListId, ids]
    );
    return new Map(rows.map((row) => [row.device_list_id, row.live]));
}

// Raises the first failure in child order, as one child at a time would.
function requirePlacedChildren(
    children: readonly ChildPromotion[],
    input: {
        placements: readonly DevicePlacement[];
        lockedLive: ReadonlyMap<number, boolean>;
    }
): LockedChild[] {
    return children.map((promotion, index) => {
        const placement = input.placements[index];
        if (placement.state === 'rejected') throw placement.error;
        const live = input.lockedLive.get(placement.ref.deviceListId);
        if (live === undefined) {
            throw RpcError.NotFound('device', placement.ref.deviceListId);
        }
        const state: DeviceState =
            placement.state === 'tombstoned' && live
                ? 'existing'
                : placement.state;
        return {promotion, ref: placement.ref, state};
    });
}

// Ids are drawn per child in the order one child at a time would draw them.
function assignPromotionIds(
    ctx: PromotionContext,
    children: readonly LockedChild[]
): PlacedChild[] {
    return children.map((child) => {
        const transportId = ctx.makeUuid();
        const keyEventId = child.state === 'created' ? ctx.makeUuid() : null;
        return {...child, transportId, keyEventId};
    });
}

async function refreshPlacedBluetoothDevices(
    ctx: PromotionContext,
    children: readonly PlacedChild[]
): Promise<DeviceRefresh> {
    const resurrected = children
        .filter((child) => child.state === 'tombstoned')
        .map((child) => child.ref.deviceListId);
    await resurrectBluetoothDevices(ctx, resurrected);
    const {updated, routedChanged} = await updateBluetoothDeviceMetadata(
        ctx,
        children.filter((child) => child.state !== 'created')
    );
    const created = children
        .filter((child) => child.state === 'created')
        .map((child) => child.ref.deviceListId);
    return {
        changed: new Set([...created, ...resurrected, ...updated]),
        detailsChanged: new Set([...resurrected, ...routedChanged])
    };
}

async function resurrectBluetoothDevices(
    ctx: PromotionContext,
    deviceListIds: readonly number[]
): Promise<void> {
    if (deviceListIds.length === 0) return;
    await ctx.tx.query(
        `UPDATE device.blu_device
            SET deleted_at = NULL, updated_at = NOW()
          WHERE organization_id = $1
            AND device_list_id = ANY($2::integer[])
            AND deleted_at IS NOT NULL`,
        [ctx.organizationId, deviceListIds]
    );
}

// The stored component list follows the primary gateway, the one whose status
// the device list reads; a secondary pass leaves it alone.
async function updateBluetoothDeviceMetadata(
    ctx: PromotionContext,
    children: readonly PlacedChild[]
): Promise<{updated: number[]; routedChanged: number[]}> {
    if (children.length === 0) return {updated: [], routedChanged: []};
    const rows = await ctx.tx.query<{
        device_list_id: number;
        routed_changed: boolean;
    }>(
        `UPDATE device.blu_device bd
            SET ble_address = COALESCE(child.ble_address, bd.ble_address),
                product_name = COALESCE(child.product_name, bd.product_name),
                model_id = COALESCE(child.model_id, bd.model_id),
                capability = child.capability,
                source_components_json = CASE
                    WHEN child.holds_primary
                    THEN child.source_components_json::jsonb
                    ELSE bd.source_components_json
                END,
                visual_json = CASE
                    WHEN COALESCE(bd.visual_json, '{}'::jsonb) = '{}'::jsonb
                    THEN child.visual_json::jsonb
                    ELSE bd.visual_json
                END,
                updated_at = NOW()
           FROM (
                SELECT input.*,
                       EXISTS (
                           SELECT 1
                             FROM device.blu_transport bt
                            WHERE bt.organization_id = $8
                              AND bt.blu_device_list_id = input.device_list_id
                              AND bt.shelly_device_list_id = $9
                              AND bt.is_primary IS TRUE
                              AND bt.enabled IS TRUE
                       ) AS holds_primary
                  FROM unnest(
                        $1::integer[],
                        $2::varchar[],
                        $3::varchar[],
                        $4::varchar[],
                        $5::varchar[],
                        $6::text[],
                        $7::text[]
                       ) AS input(
                        device_list_id,
                        ble_address,
                        product_name,
                        model_id,
                        capability,
                        source_components_json,
                        visual_json
                       )
           ) AS child
           JOIN device.blu_device prev
             ON prev.device_list_id = child.device_list_id
          WHERE bd.device_list_id = child.device_list_id
            AND (
                bd.ble_address IS DISTINCT FROM COALESCE(child.ble_address, bd.ble_address)
                OR bd.product_name IS DISTINCT FROM COALESCE(child.product_name, bd.product_name)
                OR bd.model_id IS DISTINCT FROM COALESCE(child.model_id, bd.model_id)
                OR bd.capability IS DISTINCT FROM child.capability
                OR (
                    child.holds_primary
                    AND bd.source_components_json IS DISTINCT FROM child.source_components_json::jsonb
                )
                OR bd.visual_json IS DISTINCT FROM CASE
                    WHEN COALESCE(bd.visual_json, '{}'::jsonb) = '{}'::jsonb
                    THEN child.visual_json::jsonb
                    ELSE bd.visual_json
                END
            )
          RETURNING bd.device_list_id,
                    (
                        prev.ble_address IS DISTINCT FROM bd.ble_address
                        OR prev.product_name IS DISTINCT FROM bd.product_name
                        OR prev.model_id IS DISTINCT FROM bd.model_id
                    ) AS routed_changed`,
        [
            children.map((child) => child.ref.deviceListId),
            ...bluetoothMetadataColumns(
                children.map((child) => child.promotion)
            ),
            ctx.organizationId,
            ctx.gatewayDeviceListId
        ]
    );
    return {
        updated: rows.map((row) => row.device_list_id),
        routedChanged: rows
            .filter((row) => row.routed_changed)
            .map((row) => row.device_list_id)
    };
}

// This gateway's keys replace its transports' stored keys. A key now held by
// another device on this gateway is dropped there: a gateway key names one
// paired device.
async function writeTransportComponents(
    ctx: PromotionContext,
    children: readonly PlacedChild[],
    transportIds: readonly string[]
): Promise<Set<number>> {
    const claimed = children.flatMap((child, index) =>
        child.promotion.candidate.components.map((component, position) => ({
            transportId: transportIds[index],
            deviceListId: child.ref.deviceListId,
            component,
            position
        }))
    );
    const deviceByTransport = new Map(
        children.map((child, index) => [
            transportIds[index],
            child.ref.deviceListId
        ])
    );
    const removed = await ctx.tx.query<{transport_id: string}>(
        `DELETE FROM device.blu_transport_component component
          USING device.blu_transport bt
          WHERE bt.id = component.transport_id
            AND bt.organization_id = $1
            AND bt.shelly_device_list_id = $2
            AND (
                component.transport_id = ANY($3::uuid[])
                OR component.component_key = ANY($5::varchar[])
            )
            AND NOT EXISTS (
                SELECT 1
                  FROM unnest($4::uuid[], $5::varchar[])
                       AS kept(transport_id, component_key)
                 WHERE kept.transport_id = component.transport_id
                   AND kept.component_key = component.component_key
            )
          RETURNING component.transport_id`,
        [
            ctx.organizationId,
            ctx.gatewayDeviceListId,
            [...deviceByTransport.keys()],
            claimed.map((row) => row.transportId),
            claimed.map((row) => row.component.componentKey)
        ]
    );
    const written =
        claimed.length === 0
            ? []
            : await ctx.tx.query<{transport_id: string}>(
                  `INSERT INTO device.blu_transport_component AS component (
                        transport_id,
                        component_key,
                        position,
                        component_json
                    )
                    SELECT input.transport_id,
                           input.component_key,
                           input.position,
                           input.component_json::jsonb
                      FROM unnest(
                            $1::uuid[],
                            $2::varchar[],
                            $3::integer[],
                            $4::text[]
                           ) AS input(
                            transport_id,
                            component_key,
                            position,
                            component_json
                           )
                     ORDER BY input.transport_id, input.component_key
                    ON CONFLICT (transport_id, component_key) DO UPDATE
                       SET position = EXCLUDED.position,
                           component_json = EXCLUDED.component_json
                     WHERE component.position IS DISTINCT FROM EXCLUDED.position
                        OR component.component_json IS DISTINCT FROM EXCLUDED.component_json
                    RETURNING component.transport_id`,
                  [
                      claimed.map((row) => row.transportId),
                      claimed.map((row) => row.component.componentKey),
                      claimed.map((row) => row.position),
                      claimed.map((row) => jsonbParam(row.component))
                  ]
              );
    const changed = new Set<number>();
    for (const row of [...removed, ...written]) {
        const deviceListId = deviceByTransport.get(row.transport_id);
        if (deviceListId !== undefined) changed.add(deviceListId);
    }
    return changed;
}

// Column arrays in the order: address, product name, model, capability,
// source components (JSON), presentation (JSON).
function bluetoothMetadataColumns(
    children: readonly ChildPromotion[]
): unknown[][] {
    return [
        children.map((child) => child.candidate.bleAddress),
        children.map(
            (child) => child.candidate.productName ?? child.candidate.name
        ),
        children.map((child) => child.candidate.modelId),
        children.map((child) => child.candidate.capability),
        children.map((child) => jsonbParam(child.candidate.components)),
        children.map((child) =>
            jsonbParam(child.imageModel ? {imageModel: child.imageModel} : {})
        )
    ];
}

async function refreshGatewayTransports(
    ctx: PromotionContext,
    children: readonly PlacedChild[]
): Promise<TransportRefresh> {
    const states = await readGatewayTransportStates(ctx, children);
    const changed = new Set(
        states
            .filter((state) => state.stale_changed)
            .map((state) => state.blu_device_list_id)
    );
    const plans = children.map((child, index) => ({
        child,
        transportId: states[index].gateway_transport_id,
        makePrimary:
            child.promotion.makePrimary || states[index].has_no_primary,
        canWrite: candidateTransportCanWrite(child.promotion.candidate)
    }));
    const cleared = await clearPrimaryTransports(
        ctx,
        plans
            .filter((plan) => plan.makePrimary)
            .map((plan) => plan.child.ref.deviceListId)
    );
    const updated = await updateGatewayTransports(
        ctx,
        plans.flatMap(({transportId, ...plan}) =>
            transportId ? [{...plan, transportId}] : []
        )
    );
    const inserted = await insertGatewayTransports(
        ctx,
        plans.filter((plan) => !plan.transportId)
    );
    const lostPrimary = new Map<number, string[]>();
    for (const row of cleared) {
        changed.add(row.blu_device_list_id);
        if (
            row.gateway_external_id === null ||
            row.shelly_device_list_id === ctx.gatewayDeviceListId
        ) {
            continue;
        }
        lostPrimary.set(row.blu_device_list_id, [
            ...(lostPrimary.get(row.blu_device_list_id) ?? []),
            row.gateway_external_id
        ]);
    }
    for (const id of [...updated, ...inserted]) changed.add(id);
    return {
        changed,
        transportIds: plans.map(
            (plan) => plan.transportId ?? plan.child.transportId
        ),
        lostPrimary,
        linkedGateways: new Map(
            states.map((state) => [
                state.blu_device_list_id,
                state.linked_gateway_external_ids
            ])
        )
    };
}

// Retires gateway transports whose gateway row was purged. A primary held by
// a purged or retired gateway no longer counts, so a live gateway in this
// pass adopts; the main query sees the snapshot before the retirement, hence
// the explicit exclusion. A retired gateway's own pass never adopts.
async function readGatewayTransportStates(
    ctx: PromotionContext,
    children: readonly PlacedChild[]
): Promise<GatewayTransportStateRow[]> {
    const rows = await ctx.tx.query<GatewayTransportStateRow>(
        `WITH child AS (
            SELECT *
              FROM unnest($2::integer[], $3::boolean[])
                   AS c(blu_device_list_id, retire_stale)
        ),
        stale AS (
            UPDATE device.blu_transport bt
               SET enabled = FALSE,
                   is_primary = FALSE,
                   updated_at = NOW()
              FROM child
             WHERE child.retire_stale
               AND bt.organization_id = $1
               AND bt.blu_device_list_id = child.blu_device_list_id
               AND bt.mode = 'bthome_gateway'
               AND bt.shelly_device_list_id IS NULL
               AND (bt.enabled IS TRUE OR bt.is_primary IS TRUE)
             RETURNING bt.blu_device_list_id
        )
        SELECT child.blu_device_list_id,
               EXISTS (
                   SELECT 1
                     FROM stale
                    WHERE stale.blu_device_list_id = child.blu_device_list_id
               ) AS stale_changed,
               child.retire_stale AND EXISTS (
                   SELECT 1
                     FROM device.list pass_gateway
                    WHERE pass_gateway.id = $4
                      AND pass_gateway.deleted_at IS NULL
               ) AND NOT EXISTS (
                   SELECT 1
                     FROM device.blu_transport bt
                     LEFT JOIN device.list holder
                       ON holder.id = bt.shelly_device_list_id
                    WHERE bt.organization_id = $1
                      AND bt.blu_device_list_id = child.blu_device_list_id
                      AND bt.enabled IS TRUE
                      AND bt.is_primary IS TRUE
                      AND NOT (
                          bt.mode = 'bthome_gateway'
                          AND bt.shelly_device_list_id IS NULL
                      )
                      AND holder.deleted_at IS NULL
               ) AS has_no_primary,
               (
                   SELECT bt.id
                     FROM device.blu_transport bt
                    WHERE bt.organization_id = $1
                      AND bt.blu_device_list_id = child.blu_device_list_id
                      AND bt.mode = 'bthome_gateway'
                      AND bt.shelly_device_list_id = $4
                    LIMIT 1
               ) AS gateway_transport_id,
               ARRAY(
                   SELECT gateway.external_id
                     FROM device.blu_transport bt
                     JOIN device.list gateway
                       ON gateway.id = bt.shelly_device_list_id
                      AND gateway.organization_id = bt.organization_id
                    WHERE bt.organization_id = $1
                      AND bt.blu_device_list_id = child.blu_device_list_id
                      AND bt.mode = 'bthome_gateway'
                      AND bt.enabled IS TRUE
                      AND bt.shelly_device_list_id <> $4
                    ORDER BY gateway.external_id
               ) AS linked_gateway_external_ids
          FROM child`,
        [
            ctx.organizationId,
            children.map((child) => child.ref.deviceListId),
            children.map((child) => !child.promotion.makePrimary),
            ctx.gatewayDeviceListId
        ]
    );
    const byDevice = new Map(rows.map((row) => [row.blu_device_list_id, row]));
    return children.map((child) => {
        const row = byDevice.get(child.ref.deviceListId);
        if (!row) throw RpcError.OperationFailed('bluetooth promote');
        return row;
    });
}

// Returns each transport that lost the primary with its gateway, so that
// gateway's cached routes can be refreshed.
async function clearPrimaryTransports(
    ctx: PromotionContext,
    deviceListIds: readonly number[]
): Promise<
    Array<{
        blu_device_list_id: number;
        shelly_device_list_id: number | null;
        gateway_external_id: string | null;
    }>
> {
    if (deviceListIds.length === 0) return [];
    return ctx.tx.query(
        `UPDATE device.blu_transport bt
            SET is_primary = FALSE,
                updated_at = NOW()
          WHERE bt.organization_id = $1
            AND bt.blu_device_list_id = ANY($2::integer[])
            AND bt.is_primary IS TRUE
          RETURNING bt.blu_device_list_id,
                    bt.shelly_device_list_id,
                    (
                        SELECT gateway.external_id
                          FROM device.list gateway
                         WHERE gateway.id = bt.shelly_device_list_id
                    ) AS gateway_external_id`,
        [ctx.organizationId, deviceListIds]
    );
}

async function updateGatewayTransports(
    ctx: PromotionContext,
    plans: ReadonlyArray<{
        child: PlacedChild;
        transportId: string;
        makePrimary: boolean;
        canWrite: boolean;
    }>
): Promise<number[]> {
    if (plans.length === 0) return [];
    const rows = await ctx.tx.query<{blu_device_list_id: number}>(
        `UPDATE device.blu_transport bt
            SET enabled = TRUE,
                is_primary = CASE WHEN child.make_primary THEN TRUE ELSE bt.is_primary END,
                can_write = CASE WHEN child.can_write THEN TRUE ELSE bt.can_write END,
                updated_at = NOW()
           FROM unnest($2::uuid[], $3::integer[], $4::boolean[], $5::boolean[])
                AS child(id, blu_device_list_id, make_primary, can_write)
          WHERE bt.organization_id = $1
            AND bt.blu_device_list_id = child.blu_device_list_id
            AND bt.id = child.id
            AND (
                bt.enabled IS DISTINCT FROM TRUE
                OR (child.make_primary AND bt.is_primary IS DISTINCT FROM TRUE)
                OR (child.can_write AND bt.can_write IS DISTINCT FROM TRUE)
            )
          RETURNING bt.blu_device_list_id`,
        [
            ctx.organizationId,
            plans.map((plan) => plan.transportId),
            plans.map((plan) => plan.child.ref.deviceListId),
            plans.map((plan) => plan.makePrimary),
            plans.map((plan) => plan.canWrite)
        ]
    );
    return rows.map((row) => row.blu_device_list_id);
}

async function insertGatewayTransports(
    ctx: PromotionContext,
    plans: ReadonlyArray<{
        child: PlacedChild;
        makePrimary: boolean;
        canWrite: boolean;
    }>
): Promise<number[]> {
    if (plans.length === 0) return [];
    await ctx.tx.query(
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
        SELECT child.id,
               child.blu_device_list_id,
               $1,
               'bthome_gateway',
               child.make_primary,
               child.can_write,
               $2,
               TRUE
          FROM unnest($3::uuid[], $4::integer[], $5::boolean[], $6::boolean[])
               AS child(id, blu_device_list_id, make_primary, can_write)
         ORDER BY child.blu_device_list_id`,
        [
            ctx.organizationId,
            ctx.gatewayDeviceListId,
            plans.map((plan) => plan.child.transportId),
            plans.map((plan) => plan.child.ref.deviceListId),
            plans.map((plan) => plan.makePrimary),
            plans.map((plan) => plan.canWrite)
        ]
    );
    return plans.map((plan) => plan.child.ref.deviceListId);
}

async function writePromoteKeyEvents(
    ctx: PromotionContext,
    children: readonly PlacedChild[]
): Promise<void> {
    const events = children.flatMap((child) =>
        child.keyEventId ? [{child, id: child.keyEventId}] : []
    );
    if (events.length === 0) return;
    await ctx.tx.query(
        `INSERT INTO device.blu_key_event (
            id,
            blu_device_list_id,
            organization_id,
            event_type,
            key_ref,
            actor_id,
            reason
        )
        SELECT event.id, event.blu_device_list_id, $1, 'promote', NULL, $2, event.reason
          FROM unnest($3::uuid[], $4::integer[], $5::varchar[])
               WITH ORDINALITY AS event(id, blu_device_list_id, reason, position)
         ORDER BY event.position`,
        [
            ctx.organizationId,
            ctx.actorId,
            events.map((event) => event.id),
            events.map((event) => event.child.ref.deviceListId),
            events.map(
                ({child}) =>
                    `${child.promotion.candidate.gatewayExternalId}:${child.promotion.candidate.componentKey}`
            )
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

async function requireBluetoothDevices(
    tx: QueryClient,
    organizationId: string,
    refs: readonly BluetoothDeviceRef[]
): Promise<BluetoothDeviceDto[]> {
    if (refs.length === 0) return [];
    const rows = await tx.query<BluetoothDeviceRow>(
        `${bluetoothDeviceSelect()}
         WHERE bd.organization_id = $1
           AND bd.device_list_id = ANY($2::integer[])
           AND bd.deleted_at IS NULL`,
        [organizationId, [...new Set(refs.map((ref) => ref.deviceListId))]]
    );
    const byId = new Map(
        rows.map((row) => [row.device_list_id, rowToBluetoothDevice(row)])
    );
    return refs.map((ref) => {
        const device = byId.get(ref.deviceListId);
        if (!device)
            throw RpcError.NotFound('bluetooth_device', ref.externalId);
        return device;
    });
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

// The lock also reads the gateways that route the device now (enabled
// gateway transports), since removal disables or deletes those transports.
async function lockBluetoothDeviceForRemoval(
    tx: QueryClient,
    input: {organizationId: string; externalId: string}
): Promise<{deviceListId: number; linkedGatewayExternalIds: string[]}> {
    const rows = await tx.query<{
        device_list_id: number;
        linked_gateway_external_ids: string[];
    }>(
        `SELECT bd.device_list_id,
                ARRAY(
                    SELECT gateway.external_id
                      FROM device.blu_transport bt
                      JOIN device.list gateway
                        ON gateway.id = bt.shelly_device_list_id
                       AND gateway.organization_id = bt.organization_id
                     WHERE bt.organization_id = bd.organization_id
                       AND bt.blu_device_list_id = bd.device_list_id
                       AND bt.mode = 'bthome_gateway'
                       AND bt.enabled IS TRUE
                     ORDER BY gateway.external_id
                ) AS linked_gateway_external_ids
           FROM device.blu_device bd
           JOIN device.list dl
             ON dl.id = bd.device_list_id
            AND dl.organization_id = bd.organization_id
          WHERE bd.organization_id = $1
            AND dl.external_id = $2
            AND bd.deleted_at IS NULL
          FOR UPDATE OF bd`,
        [input.organizationId, input.externalId]
    );
    const row = rows[0];
    if (!row) throw RpcError.NotFound('bluetooth_device', input.externalId);
    return {
        deviceListId: row.device_list_id,
        linkedGatewayExternalIds: row.linked_gateway_external_ids
    };
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
    const meta = asRecord(config.meta);
    const controls = Array.isArray(meta.controls) ? meta.controls : [];
    if (controls.length > 0 || meta.isRemote === true) return 'event_only';
    if (components.some((component) => component.role === 'telemetry')) {
        return 'telemetry_only';
    }
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
    if (kind === 'sensor') {
        const objectId = numberValue(config.obj_id);
        return objectId !== null && isBTHomeControlObjectId(objectId)
            ? 'event_control'
            : 'telemetry';
    }
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
    const stableLeft = bluStableIdFromAddress(left);
    const stableRight = bluStableIdFromAddress(right);
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
