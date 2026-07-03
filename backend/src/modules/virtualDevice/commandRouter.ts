import type AbstractDevice from '../../model/AbstractDevice';
import {
    actionParamsSchemaFor,
    actionsForEntityType,
    translateAction
} from '../../model/entity/actionAdapter';
import RpcError from '../../rpc/RpcError';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import type {
    VirtualDeviceCommandInvokeDto,
    VirtualDeviceCommandInvokeParams,
    VirtualDeviceProfileRole
} from '../../types/api/virtualdevice';
import * as AuditLogger from '../AuditLogger';
import * as DeviceCollector from '../DeviceCollector';
import * as postgres from '../PostgresProvider';

interface VirtualDeviceCommandContext {
    actorId: string | null;
    organizationId: string;
    ipAddress?: string;
    authorizeSource(deviceExternalId: string): Promise<void>;
}

interface VirtualDeviceCommandDeps {
    queryRows<T = unknown>(
        sql: string,
        params?: readonly unknown[]
    ): Promise<Array<T>>;
    getDevice(externalId: string): SourceCommandDevice | undefined;
    audit(entry: AuditLogger.AuditLogEntry): Promise<unknown>;
}

interface SourceCommandDevice {
    methods: readonly string[];
    sendRPC(method: string, params?: unknown): Promise<unknown>;
}

interface ActiveCommandBindingRow {
    virtual_external_id: string;
    binding_id: string;
    role_key: string;
    source_external_id: string;
    source_kind: string | null;
    source_component_key: string;
    source_dynamic_category: string | null;
    profile_roles: VirtualDeviceProfileRole[] | null;
    // Null on bindings created before the persisted-writable column existed.
    binding_writable: boolean | null;
    blu_ble_address: string | null;
    blu_transport_mode: string | null;
    blu_transport_can_write: boolean | null;
    blu_gateway_external_id: string | null;
    blu_assistant_external_id: string | null;
}

interface PreparedCommand {
    row: ActiveCommandBindingRow;
    entityType: string;
    channelId: number;
    action: string;
    actionParams: Record<string, unknown>;
}

interface RoutedCommand {
    row: ActiveCommandBindingRow;
    targetExternalId: string;
    action: string;
    method: string;
    params: Record<string, unknown>;
}

const defaultDeps: VirtualDeviceCommandDeps = {
    queryRows: postgres.queryRows,
    getDevice: (externalId) =>
        DeviceCollector.getDevice(externalId) as AbstractDevice | undefined,
    audit: AuditLogger.log
};

export async function invokeVirtualDeviceRoleCommand(
    organizationId: string,
    input: VirtualDeviceCommandInvokeParams,
    context: VirtualDeviceCommandContext,
    deps: VirtualDeviceCommandDeps = defaultDeps
): Promise<VirtualDeviceCommandInvokeDto> {
    const prepared = await prepareCommand(organizationId, input, deps);
    await context.authorizeSource(prepared.row.source_external_id);
    const routed = routeCommand(prepared);
    if (routed.targetExternalId !== prepared.row.source_external_id) {
        await context.authorizeSource(routed.targetExternalId);
    }
    const device = requireOnlineSourceDevice(routed, deps);
    assertDeviceAdvertisesMethod(device, routed);
    return sendAuditedCommand(routed, device, context, deps);
}

async function prepareCommand(
    organizationId: string,
    input: VirtualDeviceCommandInvokeParams,
    deps: VirtualDeviceCommandDeps
): Promise<PreparedCommand> {
    const row = await requireActiveCommandBinding(organizationId, input, deps);
    assertRoleWritable(row);
    const source = parseSourceComponent(row.source_component_key);
    assertActionSupported(source.entityType, input.action);
    const actionParams = validateActionParams(input, source.entityType);
    return {...source, row, action: input.action, actionParams};
}

