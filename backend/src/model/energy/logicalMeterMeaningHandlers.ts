import type {LogicalMeterMeaningRepository} from '../../modules/repositories/LogicalMeterMeaningRepository';
import RpcError from '../../rpc/RpcError';
import type {
    EnergyApplyLogicalMeterMeaningChangeParams,
    EnergyApplyLogicalMeterMeaningChangeResponse,
    EnergyListLogicalMeterMeaningHistoryParams,
    EnergyListLogicalMeterMeaningHistoryResponse,
    EnergyListLogicalMeterMeaningReviewQueueParams,
    EnergyListLogicalMeterMeaningReviewQueueResponse,
    EnergyLogicalMeter,
    EnergyPreviewLogicalMeterMeaningChangeParams,
    EnergyPreviewLogicalMeterMeaningChangeResponse
} from '../../types/api/energy';
import {rolesForUtility} from '../../types/api/energy';

const DEFAULT_PAGE_SIZE = 50;
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

export interface LogicalMeterMeaningSender {
    getOrganizationId(): string | undefined;
    getUserId?(): string | undefined;
}

export interface LogicalMeterMeaningHandlerDeps {
    sender: LogicalMeterMeaningSender;
    repo: LogicalMeterMeaningRepository;
    meterForId: (
        organizationId: string,
        meterId: number
    ) => Promise<EnergyLogicalMeter | null>;
    kindExists: (organizationId: string, kindId: string) => Promise<boolean>;
    listMeters: (organizationId: string) => Promise<EnergyLogicalMeter[]>;
    canAccessDevice: (
        deviceId: number,
        operation: 'read' | 'update'
    ) => Promise<boolean>;
    now?: () => Date;
}

export async function handleListLogicalMeterMeaningReviewQueue(
    params: EnergyListLogicalMeterMeaningReviewQueueParams,
    deps: LogicalMeterMeaningHandlerDeps
): Promise<EnergyListLogicalMeterMeaningReviewQueueResponse> {
    const organizationId = requireOrganization(deps.sender);
    const meters = await deps.listMeters(organizationId);
    const allowed = await accessibleMeterIds(meters, 'read', deps);
    if (allowed.size === 0) return {items: [], nextCursor: null};
    return deps.repo.listReviewQueue(organizationId, params, [...allowed]);
}

export async function handleListLogicalMeterMeaningHistory(
    params: EnergyListLogicalMeterMeaningHistoryParams,
    deps: LogicalMeterMeaningHandlerDeps
): Promise<EnergyListLogicalMeterMeaningHistoryResponse> {
    const organizationId = requireOrganization(deps.sender);
    await requireAccessibleMeter(organizationId, params.meterId, 'read', deps);
    return deps.repo.listHistory(
        organizationId,
        params.meterId,
        params.limit ?? DEFAULT_PAGE_SIZE,
        params.beforeRevision
    );
}

export async function handlePreviewLogicalMeterMeaningChange(
    params: EnergyPreviewLogicalMeterMeaningChangeParams,
    deps: LogicalMeterMeaningHandlerDeps
): Promise<EnergyPreviewLogicalMeterMeaningChangeResponse> {
    const organizationId = requireOrganization(deps.sender);
    const meter = await requireAccessibleMeter(
        organizationId,
        params.meterId,
        'update',
        deps
    );
    validateEffectiveFrom(params.effectiveFrom, deps.now?.() ?? new Date());
    validateSourceReference(params.sourceReference);
    validateRole(meter, params);
    const kindAvailable =
        params.kindId == null ||
        (await deps.kindExists(organizationId, params.kindId));
    const current = await deps.repo.getAt(
        organizationId,
        params.meterId,
        params.effectiveFrom
    );
    if (!current) {
        throw validationError(
            'effectiveFrom does not fall inside this meter history',
            'effectiveFrom'
        );
    }
    const latest = (
        await deps.repo.listHistory(organizationId, params.meterId, 1)
    ).versions[0];
    if (!latest) {
        throw RpcError.Server('logical meter has no meaning history');
    }
    const ineligibilityReasons = meaningIneligibilityReasons({
        params,
        current,
        latestRevision: latest.revision,
        kindAvailable
    });
    const proposed = {
        meterId: params.meterId,
        revision: latest.revision + 1,
        effectiveFrom: params.effectiveFrom,
        effectiveTo: current.effectiveTo,
        role: params.role,
        kindId: params.kindId
    };
    const affected = await deps.repo.impact(
        organizationId,
        params.meterId,
        params.effectiveFrom,
        current.effectiveTo
    );
    return deps.repo.savePreview(
        organizationId,
        params,
        {
            current,
            proposed,
            affected: affected.impact,
            impactFingerprint: affected.fingerprint,
            eligible: ineligibilityReasons.length === 0,
            ineligibilityReasons
        },
        deps.sender.getUserId?.() ?? null
    );
}

export async function handleApplyLogicalMeterMeaningChange(
    params: EnergyApplyLogicalMeterMeaningChangeParams,
    deps: LogicalMeterMeaningHandlerDeps
): Promise<EnergyApplyLogicalMeterMeaningChangeResponse> {
    const organizationId = requireOrganization(deps.sender);
    await requireAccessibleMeter(
        organizationId,
        params.meterId,
        'update',
        deps
    );
    const window = await deps.repo.previewImpactWindow(
        organizationId,
        params.previewId,
        params.meterId
    );
    if (!window) {
        throw validationError('meaning preview not found', 'previewId');
    }
    const affected = await deps.repo.impact(
        organizationId,
        params.meterId,
        window.from,
        window.to
    );
    return deps.repo.apply(
        organizationId,
        params,
        affected,
        deps.sender.getUserId?.() ?? null
    );
}

