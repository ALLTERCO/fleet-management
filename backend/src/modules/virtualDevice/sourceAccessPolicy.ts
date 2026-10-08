import RpcError from '../../rpc/RpcError';
import type {
    BluetoothDeviceDto,
    BluetoothTransportDto
} from '../../types/api/virtualdevice';
import * as postgres from '../PostgresProvider';

export interface VirtualSourceAccessSender {
    filterAccessibleDevices(ids: string[]): Promise<Set<string>>;
}

export interface VirtualSourceAccessDeps {
    queryRows<T = unknown>(
        sql: string,
        params?: readonly unknown[]
    ): Promise<T[]>;
}

export interface VirtualDeviceSourceReadScope {
    includeHistorical?: boolean;
    roleKey?: string;
    window?: {from: Date | string; to: Date | string};
}

export interface SourceAttributed {
    sourceExternalId: string;
    historySourceExternalIds?: readonly string[];
    historySources?: ReadonlyArray<{
        externalId: string;
        effectiveFrom: string;
        effectiveTo: string | null;
    }>;
}

const defaultDeps: VirtualSourceAccessDeps = {queryRows: postgres.queryRows};

export async function filterReadableDeviceIds(
    sender: VirtualSourceAccessSender,
    externalIds: readonly string[]
): Promise<Set<string>> {
    const unique = [...new Set(externalIds)];
    if (unique.length === 0) return new Set();
    return sender.filterAccessibleDevices(unique);
}

export async function requireDeviceReads(
    sender: VirtualSourceAccessSender,
    externalIds: readonly string[]
): Promise<void> {
    const unique = [...new Set(externalIds)];
    if (unique.length === 0) return;
    const allowed = await filterReadableDeviceIds(sender, unique);
    if (unique.every((externalId) => allowed.has(externalId))) return;
    throw RpcError.Domain('PermissionDenied');
}

interface GatewayRef {
    shellyDeviceExternalId?: string | null;
    assistantDeviceExternalId?: string | null;
}

// Reading a BLU device does not grant reading the gateway that relays it, so
// a gateway the caller cannot read is named as null.
export async function redactUnreadableBluetoothGateways(
    sender: VirtualSourceAccessSender,
    devices: readonly BluetoothDeviceDto[]
): Promise<BluetoothDeviceDto[]> {
    const readable = await readableGateways(
        sender,
        devices.flatMap((device) =>
            device.primaryTransport ? [device.primaryTransport] : []
        )
    );
    return devices.map((device) =>
        device.primaryTransport
            ? {
                  ...device,
                  primaryTransport: redactGatewayRef(
                      device.primaryTransport,
                      readable
                  )
              }
            : device
    );
}

export async function redactUnreadableTransportGateways(
    sender: VirtualSourceAccessSender,
    transports: readonly BluetoothTransportDto[]
): Promise<BluetoothTransportDto[]> {
    const readable = await readableGateways(sender, transports);
    return transports.map((transport) => redactGatewayRef(transport, readable));
}

function readableGateways(
    sender: VirtualSourceAccessSender,
    refs: readonly GatewayRef[]
): Promise<Set<string>> {
    return filterReadableDeviceIds(
        sender,
        refs.flatMap((ref) =>
            [ref.shellyDeviceExternalId, ref.assistantDeviceExternalId].filter(
                (id): id is string => !!id
            )
        )
    );
}

function redactGatewayRef<T extends GatewayRef>(
    ref: T,
    readable: ReadonlySet<string>
): T {
    const visible = (id: string | null | undefined) =>
        id && !readable.has(id) ? null : id;
    return {
        ...ref,
        shellyDeviceExternalId: visible(ref.shellyDeviceExternalId),
        assistantDeviceExternalId: visible(ref.assistantDeviceExternalId)
    };
}

export async function requireVirtualSourceReads(
    sender: VirtualSourceAccessSender,
    sourceExternalIds: readonly string[]
): Promise<void> {
    return requireDeviceReads(sender, sourceExternalIds);
}

/** Keep denied keys with an empty role list so downstream repositories also
 * exclude the custom device id instead of accidentally treating it as a
 * physical telemetry id. */
export async function filterReadableVirtualSourceMap<
    T extends SourceAttributed
>(
    sender: VirtualSourceAccessSender,
    sources: ReadonlyMap<number, readonly T[]>,
    window?: {from: Date | string; to: Date | string}
): Promise<Map<number, T[]>> {
    const allSourceIds = [
        ...new Set(
            [...sources.values()].flatMap((items) =>
                items.flatMap((item) => sourceIdsForWindow(item, window))
            )
        )
    ];
    const readable = await filterReadableDeviceIds(sender, allSourceIds);
    return new Map(
        [...sources].map(([virtualId, items]) => [
            virtualId,
            items.every((item) =>
                sourceIdsForWindow(item, window).every((sourceId) =>
                    readable.has(sourceId)
                )
            )
                ? [...items]
                : []
        ])
    );
}