async function requireActiveCommandBinding(
    organizationId: string,
    input: VirtualDeviceCommandInvokeParams,
    deps: Pick<VirtualDeviceCommandDeps, 'queryRows'>
): Promise<ActiveCommandBindingRow> {
    const rows = await deps.queryRows<ActiveCommandBindingRow>(
        `SELECT
            dl.external_id AS virtual_external_id,
            b.id AS binding_id,
            b.role_key,
            src.external_id AS source_external_id,
            src.kind AS source_kind,
            b.source_component_key,
            b.source_dynamic_category,
            b.writable AS binding_writable,
            vdp.roles_json AS profile_roles,
            bd.ble_address AS blu_ble_address,
            bt.mode AS blu_transport_mode,
            bt.can_write AS blu_transport_can_write,
            gateway.external_id AS blu_gateway_external_id,
            assistant.external_id AS blu_assistant_external_id
           FROM device.virtual_device vd
           JOIN device.list dl
             ON dl.id = vd.device_list_id
            AND dl.organization_id = vd.organization_id
           JOIN device.virtual_device_binding b
             ON b.virtual_device_list_id = vd.device_list_id
            AND b.organization_id = vd.organization_id
            AND b.role_key = $3
            AND b.effective_to IS NULL
            AND (b.effective_from IS NULL OR b.effective_from <= NOW())
           JOIN device.list src
             ON src.id = b.source_device_list_id
            AND src.organization_id = b.organization_id
      LEFT JOIN device.virtual_device_profile vdp
             ON vdp.id = vd.profile_id
            AND vdp.organization_id = vd.organization_id
            AND vdp.deleted_at IS NULL
      LEFT JOIN device.blu_device bd
             ON bd.device_list_id = src.id
            AND bd.organization_id = src.organization_id
            AND bd.deleted_at IS NULL
      LEFT JOIN device.blu_transport bt
             ON bt.blu_device_list_id = bd.device_list_id
            AND bt.organization_id = bd.organization_id
            AND bt.is_primary IS TRUE
            AND bt.enabled IS TRUE
      LEFT JOIN device.list gateway
             ON gateway.id = bt.shelly_device_list_id
            AND gateway.organization_id = bt.organization_id
      LEFT JOIN device.list assistant
             ON assistant.id = bt.assistant_device_list_id
            AND assistant.organization_id = bt.organization_id
          WHERE vd.organization_id = $1
            AND dl.external_id = $2
            AND vd.deleted_at IS NULL
          ORDER BY b.effective_from DESC NULLS LAST
          LIMIT 1`,
        [organizationId, input.externalId, input.roleKey]
    );
    const row = rows[0];
    if (!row) {
        throw RpcError.Unavailable(
            'virtual_device_source',
            'active source binding not found'
        );
    }
    return row;
}

function assertRoleWritable(row: ActiveCommandBindingRow): void {
    // Binding-level flag wins, profile is the fallback for older rows.
    if (row.binding_writable === false) {
        throw readOnlyError(row);
    }
    if (row.binding_writable === true) return;
    const role = row.profile_roles?.find(
        (candidate) => candidate.roleKey === row.role_key
    );
    if (role && role.writable !== true) throw readOnlyError(row);
}

function readOnlyError(row: ActiveCommandBindingRow): RpcError {
    return RpcError.Domain('UnsupportedOperation', {
        message: `Role ${row.role_key} is read-only`,
        details: {roleKey: row.role_key}
    });
}

function parseSourceComponent(componentKey: string): {
    entityType: string;
    channelId: number;
} {
    const [entityType, rawId] = componentKey.split(':');
    const channelId = Number.parseInt(rawId ?? '', 10);
    if (!entityType || !Number.isFinite(channelId)) {
        throw RpcError.InvalidParams('Invalid source component key', [
            {
                field: 'source.componentKey',
                error: 'invalid component key',
                code: 'invalid_component_key'
            }
        ]);
    }
    return {entityType, channelId};
}

