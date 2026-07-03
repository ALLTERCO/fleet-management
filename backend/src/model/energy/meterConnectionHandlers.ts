// Handlers for the three Energy.*MeterConnection(s) RPCs. Each takes
// (params, deps) so the signature stays at two args — deps bundles the
// sender and the repository seam. Shape + cross-org reference validation
// lives in meterConnectionValidation so the rules have one home and the
// user gets a clear RpcError instead of a raw constraint violation or a
// silent cross-org write.

import type {SaveMeterConnectionDbParams} from '../../modules/repositories/MeterConnectionRepository';
import RpcError from '../../rpc/RpcError';
import type {
    EnergyDeleteMeterConnectionParams,
    EnergyDeleteMeterConnectionResponse,
    EnergyListMeterConnectionsParams,
    EnergyListMeterConnectionsResponse,
    EnergyMeterConnection,
    EnergySaveMeterConnectionParams,
    EnergySaveMeterConnectionResponse
} from '../../types/api/energy';
import {
    assertConnectionReferences,
    assertConnectionShape
} from './meterConnectionValidation';

export interface MeterConnectionSender {
    getOrganizationId(): string | undefined;
}

// Repo seam — production wiring lives in MeterConnectionRepository; tests
// pass a fake that records calls and returns canned connections. The org
// meter list backs the cross-org meterId check.
export interface MeterConnectionRepoSeam {
    save: (params: SaveMeterConnectionDbParams) => Promise<number>;
    remove: (id: number, org: string) => Promise<boolean>;
    list: (org: string) => Promise<EnergyMeterConnection[]>;
}

export interface MeterConnectionHandlerDeps {
    sender: MeterConnectionSender;
    repo: MeterConnectionRepoSeam;
    // Ids of the logical meters in the caller's org — the meterId an edge
    // references must be one of these.
    listOrgMeterIds: (org: string) => Promise<number[]>;
}

export async function handleListMeterConnections(
    _params: EnergyListMeterConnectionsParams,
    deps: MeterConnectionHandlerDeps
): Promise<EnergyListMeterConnectionsResponse> {
    const org = requireOrg(deps.sender);
    const connections = await deps.repo.list(org);
    return {connections};
}

export async function handleSaveMeterConnection(
    params: EnergySaveMeterConnectionParams,
    deps: MeterConnectionHandlerDeps
): Promise<EnergySaveMeterConnectionResponse> {
    const org = requireOrg(deps.sender);
    assertConnectionShape(params);

    const orgMeterIds = new Set(await deps.listOrgMeterIds(org));
    assertConnectionReferences(params, {
        isOrgMeter: (meterId) => orgMeterIds.has(meterId)
    });

    const id = await deps.repo.save(toDbParams(params, org));
    const connection = await findSavedConnection(deps.repo, org, id);
    return {connection};
}

export async function handleDeleteMeterConnection(
    params: EnergyDeleteMeterConnectionParams,
    deps: MeterConnectionHandlerDeps
): Promise<EnergyDeleteMeterConnectionResponse> {
    const org = requireOrg(deps.sender);
    const deleted = await deps.repo.remove(params.id, org);
    return {deleted};
}

function requireOrg(sender: MeterConnectionSender): string {
    const org = sender.getOrganizationId();
    if (!org) throw RpcError.Unauthorized();
    return org;
}

function toDbParams(
    params: EnergySaveMeterConnectionParams,
    org: string
): SaveMeterConnectionDbParams {
    return {
        id: params.id ?? null,
        org,
        meterId: params.meterId,
        fromNode: params.fromNode,
        toNode: params.toNode,
        positiveDirection: params.positiveDirection ?? 'from_to'
    };
}

async function findSavedConnection(
    repo: MeterConnectionRepoSeam,
    org: string,
    id: number
): Promise<EnergyMeterConnection> {
    const connections = await repo.list(org);
    const connection = connections.find((c) => c.id === id);
    if (!connection) {
        throw RpcError.Server(
            `saved meter connection ${id} could not be reloaded`
        );
    }
    return connection;
}