function meaningIneligibilityReasons(input: {
    params: EnergyPreviewLogicalMeterMeaningChangeParams;
    current: EnergyPreviewLogicalMeterMeaningChangeResponse['current'];
    latestRevision: number;
    kindAvailable: boolean;
}): EnergyPreviewLogicalMeterMeaningChangeResponse['ineligibilityReasons'] {
    const reasons: EnergyPreviewLogicalMeterMeaningChangeResponse['ineligibilityReasons'] =
        [];
    if (input.params.expectedRevision !== input.latestRevision) {
        reasons.push('revision_changed');
    }
    if (
        input.params.role === input.current.role &&
        input.params.kindId === input.current.kindId
    ) {
        reasons.push('meaning_unchanged');
    }
    if (input.params.effectiveFrom === input.current.effectiveFrom) {
        reasons.push('effective_from_on_existing_boundary');
    }
    if (!input.kindAvailable) reasons.push('kind_not_available');
    return reasons;
}

function validateEffectiveFrom(value: string, now: Date): void {
    if (!value.endsWith('Z')) {
        throw validationError(
            'effectiveFrom must be an explicit UTC instant ending in Z',
            'effectiveFrom'
        );
    }
    const instant = new Date(value);
    if (!Number.isFinite(instant.getTime())) {
        throw validationError('effectiveFrom is invalid', 'effectiveFrom');
    }
    if (instant.getTime() > now.getTime()) {
        throw validationError(
            'effectiveFrom cannot be in the future',
            'effectiveFrom'
        );
    }
    if (instant.getTime() % FIFTEEN_MINUTES_MS !== 0) {
        throw validationError(
            'effectiveFrom must align to a 15-minute report bucket',
            'effectiveFrom'
        );
    }
}

function validateRole(
    meter: EnergyLogicalMeter,
    params: EnergyPreviewLogicalMeterMeaningChangeParams
): void {
    if (!rolesForUtility(meter.utilityType).includes(params.role)) {
        throw validationError(
            `role '${params.role}' is not valid for ${meter.utilityType}`,
            'role'
        );
    }
}

function validateSourceReference(value: string): void {
    if (value.trim() !== value || value.length === 0) {
        throw validationError(
            'sourceReference must be non-empty and trimmed',
            'sourceReference'
        );
    }
}

async function requireMeter(
    organizationId: string,
    meterId: number,
    deps: LogicalMeterMeaningHandlerDeps
): Promise<EnergyLogicalMeter> {
    const meter = await deps.meterForId(organizationId, meterId);
    if (!meter) throw validationError('logical meter not found', 'meterId');
    return meter;
}

async function requireAccessibleMeter(
    organizationId: string,
    meterId: number,
    operation: 'read' | 'update',
    deps: LogicalMeterMeaningHandlerDeps
): Promise<EnergyLogicalMeter> {
    const meter = await requireMeter(organizationId, meterId, deps);
    const meters = await deps.listMeters(organizationId);
    const allowed = await accessibleMeterIds(meters, operation, deps);
    if (!allowed.has(meterId)) throw RpcError.Unauthorized();
    return meter;
}

async function accessibleMeterIds(
    meters: readonly EnergyLogicalMeter[],
    operation: 'read' | 'update',
    deps: LogicalMeterMeaningHandlerDeps
): Promise<Set<number>> {
    const byId = new Map(meters.map((meter) => [meter.id, meter]));
    const deviceIds = new Set(
        meters.flatMap((meter) => meter.points.map((point) => point.deviceId))
    );
    const accessibleDevices = new Set<number>();
    await Promise.all(
        [...deviceIds].map(async (deviceId) => {
            if (await deps.canAccessDevice(deviceId, operation)) {
                accessibleDevices.add(deviceId);
            }
        })
    );
    const memo = new Map<number, boolean>();
    const visiting = new Set<number>();
    const canAccessMeter = (meterId: number): boolean => {
        const cached = memo.get(meterId);
        if (cached !== undefined) return cached;
        if (visiting.has(meterId)) return false;
        const meter = byId.get(meterId);
        if (!meter) return false;
        visiting.add(meterId);
        const allowed =
            meter.aggregationMode === 'formula'
                ? Boolean(
                      meter.virtualFormula?.terms.length &&
                          meter.virtualFormula.terms.every((term) =>
                              canAccessMeter(term.meterId)
                          )
                  )
                : meter.points.length > 0 &&
                  meter.points.every((point) =>
                      accessibleDevices.has(point.deviceId)
                  );
        visiting.delete(meterId);
        memo.set(meterId, allowed);
        return allowed;
    };
    return new Set(
        meters
            .filter((meter) => canAccessMeter(meter.id))
            .map((meter) => meter.id)
    );
}

function requireOrganization(sender: LogicalMeterMeaningSender): string {
    const organizationId = sender.getOrganizationId();
    if (!organizationId) throw RpcError.Unauthorized();
    return organizationId;
}

function validationError(message: string, field: string): RpcError {
    return RpcError.Domain('ValidationFailed', {message, field});
}