function assertActionSupported(entityType: string, action: string): void {
    if (
        (actionsForEntityType(entityType) as readonly string[]).includes(action)
    )
        return;
    throw RpcError.Domain('UnsupportedOperation', {
        message: `Action ${action} is not supported by ${entityType}`,
        details: {entityType, action}
    });
}

function validateActionParams(
    input: VirtualDeviceCommandInvokeParams,
    entityType: string
): Record<string, unknown> {
    return validateOrThrow<Record<string, unknown>>(
        input.params ?? {},
        actionParamsSchemaFor(input.action, entityType)
    );
}

function routeCommand(command: PreparedCommand): RoutedCommand {
    const translation = translateAction({
        entityType: command.entityType,
        channelId: command.channelId,
        action: command.action,
        actionParams: command.actionParams
    });
    return routeTranslatedCommand(command, translation);
}

function routeTranslatedCommand(
    command: PreparedCommand,
    translation: ReturnType<typeof translateAction>
): RoutedCommand {
    if (!translation.ok) throw RpcError.InvalidRequest(translation.reason);
    const base: RoutedCommand = {
        row: command.row,
        targetExternalId: command.row.source_external_id,
        action: command.action,
        method: translation.call.method,
        params: translation.call.params
    };
    if (isBluetoothSource(command.row)) {
        return routeBluetoothSourceCommand(base);
    }
    return base;
}

function isBluetoothSource(row: ActiveCommandBindingRow): boolean {
    return row.source_kind === 'bluetooth';
}

function routeBluetoothSourceCommand(command: RoutedCommand): RoutedCommand {
    assertWritableBluetoothTransport(command.row);
    switch (command.row.blu_transport_mode) {
        case 'bthome_gateway':
            return routeBluetoothGatewayCommand(command);
        case 'blu_assistant_ws':
            return routeBluetoothAssistantCommand(command);
        default:
            throw unsupportedBluetoothTransport(command.row);
    }
}

function assertWritableBluetoothTransport(row: ActiveCommandBindingRow): void {
    if (row.blu_transport_can_write === true) return;
    throw RpcError.Domain('UnsupportedOperation', {
        message: 'Bluetooth transport is not writable',
        details: {
            sourceDeviceExternalId: row.source_external_id,
            transportMode: row.blu_transport_mode
        }
    });
}

function routeBluetoothGatewayCommand(command: RoutedCommand): RoutedCommand {
    const targetExternalId = command.row.blu_gateway_external_id;
    if (!targetExternalId) throw missingBluetoothTransportTarget(command.row);
    return {...command, targetExternalId};
}

function routeBluetoothAssistantCommand(command: RoutedCommand): RoutedCommand {
    const targetExternalId = command.row.blu_assistant_external_id;
    if (!targetExternalId) throw missingBluetoothTransportTarget(command.row);
    return {
        ...command,
        targetExternalId,
        method: 'GATTC.Call',
        params: bluetoothAssistantCallParams(command)
    };
}

function bluetoothAssistantCallParams(
    command: RoutedCommand
): Record<string, unknown> {
    const addr = command.row.blu_ble_address;
    const method = command.params.method;
    if (!addr || typeof method !== 'string') {
        throw RpcError.Domain('UnsupportedOperation', {
            message: `${command.method} cannot be routed through BLU Assistant`,
            details: {
                method: command.method,
                sourceDeviceExternalId: command.row.source_external_id
            }
        });
    }
    return {
        addr,
        method,
        ...(command.params.params !== undefined
            ? {params: command.params.params}
            : {})
    };
}

function missingBluetoothTransportTarget(
    row: ActiveCommandBindingRow
): RpcError {
    return RpcError.Unavailable(
        'virtual_device_source',
        `Bluetooth transport target missing for ${row.source_external_id}`
    );
}

