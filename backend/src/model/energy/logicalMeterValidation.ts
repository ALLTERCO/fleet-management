// Validation for a logical-meter save — one home for the rules, reused by
// the RPC handler and device Energy assignment. Two layers:
//   * assertMeterShape — pure shape rules the DB also enforces (utility-
//     scoped role, formula/points exclusivity, no self-parent).
//   * assertMeterReferences — the trust boundary: every id a meter points at
//     (device, parent meter, formula meter, kind) must belong to the caller's
//     org / be accessible. Checks are injected so callers wire them from the
//     sender + repositories and tests pass fakes.

import RpcError from '../../rpc/RpcError';
import {
    type EnergyLogicalMeterPoint,
    type EnergySaveLogicalMeterParams,
    rolesForUtility
} from '../../types/api/energy';
import {meterPointKey} from './meterOwnership';

// The grain a meter owns: (device, channel, tag) — the shared ownership key.
// Phase and componentKey are dropped on purpose: channel energy is phase-summed
// and the query can't tell components on one channel apart, so a finer key here
// would let UI offer points the save and query cannot distinguish.
export function pointKey(p: EnergyLogicalMeterPoint): string {
    return meterPointKey(p.deviceId, p.channel ?? 0, p.tag);
}

export function assertMeterShape(params: EnergySaveLogicalMeterParams): void {
    assertRoleMatchesUtility(params);
    assertFormulaPointsExclusive(params);
    assertNotOwnParent(params);
}

export interface MeterReferenceChecks {
    canAccessDevice: (deviceId: number) => Promise<boolean>;
    isOrgMeter: (meterId: number) => boolean;
    isOrgKind: (kindId: string) => Promise<boolean>;
    isOrgGroup: (groupId: number) => Promise<boolean>;
    isOrgLocation: (locationId: number) => Promise<boolean>;
    // Id of another org meter already holding this exact point, or null.
    pointOwner: (point: EnergyLogicalMeterPoint) => number | null;
}

export async function assertMeterReferences(
    params: EnergySaveLogicalMeterParams,
    checks: MeterReferenceChecks
): Promise<void> {
    await assertPointsAccessible(params, checks);
    assertPointsUnowned(params, checks);
    assertParentInOrg(params, checks);
    assertFormulaMetersInOrg(params, checks);
    await assertKindInOrg(params, checks);
    await assertGroupInOrg(params, checks);
    await assertLocationInOrg(params, checks);
}

// A point belongs to one meter; reassigning it is a clean error, not raw 23505.
function assertPointsUnowned(
    params: EnergySaveLogicalMeterParams,
    checks: MeterReferenceChecks
): void {
    for (const point of params.points ?? []) {
        const owner = checks.pointOwner(point);
        if (owner !== null && owner !== params.id) {
            const label = point.componentKey ?? `channel ${point.channel ?? 0}`;
            throw RpcError.InvalidParams(
                `${label} on device ${point.deviceId} already ` +
                    `belongs to meter ${owner}; remove it there first`
            );
        }
    }
}

function assertRoleMatchesUtility(params: EnergySaveLogicalMeterParams): void {
    const valid = rolesForUtility(params.utilityType);
    if (!valid.includes(params.role)) {
        throw RpcError.InvalidParams(
            `role '${params.role}' is not valid for utilityType '${params.utilityType}'`
        );
    }
}

function assertFormulaPointsExclusive(
    params: EnergySaveLogicalMeterParams
): void {
    const isFormula = params.aggregationMode === 'formula';
    const hasPoints = (params.points?.length ?? 0) > 0;
    if (isFormula) {
        if (!params.virtualFormula) {
            throw RpcError.InvalidParams(
                'aggregationMode=formula requires a virtualFormula'
            );
        }
        if (hasPoints) {
            throw RpcError.InvalidParams(
                'a virtual (formula) meter cannot also carry points'
            );
        }
        return;
    }
    if (params.virtualFormula) {
        throw RpcError.InvalidParams(
            'virtualFormula is only allowed when aggregationMode=formula'
        );
    }
    if (!hasPoints) {
        throw RpcError.InvalidParams(
            'a physical meter needs at least one point'
        );
    }
}

function assertNotOwnParent(params: EnergySaveLogicalMeterParams): void {
    if (
        params.id !== undefined &&
        params.parentMeterId !== undefined &&
        params.parentMeterId !== null &&
        params.parentMeterId === params.id
    ) {
        throw RpcError.InvalidParams('a meter cannot be its own parent');
    }
}

// Walk the parent chain from the proposed parent. If it returns to this meter
// (A→B→A) it would loop report aggregation; `seen` also terminates on any
// pre-existing cycle in the data. assertNotOwnParent covers the 1-hop case.
export function assertNoParentCycle(
    meterId: number | undefined,
    parentMeterId: number | null | undefined,
    parentOf: (id: number) => number | null
): void {
    if (meterId === undefined || parentMeterId == null) return;
    const seen = new Set<number>([meterId]);
    let cursor: number | null = parentMeterId;
    while (cursor != null) {
        if (seen.has(cursor)) {
            throw RpcError.InvalidParams(
                `parentMeterId ${parentMeterId} would create a meter cycle`
            );
        }
        seen.add(cursor);
        cursor = parentOf(cursor);
    }
}

async function assertPointsAccessible(
    params: EnergySaveLogicalMeterParams,
    checks: MeterReferenceChecks
): Promise<void> {
    for (const point of params.points ?? []) {
        if (!(await checks.canAccessDevice(point.deviceId))) {
            throw RpcError.Domain('PermissionDenied');
        }
    }
}

function assertParentInOrg(
    params: EnergySaveLogicalMeterParams,
    checks: MeterReferenceChecks
): void {
    if (params.parentMeterId == null) return;
    if (!checks.isOrgMeter(params.parentMeterId)) {
        throw RpcError.InvalidParams(
            `parentMeterId ${params.parentMeterId} is not a meter in your organization`
        );
    }
}

function assertFormulaMetersInOrg(
    params: EnergySaveLogicalMeterParams,
    checks: MeterReferenceChecks
): void {
    if (!params.virtualFormula) return;
    for (const term of params.virtualFormula.terms) {
        if (!checks.isOrgMeter(term.meterId)) {
            throw RpcError.InvalidParams(
                `virtualFormula references meter ${term.meterId} not in your organization`
            );
        }
    }
}

async function assertKindInOrg(
    params: EnergySaveLogicalMeterParams,
    checks: MeterReferenceChecks
): Promise<void> {
    if (params.kindId == null) return;
    if (!(await checks.isOrgKind(params.kindId))) {
        throw RpcError.InvalidParams(
            `kindId '${params.kindId}' is not available to your organization`
        );
    }
}

async function assertGroupInOrg(
    params: EnergySaveLogicalMeterParams,
    checks: MeterReferenceChecks
): Promise<void> {
    if (params.groupId == null) return;
    if (!(await checks.isOrgGroup(params.groupId))) {
        throw RpcError.InvalidParams(
            `groupId ${params.groupId} is not a group in your organization`
        );
    }
}

async function assertLocationInOrg(
    params: EnergySaveLogicalMeterParams,
    checks: MeterReferenceChecks
): Promise<void> {
    if (params.locationId == null) return;
    if (!(await checks.isOrgLocation(params.locationId))) {
        throw RpcError.InvalidParams(
            `locationId ${params.locationId} is not a location in your organization`
        );
    }
}
