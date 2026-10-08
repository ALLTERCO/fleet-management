// Validation for a logical-meter save — one home for the rules, reused by
// the RPC handler and device Energy assignment. Two layers:
//   * assertMeterShape — pure shape rules the DB also enforces (utility-
//     scoped role, formula/points exclusivity, no self-parent).
//   * assertMeterReferences — the trust boundary: every id a meter points at
//     (device, parent meter, formula meter, kind) must belong to the caller's
//     org / be accessible. Checks are injected so callers wire them from the
//     sender + repositories and tests pass fakes.

import {commodityForTag, type EnergyTag} from '../../modules/energyClassifier';
import RpcError from '../../rpc/RpcError';
import {
    type EnergyLogicalMeterPoint,
    type EnergySaveLogicalMeterParams,
    meterTagsForUtility,
    rolesForUtility
} from '../../types/api/energy';
import {currentTypeForLegacySource} from './energyAxes';
import {meterMetric} from './meterGrouping';
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
    assertUtilityMatchesPoints(params);
    assertEnergySourceMatchesUtility(params);
    assertCurrentTypeMatchesLegacyDomain(params);
    assertFormulaPointsExclusive(params);
    assertNotOwnParent(params);
}

function assertEnergySourceMatchesUtility(
    params: EnergySaveLogicalMeterParams
): void {
    if (params.energySource == null || params.utilityType === 'electric')
        return;
    throw RpcError.InvalidParams(
        `energySource is only valid for an electric logical meter; ` +
            `'${params.utilityType}' describes the flowing commodity itself`
    );
}

export interface MeterReferenceChecks {
    canAccessDevice: (deviceId: number) => Promise<boolean>;
    isOrgMeter: (meterId: number) => boolean;
    isOrgKind: (kindId: string) => Promise<boolean>;
    isOrgEnergySource: (sourceId: string) => Promise<boolean>;
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
    await assertEnergySourceInOrg(params, checks);
    await assertGroupInOrg(params, checks);
    await assertLocationInOrg(params, checks);
}

function assertCurrentTypeMatchesLegacyDomain(
    params: EnergySaveLogicalMeterParams
): void {
    for (const point of params.points ?? []) {
        if (point.currentType == null) continue;
        const derived = currentTypeForLegacySource(point.electricalDomain);
        if (derived === point.currentType) continue;
        const label = point.componentKey ?? `channel ${point.channel ?? 0}`;
        if (derived === null) {
            throw RpcError.InvalidParams(
                `${label} on device ${point.deviceId} cannot declare ` +
                    `currentType '${point.currentType}' for legacy ` +
                    `electricalDomain '${point.electricalDomain}'`
            );
        }
        throw RpcError.InvalidParams(
            `${label} on device ${point.deviceId} declares currentType ` +
                `'${point.currentType}' but legacy electricalDomain ` +
                `'${point.electricalDomain}' means '${derived}'`
        );
    }
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

// utilityType decides which tags the meter may fold (meterGrouping.meterMetric).
// Choosing one its points cannot supply used to be silent: the meter simply
// never matched a tag and dropped out of every grouping, and where the tag was
// a volume it was counted as electricity instead. Say so at the save.
function assertUtilityMatchesPoints(
    params: EnergySaveLogicalMeterParams
): void {
    const allowedTags = meterTagsForUtility(params.utilityType);
    const utility = utilityCommodity(params.utilityType);
    if (utility === null) return;
    const gasDirections = new Set<'import' | 'export'>();
    for (const point of params.points ?? []) {
        const label = point.componentKey ?? `channel ${point.channel ?? 0}`;
        if (!allowedTags.includes(point.tag)) {
            throw RpcError.InvalidParams(
                `${label} on device ${point.deviceId} reports tag '${point.tag}', ` +
                    `which cannot back a '${params.utilityType}' logical meter`
            );
        }
        if (
            (point.tag === 'volume_m3' ||
                point.tag === 'volume_returned_m3' ||
                point.tag === 'volume_l') &&
            ((params.utilityType === 'gas' &&
                point.electricalDomain !== 'gas') ||
                (params.utilityType === 'water' &&
                    point.electricalDomain === 'gas'))
        ) {
            throw RpcError.InvalidParams(
                `${label} on device ${point.deviceId} is classified as ` +
                    `'${point.electricalDomain ?? 'unclassified'}', not '${params.utilityType}'`
            );
        }
        if (params.utilityType === 'gas') {
            const expectedDirection =
                point.tag === 'volume_returned_m3' ? 'export' : 'import';
            gasDirections.add(expectedDirection);
            if (
                point.directionHint != null &&
                point.directionHint !== expectedDirection
            ) {
                throw RpcError.InvalidParams(
                    `${label} on device ${point.deviceId} measures gas ${expectedDirection}, ` +
                        `but directionHint is '${point.directionHint}'`
                );
            }
            if (
                point.tag === 'volume_returned_m3' &&
                point.directionHint !== 'export'
            ) {
                throw RpcError.InvalidParams(
                    `${label} on device ${point.deviceId} is returned gas and requires ` +
                        "directionHint 'export'"
                );
            }
        }
        const implied = commodityForTag(point.tag);
        if (implied === null || implied === utility) continue;
        // Volume cannot tell water from gas, so either reading is acceptable.
        if (isVolumeCommodityPair(implied, utility)) continue;
        throw RpcError.InvalidParams(
            `${label} on device ${point.deviceId} measures ${implied}, ` +
                `which a '${params.utilityType}' meter cannot count`
        );
    }
    if (gasDirections.size > 1) {
        throw RpcError.InvalidParams(
            'one gas logical meter cannot mix consumed volume_m3/volume_l with ' +
                'returned volume_returned_m3; save separate import and injection meters'
        );
    }
}

// Derived from meterMetric, which already owns which tags a utility folds, so
// there is no second utility->commodity table to drift.
function utilityCommodity(utilityType: string): string | null {
    const [primaryTag] = meterMetric(utilityType).tags;
    return primaryTag ? commodityForTag(primaryTag as EnergyTag) : null;
}

// Volume cannot tell water from gas, so meterMetric answers both with a volume
// tag and commodityForTag resolves both to water. Treat them as one.
function isVolumeCommodityPair(a: string, b: string): boolean {
    return (a === 'water' || a === 'gas') && (b === 'water' || b === 'gas');
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

async function assertEnergySourceInOrg(
    params: EnergySaveLogicalMeterParams,
    checks: MeterReferenceChecks
): Promise<void> {
    if (params.energySource == null) return;
    if (!(await checks.isOrgEnergySource(params.energySource))) {
        throw RpcError.InvalidParams(
            `energySource '${params.energySource}' is not available to your organization`
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