function sourceIdsForWindow(
    item: SourceAttributed,
    window?: {from: Date | string; to: Date | string}
): string[] {
    if (item.historySources?.length) {
        const from = window ? new Date(window.from).getTime() : -Infinity;
        const to = window ? new Date(window.to).getTime() : Infinity;
        return [
            ...new Set(
                item.historySources
                    .filter((segment) => {
                        const segmentFrom = new Date(
                            segment.effectiveFrom
                        ).getTime();
                        const segmentTo = segment.effectiveTo
                            ? new Date(segment.effectiveTo).getTime()
                            : Infinity;
                        return segmentFrom < to && segmentTo > from;
                    })
                    .map((segment) => segment.externalId)
            )
        ];
    }
    return item.historySourceExternalIds?.length
        ? [...item.historySourceExternalIds]
        : [item.sourceExternalId];
}

export async function requireVirtualDeviceSourceReads(
    organizationId: string,
    sender: VirtualSourceAccessSender,
    virtualExternalIds: readonly string[],
    requestedScope: boolean | VirtualDeviceSourceReadScope = false,
    deps: VirtualSourceAccessDeps = defaultDeps
): Promise<void> {
    const scope =
        typeof requestedScope === 'boolean'
            ? {includeHistorical: requestedScope}
            : requestedScope;
    const rows = await loadVirtualSourceRows(
        organizationId,
        virtualExternalIds,
        scope,
        deps
    );
    await requireVirtualSourceReads(
        sender,
        rows.map((row) => row.source_external_id)
    );
}

/**
 * A custom device is readable only when both its public identity and every
 * active source it consumes are readable. This is the shared collection
 * policy for List/exports and prevents derived values from bypassing source
 * scope restrictions.
 */
export async function filterReadableVirtualDeviceIds(
    organizationId: string,
    sender: VirtualSourceAccessSender,
    virtualExternalIds: readonly string[],
    deps: VirtualSourceAccessDeps = defaultDeps
): Promise<Set<string>> {
    const candidates = [...new Set(virtualExternalIds)];
    if (candidates.length === 0) return new Set();
    const readableTargets = await filterReadableDeviceIds(sender, candidates);
    const rows = await loadVirtualSourceRows(
        organizationId,
        candidates,
        {},
        deps
    );
    const sourceIds = [...new Set(rows.map((row) => row.source_external_id))];
    const readableSources = await filterReadableDeviceIds(sender, sourceIds);
    const deniedTargets = new Set(
        rows
            .filter((row) => !readableSources.has(row.source_external_id))
            .map((row) => row.virtual_external_id)
    );
    return new Set(
        candidates.filter(
            (externalId) =>
                readableTargets.has(externalId) &&
                !deniedTargets.has(externalId)
        )
    );
}

interface VirtualSourceRow {
    virtual_external_id: string;
    source_external_id: string;
}

async function loadVirtualSourceRows(
    organizationId: string,
    virtualExternalIds: readonly string[],
    scope: VirtualDeviceSourceReadScope,
    deps: VirtualSourceAccessDeps
): Promise<VirtualSourceRow[]> {
    if (virtualExternalIds.length === 0) return [];
    // Bindings are tenant rows; no organization must never mean all of them.
    if (!organizationId) throw RpcError.Domain('OrgScopeRequired');
    return deps.queryRows<VirtualSourceRow>(
        `SELECT
            target.external_id AS virtual_external_id,
            source.external_id AS source_external_id
           FROM device.virtual_device_binding binding
           JOIN device.list target
             ON target.id = binding.virtual_device_list_id
            AND target.organization_id = binding.organization_id
           JOIN device.list source
             ON source.id = binding.source_device_list_id
            AND source.organization_id = binding.organization_id
          WHERE binding.organization_id = $1
            AND target.external_id = ANY($2::varchar[])
            AND ($4::varchar IS NULL OR binding.role_key = $4)
            AND (
                (NOT $3::boolean
                    AND binding.effective_from <= NOW()
                    AND binding.effective_to IS NULL)
                OR
                ($3::boolean
                    AND binding.effective_from < COALESCE(
                        $6::timestamptz,
                        'infinity'::timestamptz
                    )
                    AND COALESCE(
                        binding.effective_to,
                        'infinity'::timestamptz
                    ) > COALESCE(
                        $5::timestamptz,
                        '-infinity'::timestamptz
                    ))
            )`,
        [
            organizationId,
            [...new Set(virtualExternalIds)],
            scope.includeHistorical ?? false,
            scope.roleKey ?? null,
            scope.window?.from ?? null,
            scope.window?.to ?? null
        ]
    );
}
