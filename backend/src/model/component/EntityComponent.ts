import {tuning} from '../../config';
import {
    canCrossOrganizationBoundary,
    canPerformComponentOperationAsync,
    canUseAuthenticatedRead,
    isComponentPermissionAllowed,
    requireComponentPermissionAsync
} from '../../modules/authz/evaluator';
import * as DeviceCollector from '../../modules/DeviceCollector';
import * as PostgresProvider from '../../modules/PostgresProvider';
import {getBluetoothDevice} from '../../modules/virtualDevice/bluetoothRepository';
import {invokeVirtualDeviceRoleCommand} from '../../modules/virtualDevice/commandRouter';
import {
    bluetoothEntityGetResponse,
    bluetoothEntityStatusFrom,
    parseBluetoothEntityId
} from '../../modules/virtualDevice/deviceListEntry';
import {
    bluetoothDeviceSnapshot,
    createDeviceCollectorSnapshotFetcher
} from '../../modules/virtualDevice/deviceListIntegration';
import {
    isVirtualEntityId,
    listVirtualEntities,
    listVirtualEntityOwners,
    resolveVirtualEntity,
    type VirtualEntityOwnerSummary,
    type VirtualEntityResolution
} from '../../modules/virtualDevice/virtualEntityResolver';
import type {DescribeOutput} from '../../rpc/describe';
import {buildListResponse} from '../../rpc/listResponse';
import RpcError from '../../rpc/RpcError';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import type {entity_t} from '../../types';
import {
    ENTITY_DESCRIBE,
    ENTITY_GET_ACTION_SCHEMA_PARAMS_SCHEMA,
    ENTITY_GET_CAPABILITIES_PARAMS_SCHEMA,
    ENTITY_GET_PARAMS_SCHEMA,
    ENTITY_INVOKE_ACTION_PARAMS_SCHEMA,
    ENTITY_LIST_PARAMS_SCHEMA,
    type EntityCapabilityResponse,
    type EntityGetActionSchemaParams,
    type EntityGetActionSchemaResponse,
    type EntityGetCapabilitiesParams,
    type EntityGetParams,
    type EntityGetResponse,
    type EntityInvokeActionParams,
    type EntityInvokeActionResponse,
    type EntityListParams
} from '../../types/api/entity';
import type CommandSender from '../CommandSender';
import {
    actionParamsSchemaFor,
    actionsForEntityType,
    shellyMethodForAction,
    translateAction
} from '../entity/actionAdapter';
import Component from './Component';
import {
    assertDeviceReadAccessAsync,
    canReadDeviceFieldAsync
} from './entityPermissions';

function virtualEntityDeps(organizationId: string) {
    const physicalSnapshot =
        createDeviceCollectorSnapshotFetcher(DeviceCollector);
    const bluetoothSnapshots = new Map<
        string,
        Promise<ReturnType<typeof bluetoothDeviceSnapshot> | null>
    >();
    return {
        queryRows: PostgresProvider.queryRows,
        getSourceSnapshot: async (externalId: string) => {
            const physical = physicalSnapshot(externalId);
            if (physical) return physical;
            if (!externalId.startsWith('blu_')) return null;
            const cached = bluetoothSnapshots.get(externalId);
            if (cached) return cached;
            const snapshot = getBluetoothDevice(
                organizationId,
                externalId
            ).then((bluetooth) => {
                if (!bluetooth) return null;
                const gateway = bluetooth.primaryTransport
                    ?.shellyDeviceExternalId
                    ? physicalSnapshot(
                          bluetooth.primaryTransport.shellyDeviceExternalId
                      )
                    : null;
                return bluetoothDeviceSnapshot({device: bluetooth, gateway});
            });
            bluetoothSnapshots.set(externalId, snapshot);
            return snapshot;
        }
    };
}

async function resolveVirtualEntityForSender(
    sender: CommandSender,
    entityId: string
): Promise<VirtualEntityResolution | null> {
    const organizationId = sender.getOrganizationId();
    if (!organizationId || !isVirtualEntityId(entityId)) return null;
    return resolveVirtualEntity(
        {organizationId, entityId},
        virtualEntityDeps(organizationId)
    );
}

async function resolveReadableVirtualEntity(
    sender: CommandSender,
    entityId: string
): Promise<VirtualEntityResolution | null> {
    const entity = await resolveVirtualEntityForSender(sender, entityId);
    if (!entity) return null;
    await assertDeviceReadAccessAsync(sender, entity.deviceExternalId);
    return entity;
}