function unsupportedBluetoothTransport(row: ActiveCommandBindingRow): RpcError {
    return RpcError.Domain('UnsupportedOperation', {
        message: `Bluetooth transport ${row.blu_transport_mode ?? 'none'} is not supported for commands`,
        details: {
            sourceDeviceExternalId: row.source_external_id,
            transportMode: row.blu_transport_mode
        }
    });
}

function requireOnlineSourceDevice(
    command: RoutedCommand,
    deps: Pick<VirtualDeviceCommandDeps, 'getDevice'>
): SourceCommandDevice {
    const device = deps.getDevice(command.targetExternalId);
    if (!device) {
        throw sourceUnavailable(command);
    }
    return device;
}

function assertDeviceAdvertisesMethod(
    device: SourceCommandDevice,
    command: RoutedCommand
): void {
    if (device.methods.length === 0) return;
    if (device.methods.includes(command.method)) return;
    throw RpcError.Domain('UnsupportedOperation', {
        message: `${command.method} is not supported by active source`,
        details: {
            method: command.method,
            sourceDeviceExternalId: command.row.source_external_id,
            targetDeviceExternalId: command.targetExternalId
        }
    });
}

async function sendAuditedCommand(
    command: RoutedCommand,
    device: SourceCommandDevice,
    context: VirtualDeviceCommandContext,
    deps: Pick<VirtualDeviceCommandDeps, 'audit'>
): Promise<VirtualDeviceCommandInvokeDto> {
    try {
        const result = await device.sendRPC(command.method, command.params);
        await writeCommandAudit(command, context, deps, true);
        return commandResult(command, result);
    } catch (err) {
        await writeCommandAudit(command, context, deps, false, err);
        if (isSourceUnavailableError(err)) {
            throw sourceUnavailable(command);
        }
        throw RpcError.DeviceFailed(
            command.method,
            err,
            command.targetExternalId
        );
    }
}

function isSourceUnavailableError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    if ('code' in err && err.code === -32900) return true;
    if (!('message' in err)) return false;
    return /device not found|not connected|offline/i.test(String(err.message));
}

function sourceUnavailable(command: RoutedCommand): RpcError {
    return RpcError.Unavailable(
        'virtual_device_source',
        `${command.targetExternalId} is offline`
    );
}

async function writeCommandAudit(
    command: RoutedCommand,
    context: VirtualDeviceCommandContext,
    deps: Pick<VirtualDeviceCommandDeps, 'audit'>,
    success: boolean,
    err?: unknown
): Promise<void> {
    await deps.audit({
        eventType: 'rpc',
        username: context.actorId ?? undefined,
        method: 'virtualdevice.Command.Invoke',
        params: auditParams(command),
        shellyId: command.targetExternalId,
        shellyIds: [
            command.row.virtual_external_id,
            command.row.source_external_id,
            command.targetExternalId
        ],
        success,
        errorMessage: err instanceof Error ? err.message : undefined,
        ipAddress: context.ipAddress,
        organizationId: context.organizationId
    });
}

function auditParams(command: RoutedCommand): Record<string, unknown> {
    return {
        externalId: command.row.virtual_external_id,
        roleKey: command.row.role_key,
        action: command.action,
        bindingId: command.row.binding_id,
        source: sourceRef(command.row),
        method: command.method,
        params: command.params
    };
}

function commandResult(
    command: RoutedCommand,
    result: unknown
): VirtualDeviceCommandInvokeDto {
    return {
        externalId: command.row.virtual_external_id,
        roleKey: command.row.role_key,
        bindingId: command.row.binding_id,
        source: sourceRef(command.row),
        action: command.action,
        method: command.method,
        result: result ?? null
    };
}

function sourceRef(row: ActiveCommandBindingRow) {
    return {
        deviceExternalId: row.source_external_id,
        componentKey: row.source_component_key,
        ...(row.source_dynamic_category
            ? {dynamicCategory: row.source_dynamic_category as never}
            : {})
    };
}
