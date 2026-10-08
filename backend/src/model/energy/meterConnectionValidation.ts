// Validation for a meter-connection save — one home for the rules, reused
// by the RPC handler. Two layers:
//   * assertConnectionShape — pure shape rules the DB also enforces (valid
//     node + direction vocabulary, no self-loop). Gives a clean RpcError
//     instead of a raw CHECK violation.
//   * assertConnectionReferences — the trust boundary: the meter the edge
//     points at must belong to the caller's org. The check is injected so
//     the handler wires it from the org meter list and tests pass fakes.

import RpcError from '../../rpc/RpcError';
import {
    type EnergyMeterConnection,
    type EnergySaveMeterConnectionParams,
    METER_CONNECTION_DIRECTIONS,
    METER_CONNECTION_NODES
} from '../../types/api/energy';
import {deriveBalancePosition} from './energyAxes';

const NODE_SET: ReadonlySet<string> = new Set(METER_CONNECTION_NODES);
const DIRECTION_SET: ReadonlySet<string> = new Set(METER_CONNECTION_DIRECTIONS);

export function assertConnectionShape(
    params: EnergySaveMeterConnectionParams
): void {
    assertMeterPresent(params);
    assertNode('fromNode', params.fromNode);
    assertNode('toNode', params.toNode);
    assertDistinctNodes(params);
    assertDirection(params);
}

export interface ConnectionReferenceChecks {
    isOrgMeter: (meterId: number) => boolean;
}

export function assertConnectionReferences(
    params: EnergySaveMeterConnectionParams,
    checks: ConnectionReferenceChecks
): void {
    if (!checks.isOrgMeter(params.meterId)) {
        throw RpcError.InvalidParams(
            `meterId ${params.meterId} is not a meter in your organization`
        );
    }
}

export function assertConnectionBalanceConsistent(
    params: EnergySaveMeterConnectionParams,
    existing: readonly EnergyMeterConnection[]
): void {
    const candidate: EnergyMeterConnection = {
        id: params.id ?? -1,
        meterId: params.meterId,
        fromNode: params.fromNode,
        toNode: params.toNode,
        positiveDirection: params.positiveDirection ?? 'from_to'
    };
    const meterEdges = existing.filter(
        (edge) => edge.meterId === params.meterId && edge.id !== params.id
    );
    try {
        deriveBalancePosition([...meterEdges, candidate]);
    } catch {
        throw RpcError.InvalidParams(
            'one logical meter cannot span both input and output sides of a transformation'
        );
    }
}

function assertMeterPresent(params: EnergySaveMeterConnectionParams): void {
    if (params.meterId === undefined || params.meterId === null) {
        throw RpcError.InvalidParams('meterId is required');
    }
}

function assertNode(field: string, value: string): void {
    if (!NODE_SET.has(value)) {
        throw RpcError.InvalidParams(`${field} '${value}' is not a valid node`);
    }
}

function assertDistinctNodes(params: EnergySaveMeterConnectionParams): void {
    if (params.fromNode === params.toNode) {
        throw RpcError.InvalidParams('fromNode and toNode must differ');
    }
}

function assertDirection(params: EnergySaveMeterConnectionParams): void {
    const dir = params.positiveDirection;
    if (dir !== undefined && !DIRECTION_SET.has(dir)) {
        throw RpcError.InvalidParams(`positiveDirection '${dir}' is not valid`);
    }
}