// Entities on a promoted BLU device are DB rows, not in DeviceCollector, so the
// read methods look them up here. Loads the device + gateway-projected snapshot
// (for presence + live status), with the read permission check.
async function loadBluetoothEntity(
    sender: CommandSender,
    entityId: string
): Promise<{
    parsed: NonNullable<ReturnType<typeof parseBluetoothEntityId>>;
    device: NonNullable<Awaited<ReturnType<typeof getBluetoothDevice>>>;
    snapshot: ReturnType<typeof bluetoothDeviceSnapshot>;
} | null> {
    const parsed = parseBluetoothEntityId(entityId);
    if (!parsed) return null;
    const organizationId = sender.getOrganizationId();
    if (!organizationId) return null;
    const device = await getBluetoothDevice(organizationId, parsed.externalId);
    if (!device) return null;
    await assertDeviceReadAccessAsync(sender, parsed.externalId);
    const gateway = device.primaryTransport?.shellyDeviceExternalId
        ? createDeviceCollectorSnapshotFetcher(DeviceCollector)(
              device.primaryTransport.shellyDeviceExternalId
          )
        : null;
    return {
        parsed,
        device,
        snapshot: bluetoothDeviceSnapshot({device, gateway})
    };
}

async function resolveBluetoothEntity(
    sender: CommandSender,
    entityId: string
): Promise<EntityGetResponse | null> {
    const ctx = await loadBluetoothEntity(sender, entityId);
    if (!ctx) return null;
    return bluetoothEntityGetResponse(
        entityId,
        ctx.device,
        ctx.snapshot.presence === 'online'
    ) as EntityGetResponse | null;
}

async function resolveExecutableVirtualEntity(
    sender: CommandSender,
    entityId: string
): Promise<VirtualEntityResolution | null> {
    const entity = await resolveVirtualEntityForSender(sender, entityId);
    if (!entity) return null;
    await requireComponentPermissionAsync(
        sender,
        'devices',
        'execute',
        entity.deviceExternalId
    );
    return entity;
}

function virtualCapabilities(
    entity: VirtualEntityResolution
): EntityCapabilityResponse {
    return {
        type: entity.entity.type,
        actions: [...supportedVirtualActions(entity)]
    };
}

function assertVirtualActionSupported(
    entity: VirtualEntityResolution,
    action: string
): void {
    const supported = supportedVirtualActions(entity);
    if (!(supported as readonly string[]).includes(action)) {
        throw RpcError.Domain('EntityCapabilityUnknown', {
            details: {action, type: entity.entity.type}
        });
    }
}

function supportedVirtualActions(entity: VirtualEntityResolution) {
    const candidateActions = effectiveVirtualActions(entity);
    const sourceMethods = sourceDeviceMethods(entity);
    if (sourceMethods === null) return [];
    if (sourceMethods.length === 0) return candidateActions;
    return candidateActions.filter((action) => {
        const method = shellyMethodForAction(entity.entity.type, action);
        return method !== null && sourceMethods.includes(method);
    });
}

function effectiveVirtualActions(entity: VirtualEntityResolution) {
    return entity.entity.properties.writable
        ? actionsForEntityType(entity.entity.type)
        : [];
}

function sourceDeviceMethods(
    entity: VirtualEntityResolution
): readonly string[] | null {
    return (
        DeviceCollector.getDevice(entity.sourceDeviceExternalId)?.methods ??
        null
    );
}

async function invokeVirtualEntityAction(
    sender: CommandSender,
    input: EntityInvokeActionParams,
    entity: VirtualEntityResolution
): Promise<EntityInvokeActionResponse> {
    assertVirtualActionSupported(entity, input.action);
    const actionParams = validateOrThrow<Record<string, unknown>>(
        input.params ?? {},
        actionParamsSchemaFor(input.action, entity.entity.type)
    );
    const organizationId = sender.getOrganizationId();
    if (!organizationId) throw RpcError.Unauthorized();
    const result = await invokeVirtualDeviceRoleCommand(
        organizationId,
        {
            externalId: entity.deviceExternalId,
            roleKey: entity.roleKey,
            action: input.action,
            params: actionParams
        },
        {
            actorId: sender.getUser()?.username ?? sender.getUserId() ?? null,
            organizationId,
            ipAddress: sender.getSourceIp(),
            authorizeSource: (deviceExternalId) =>
                requireComponentPermissionAsync(
                    sender,
                    'devices',
                    'execute',
                    deviceExternalId
                ).then(() => undefined)
        }
    );
    return {
        id: input.id,
        action: input.action,
        result: result.result ?? null
    };
}

