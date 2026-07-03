// Handlers for the three Energy.*LogicalMeter(s) RPCs. Each takes
// (params, deps) so the signature stays at two args — deps bundles the
// sender, the repository seam, and the kind lookup. Shape + cross-org
// reference validation lives in logicalMeterValidation so the rules have
// one home (reused by the wizard) and the user gets a clear RpcError
// instead of a raw constraint violation or a silent cross-org write.

import type {SaveLogicalMeterDbParams} from '../../modules/repositories/LogicalMeterRepository';
import RpcError from '../../rpc/RpcError';
import type {
    EnergyDeleteLogicalMeterParams,
    EnergyDeleteLogicalMeterResponse,
    EnergyListLogicalMetersParams,
    EnergyListLogicalMetersResponse,
    EnergyLogicalMeter,
    EnergySaveLogicalMeterParams,
    EnergySaveLogicalMeterResponse
} from '../../types/api/energy';
import {
    type DeviceAccessSender,
    senderCanAccessDevice
} from './deviceAccessFilter';
import {
    assertMeterReferences,
    assertMeterShape,
    assertNoParentCycle,
    pointKey
} from './logicalMeterValidation';

export interface LogicalMeterSender extends DeviceAccessSender {
    getOrganizationId(): string | undefined;
}

// Repo seam — production wiring lives in LogicalMeterRepository; tests
// pass a fake that records calls and returns canned meters.
export interface LogicalMeterRepoSeam {
    save: (params: SaveLogicalMeterDbParams) => Promise<number>;
    remove: (id: number, org: string) => Promise<boolean>;
    list: (
        org: string,
        groupId?: number,
        locationId?: number
    ) => Promise<EnergyLogicalMeter[]>;
}

export interface LogicalMeterHandlerDeps {
    sender: LogicalMeterSender;
    repo: LogicalMeterRepoSeam;
    // True when the kind is a built-in or owned by this org (loadKind seam).
    kindExists: (org: string, kindId: string) => Promise<boolean>;
    // True when the group/location id belongs to the caller's org.
    groupExists: (org: string, groupId: number) => Promise<boolean>;
    locationExists: (org: string, locationId: number) => Promise<boolean>;
}

export async function handleListLogicalMeters(
    params: EnergyListLogicalMetersParams,
    deps: LogicalMeterHandlerDeps
): Promise<EnergyListLogicalMetersResponse> {
    const org = requireOrg(deps.sender);
    const meters = await deps.repo.list(
        org,
        params.scope?.groupId,
        params.scope?.locationId
    );
    return {meters};
}

export async function handleSaveLogicalMeter(
    params: EnergySaveLogicalMeterParams,
    deps: LogicalMeterHandlerDeps
): Promise<EnergySaveLogicalMeterResponse> {
    const org = requireOrg(deps.sender);
    assertMeterShape(params);

    // Reference checks run against the caller's own org meters + device
    // access, so a crafted payload cannot point at another tenant.
    const orgMeters = await deps.repo.list(org);
    const orgMeterIds = new Set(orgMeters.map((m) => m.id));
    // Point -> owning meter, so a reassignment is caught before the insert.
    const pointOwners = new Map<string, number>();
    for (const m of orgMeters) {
        for (const p of m.points) pointOwners.set(pointKey(p), m.id);
    }
    await assertMeterReferences(params, {
        canAccessDevice: (deviceId) =>
            senderCanAccessDevice(deviceId, deps.sender),
        isOrgMeter: (meterId) => orgMeterIds.has(meterId),
        isOrgKind: (kindId) => deps.kindExists(org, kindId),
        isOrgGroup: (groupId) => deps.groupExists(org, groupId),
        isOrgLocation: (locationId) => deps.locationExists(org, locationId),
        pointOwner: (point) => pointOwners.get(pointKey(point)) ?? null
    });
    assertNoParentCycle(params.id, params.parentMeterId, (id) => {
        return orgMeters.find((m) => m.id === id)?.parentMeterId ?? null;
    });

    const id = await deps.repo.save(toDbParams(params, org));
    const meter = await findSavedMeter(deps.repo, org, id);
    return {meter};
}

export async function handleDeleteLogicalMeter(
    params: EnergyDeleteLogicalMeterParams,
    deps: LogicalMeterHandlerDeps
): Promise<EnergyDeleteLogicalMeterResponse> {
    const org = requireOrg(deps.sender);
    const deleted = await deps.repo.remove(params.id, org);
    return {deleted};
}

function requireOrg(sender: LogicalMeterSender): string {
    const org = sender.getOrganizationId();
    if (!org) throw RpcError.Unauthorized();
    return org;
}

function toDbParams(
    params: EnergySaveLogicalMeterParams,
    org: string
): SaveLogicalMeterDbParams {
    return {
        id: params.id ?? null,
        org,
        name: params.name,
        utilityType: params.utilityType,
        role: params.role,
        kindId: params.kindId ?? null,
        phaseMode: params.phaseMode ?? 'unknown',
        aggregationMode: params.aggregationMode,
        parentMeterId: params.parentMeterId ?? null,
        groupId: params.groupId ?? null,
        locationId: params.locationId ?? null,
        costCenter: params.costCenter ?? null,
        virtualFormula: params.virtualFormula ?? null,
        points: params.points ?? []
    };
}

async function findSavedMeter(
    repo: LogicalMeterRepoSeam,
    org: string,
    id: number
): Promise<EnergyLogicalMeter> {
    const meters = await repo.list(org);
    const meter = meters.find((m) => m.id === id);
    if (!meter) {
        throw RpcError.Server(
            `saved logical meter ${id} could not be reloaded`
        );
    }
    return meter;
}