function virtualEntityGetResponse(entity: VirtualEntityResolution) {
    return {
        id: entity.entity.id,
        name: entity.entity.name,
        type: entity.entity.type,
        source: entity.deviceExternalId,
        online: entity.online,
        properties: entity.entity.properties as Record<string, unknown>
    };
}

async function readableVirtualEntities(
    sender: CommandSender
): Promise<VirtualEntityResolution[]> {
    const organizationId = sender.getOrganizationId();
    if (!organizationId) return [];
    const owners = await accessibleVirtualEntityOwners(sender, organizationId);
    const ownerIds = owners.map((owner) => owner.deviceExternalId);
    if (ownerIds.length === 0) return [];
    const entities = await listVirtualEntities(
        {organizationId, deviceExternalIds: ownerIds},
        virtualEntityDeps(organizationId)
    );
    return entities;
}

async function accessibleVirtualEntityOwners(
    sender: CommandSender,
    organizationId: string
): Promise<VirtualEntityOwnerSummary[]> {
    const owners = await listVirtualEntityOwners(
        {organizationId},
        {queryRows: PostgresProvider.queryRows}
    );
    if (owners.length === 0 || canCrossOrganizationBoundary(sender)) {
        return owners;
    }
    const accessible = await sender.filterAccessibleDevices([
        ...new Set(owners.map((owner) => owner.deviceExternalId))
    ]);
    return owners.filter((owner) => accessible.has(owner.deviceExternalId));
}

function virtualEntityListItem(
    entity: VirtualEntityResolution
): entity_t & {source: string; online: boolean} {
    return {
        ...(entity.entity as unknown as entity_t),
        source: entity.deviceExternalId,
        online: entity.online
    };
}

function statusRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return value === null || value === undefined ? {} : {value};
    }
    return value as Record<string, unknown>;
}

export async function canInvokeEntityAction(
    sender: CommandSender,
    params: unknown
): Promise<boolean> {
    const entityId = entityIdParam(params);
    if (entityId && isVirtualEntityId(entityId)) {
        return canUseAuthenticatedRead(sender);
    }
    const itemId = entityId ? physicalEntityDeviceId(entityId) : undefined;
    const decision = await canPerformComponentOperationAsync(
        sender,
        'devices',
        'execute',
        itemId
    );
    return isComponentPermissionAllowed(decision);
}

function entityIdParam(params: unknown): string | undefined {
    if (!params || typeof params !== 'object') return undefined;
    const id = (params as {id?: unknown}).id;
    return typeof id === 'string' ? id : undefined;
}

function physicalEntityDeviceId(entityId: string): string | undefined {
    return DeviceCollector.findEntityAndDevice(entityId)?.device.shellyID as
        | string
        | undefined;
}

export default class EntityComponent extends Component<any> {
    declare config: never;

    constructor() {
        super('entity', {viewer_visible: true});
        this.methods.delete('setconfig');
    }

    protected override checkConfigKey(_key: string, _value: any): boolean {
        return false;
    }

    // Entity.* params.id is an entity id, not a shellyID. The base permission
    // gate uses this to scope-check against devices — so we resolve it to
    // the owning device's shellyID here.
    protected override extractItemId(params?: any): string | undefined {
        const id = params?.id;
        if (typeof id !== 'string') return undefined;
        return DeviceCollector.findEntityAndDevice(id)?.device.shellyID as
            | string
            | undefined;
    }

    override getStatus(params?: any): Record<string, any> {
        if (!params || typeof params?.id !== 'string') {
            const keys = DeviceCollector.getAll().flatMap((device) =>
                device.entities.map((entity) => entity.id)
            );
            return {entities_count: keys.length, entities: keys};
        }
        const bundle = DeviceCollector.findEntityAndDevice(params.id);
        if (!bundle) return {};
        const {entity, device} = bundle;
        return device.status[`${entity.type}:${entity.properties.id}`] ?? {};
    }

    override getConfig(params?: any): Record<string, any> {
        if (!params || typeof params?.id !== 'string') return {};
        const bundle = DeviceCollector.findEntityAndDevice(params.id);
        if (!bundle) return {};
        const {entity, device} = bundle;
        return device.config[`${entity.type}:${entity.properties.id}`] ?? {};
    }

    // Sender-aware variants wired into addDefaultMethods.
    async #getStatusForSender(
        params: any,
        sender: CommandSender
    ): Promise<Record<string, any>> {
        if (!params || typeof params?.id !== 'string') {
            const devices = DeviceCollector.getAll();
            const visible = canCrossOrganizationBoundary(sender)
                ? devices
                : await this.#filterDevicesBySender(devices, sender);
            const physicalKeys = visible.flatMap((device) =>
                device.entities.map((entity) => entity.id)
            );
            const virtualKeys = (await readableVirtualEntities(sender)).map(
                (entity) => entity.entity.id
            );
            const keys = [...physicalKeys, ...virtualKeys];
            return {entities_count: keys.length, entities: keys};
        }
        const bundle = DeviceCollector.findEntityAndDevice(params.id);
        if (!bundle) {
            const virtualEntity = await resolveReadableVirtualEntity(
                sender,
                params.id
            );
            if (virtualEntity) return statusRecord(virtualEntity.status);
            const bluetooth = await loadBluetoothEntity(sender, params.id);
            return bluetooth
                ? bluetoothEntityStatusFrom(
                      params.id,
                      bluetooth.snapshot.status ?? {}
                  )
                : {};
        }
        const {entity, device} = bundle;
        if (!(await canReadDeviceFieldAsync(sender, device.shellyID))) {
            return {};
        }
        return device.status[`${entity.type}:${entity.properties.id}`] ?? {};
    }

    async #getConfigForSender(
        params: any,
        sender: CommandSender
    ): Promise<Record<string, any>> {
        if (!params || typeof params?.id !== 'string') return {};
        const bundle = DeviceCollector.findEntityAndDevice(params.id);
        if (!bundle) return {};
        const {entity, device} = bundle;
        if (!(await canReadDeviceFieldAsync(sender, device.shellyID))) {
            return {};
        }
        return device.config[`${entity.type}:${entity.properties.id}`] ?? {};
    }

    async #filterDevicesBySender(
        devices: ReturnType<typeof DeviceCollector.getAll>,
        sender: CommandSender
    ) {
        const allowed = await sender.filterAccessibleDevices(
            devices.map((d) => d.shellyID)
        );
        return devices.filter((d) => allowed.has(d.shellyID));
    }

    protected override configureDefaultReadMethods(): void {
        this.replaceDefaultReadMethods({
            getStatus: (params, sender) =>
                this.#getStatusForSender(params, sender),
            getConfig: (params, sender) =>
                this.#getConfigForSender(params, sender)
        });
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return ENTITY_DESCRIBE;
    }

    /**
     * Return the backend-declared capability set for an entity. Phase 1b
     * wires InvokeAction against the same registry.
     *
     * Permission model: requires `devices:read` on the entity's parent
     * device — admin-only check is skipped the same way `GetInfo` does.
     */
    @Component.NoAudit
    @Component.Expose('GetCapabilities')
    @Component.CheckPermissions(canUseAuthenticatedRead)
    async getCapabilities(
        params: unknown,
        sender: CommandSender
    ): Promise<EntityCapabilityResponse> {
        const validated = validateOrThrow<EntityGetCapabilitiesParams>(
            params,
            ENTITY_GET_CAPABILITIES_PARAMS_SCHEMA
        );

        const bundle = DeviceCollector.findEntityAndDevice(validated.id);
        if (!bundle) {
            const virtualEntity = await resolveReadableVirtualEntity(
                sender,
                validated.id
            );
            if (virtualEntity) return virtualCapabilities(virtualEntity);
            // BLU sensors are read-only telemetry — no actions. Controls
            // (buttons/TRVs) will add actions once InvokeAction supports BLU.
            const bluetooth = await loadBluetoothEntity(sender, validated.id);
            if (bluetooth) return {type: bluetooth.parsed.type, actions: []};
            throw RpcError.NotFound('entity', validated.id);
        }
        await assertDeviceReadAccessAsync(
            sender,
            bundle.device.shellyID as string
        );

        const candidateActions = actionsForEntityType(bundle.entity.type);
        const deviceMethods = bundle.device.methods;
        // Filter by what the device actually advertises. An empty method
        // list (old devices, unit tests) falls back to the full candidate
        // set — behavior is unchanged until Shelly.ListMethods is wired.
        const actions =
            deviceMethods && deviceMethods.length > 0
                ? candidateActions.filter((action) => {
                      const method = shellyMethodForAction(
                          bundle.entity.type,
                          action
                      );
                      return method !== null && deviceMethods.includes(method);
                  })
                : candidateActions;
        return {
            type: bundle.entity.type,
            actions: [...actions]
        };
    }

    @Component.Expose('GetActionSchema')
    @Component.CheckPermissions(canUseAuthenticatedRead)
    async getActionSchema(
        params: unknown,
        sender: CommandSender
    ): Promise<EntityGetActionSchemaResponse> {
        const validated = validateOrThrow<EntityGetActionSchemaParams>(
            params,
            ENTITY_GET_ACTION_SCHEMA_PARAMS_SCHEMA
        );
        const bundle = DeviceCollector.findEntityAndDevice(validated.id);
        if (!bundle) {
            const virtualEntity = await resolveReadableVirtualEntity(
                sender,
                validated.id
            );
            if (!virtualEntity) throw RpcError.NotFound('entity', validated.id);
            assertVirtualActionSupported(virtualEntity, validated.action);
            return {
                type: virtualEntity.entity.type,
                action: validated.action,
                schema: actionParamsSchemaFor(
                    validated.action,
                    virtualEntity.entity.type
                )
            };
        }
        await assertDeviceReadAccessAsync(
            sender,
            bundle.device.shellyID as string
        );
        const supported = actionsForEntityType(bundle.entity.type);
        if (!(supported as readonly string[]).includes(validated.action)) {
            throw RpcError.Domain('EntityCapabilityUnknown', {
                details: {action: validated.action, type: bundle.entity.type}
            });
        }
        return {
            type: bundle.entity.type,
            action: validated.action,
            schema: actionParamsSchemaFor(validated.action, bundle.entity.type)
        };
    }

    /**
     * Return the normalized summary of a single entity. Replaces the
     * legacy `Entity.GetInfo` method — Phase 1 cutover deletes GetInfo
     * and migrates frontend callers to `Get`.
     */
    @Component.NoAudit
    @Component.Expose('Get')
    @Component.CheckPermissions(canUseAuthenticatedRead)
    async get(
        params: unknown,
        sender: CommandSender
    ): Promise<EntityGetResponse> {
        const validated = validateOrThrow<EntityGetParams>(
            params,
            ENTITY_GET_PARAMS_SCHEMA
        );
        const bundle = DeviceCollector.findEntityAndDevice(validated.id);
        if (!bundle) {
            const virtualEntity = await resolveReadableVirtualEntity(
                sender,
                validated.id
            );
            if (virtualEntity) return virtualEntityGetResponse(virtualEntity);
            const bluetooth = await resolveBluetoothEntity(
                sender,
                validated.id
            );
            if (bluetooth) return bluetooth;
            throw RpcError.NotFound('entity', validated.id);
        }
        const shellyID = bundle.device.shellyID as string;
        await assertDeviceReadAccessAsync(sender, shellyID);
        const entity = bundle.entity;
        return {
            id: entity.id,
            name: entity.name,
            type: entity.type,
            source: shellyID,
            online: bundle.device.presence === 'online',
            properties: entity.properties as Record<string, unknown>
        };
    }

    /**
     * Invoke a capability action on an entity. The backend looks up the
     * entity, translates the action verb to the right Shelly device RPC
     * via the action adapter, and dispatches.
     *
     * Frontend callers no longer need to know per-type method names —
     * Phase 1 cutover deletes `toggleSet/dimmerActions/bulbActions` from
     * `entity-registry.ts` in favor of this method.
     */
    @Component.Expose('InvokeAction')
    @Component.CheckPermissions(canInvokeEntityAction)
    async invokeAction(
        params: unknown,
        sender: CommandSender
    ): Promise<EntityInvokeActionResponse> {
        const validated = validateOrThrow<EntityInvokeActionParams>(
            params,
            ENTITY_INVOKE_ACTION_PARAMS_SCHEMA
        );

        const bundle = DeviceCollector.findEntityAndDevice(validated.id);
        if (!bundle) {
            const virtualEntity = await resolveExecutableVirtualEntity(
                sender,
                validated.id
            );
            if (!virtualEntity) throw RpcError.NotFound('entity', validated.id);
            return invokeVirtualEntityAction(sender, validated, virtualEntity);
        }

        // Reject unsupported actions up front (translateAction's
        // "no builder" branch otherwise blames a backend bug)
        const supported = actionsForEntityType(bundle.entity.type);
        if (!(supported as readonly string[]).includes(validated.action)) {
            throw RpcError.Domain('EntityCapabilityUnknown', {
                details: {action: validated.action, type: bundle.entity.type}
            });
        }

        // Validate the action's params against its per-action schema
        const actionSchema = actionParamsSchemaFor(
            validated.action,
            bundle.entity.type
        );
        const actionParams = validateOrThrow<Record<string, unknown>>(
            validated.params ?? {},
            actionSchema
        );

        const channelId = (bundle.entity.properties as {id?: number}).id;
        if (typeof channelId !== 'number') {
            throw RpcError.Domain('EntityCapabilityUnknown', {
                message: `Entity ${validated.id} has no numeric channel id`,
                details: {
                    entityId: validated.id,
                    reason: 'missing-channel-id'
                }
            });
        }

        const translation = translateAction({
            entityType: bundle.entity.type,
            channelId,
            action: validated.action,
            actionParams
        });
        if (!translation.ok) {
            throw RpcError.InvalidRequest(translation.reason);
        }

        let result: unknown;
        try {
            result = await bundle.device.sendRPC(
                translation.call.method,
                translation.call.params
            );
        } catch (err) {
            throw RpcError.DeviceFailed(
                translation.call.method,
                err,
                bundle.device.shellyID
            );
        }

        return {
            id: validated.id,
            action: validated.action,
            result: result ?? null
        };
    }

    @Component.NoAudit
    @Component.Expose('List')
    @Component.NoPermissions
    async listEntities(rawParams: unknown, sender: CommandSender) {
        const params = validateOrThrow<EntityListParams>(
            rawParams ?? {},
            ENTITY_LIST_PARAMS_SCHEMA
        );
        const allDevices = DeviceCollector.getAll();
        const uniqueSources = [
            ...new Set(allDevices.map((d) => d.shellyID as string))
        ];
        const accessible = await sender.filterAccessibleDevices(uniqueSources);

        const rawLimit =
            typeof params?.limit === 'number'
                ? params.limit
                : tuning.db.entityListPageMax;
        const limit = rawLimit === 0 ? Number.POSITIVE_INFINITY : rawLimit;
        const offset =
            typeof params?.offset === 'number' && params.offset >= 0
                ? params.offset
                : 0;
        const pageEnd = offset + limit;
        const organizationId = sender.getOrganizationId();
        const virtualOwners = organizationId
            ? await accessibleVirtualEntityOwners(sender, organizationId)
            : [];
        const virtualTotal = virtualOwners.reduce(
            (sum, owner) => sum + owner.entityCount,
            0
        );

        // Single pass: count all, collect only [offset, pageEnd).
        // Avoids materializing the full N-entity array before slicing.
        let total = 0;
        const page: (entity_t & {source: string; online: boolean})[] = [];
        for (const device of allDevices) {
            if (!accessible.has(device.shellyID as string)) continue;
            const online = device.presence === 'online';
            for (const entity of device.entities) {
                if (total >= offset && total < pageEnd) {
                    page.push({
                        ...entity,
                        source: device.shellyID as string,
                        online
                    });
                }
                total++;
            }
        }
        const physicalTotal = total;
        const virtualOffset = Math.max(0, offset - physicalTotal);
        const virtualLimit = Number.isFinite(limit)
            ? Math.max(0, limit - page.length)
            : undefined;
        const virtualEntities =
            organizationId && virtualOwners.length > 0 && virtualLimit !== 0
                ? await listVirtualEntities(
                      {
                          organizationId,
                          deviceExternalIds: virtualOwners.map(
                              (owner) => owner.deviceExternalId
                          ),
                          limit: virtualLimit,
                          offset: virtualOffset
                      },
                      virtualEntityDeps(organizationId)
                  )
                : [];
        for (const virtualEntity of virtualEntities) {
            page.push(virtualEntityListItem(virtualEntity));
        }
        total = physicalTotal + virtualTotal;

        return buildListResponse(page, total, rawLimit, offset);
    }

    protected override getDefaultConfig() {
        return {};
    }
}
