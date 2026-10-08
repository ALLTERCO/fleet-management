// Operator-managed local days that must not shape the learned normal.

import type {AuditLogEntry} from '../../modules/AuditLogger';
import type {
    BaselineExclusionChange,
    BaselineExclusionRow,
    SaveBaselineExclusionDbParams
} from '../../modules/repositories/BaselineExclusionRepository';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import {normalizeActor} from '../../types/api/auditActors';
import type {
    EnergyBaselineExclusion,
    EnergyDeleteBaselineExclusionParams,
    EnergyDeleteBaselineExclusionResponse,
    EnergyListBaselineExclusionsParams,
    EnergyListBaselineExclusionsResponse,
    EnergySaveBaselineExclusionParams,
    EnergySaveBaselineExclusionResponse
} from '../../types/api/energy';
import type CommandSender from '../CommandSender';

export interface BaselineExclusionRepoSeam {
    list(organizationId: string): Promise<BaselineExclusionRow[]>;
    save(
        params: SaveBaselineExclusionDbParams
    ): Promise<BaselineExclusionChange | null>;
    remove(
        id: number,
        organizationId: string
    ): Promise<BaselineExclusionRow | null>;
}

export interface BaselineExclusionHandlerDeps {
    sender: CommandSender;
    repo: BaselineExclusionRepoSeam;
    audit(entry: AuditLogEntry): void;
}

export async function handleListBaselineExclusions(
    _params: EnergyListBaselineExclusionsParams,
    deps: BaselineExclusionHandlerDeps
): Promise<EnergyListBaselineExclusionsResponse> {
    const rows = await deps.repo.list(requireOrganizationId(deps.sender));
    return {exclusions: rows.map(toApi)};
}

export async function handleSaveBaselineExclusion(
    params: EnergySaveBaselineExclusionParams,
    deps: BaselineExclusionHandlerDeps
): Promise<EnergySaveBaselineExclusionResponse> {
    const organizationId = requireOrganizationId(deps.sender);
    const username = normalizeActor(deps.sender.getUser()?.username);
    const reason = validatedReason(params.reason);
    assertRealLocalDay('fromDay', params.fromDay);
    assertRealLocalDay('toDay', params.toDay);
    if (params.toDay < params.fromDay) {
        throw RpcError.InvalidParams('toDay must not be before fromDay');
    }

    const change = await deps.repo.save({
        id: params.id ?? null,
        organizationId,
        fromDay: params.fromDay,
        toDay: params.toDay,
        reason,
        createdBy: username
    });
    if (!change) {
        throw RpcError.NotFound('baseline exclusion', params.id);
    }

    deps.audit(
        changeAuditEntry({
            method: 'energy.savebaselineexclusion',
            action: change.before ? 'update' : 'create',
            organizationId,
            username,
            before: change.before,
            after: change.after
        })
    );
    return {exclusion: toApi(change.after)};
}

export async function handleDeleteBaselineExclusion(
    params: EnergyDeleteBaselineExclusionParams,
    deps: BaselineExclusionHandlerDeps
): Promise<EnergyDeleteBaselineExclusionResponse> {
    const organizationId = requireOrganizationId(deps.sender);
    const username = normalizeActor(deps.sender.getUser()?.username);
    const removed = await deps.repo.remove(params.id, organizationId);
    if (!removed) {
        throw RpcError.NotFound('baseline exclusion', params.id);
    }

    deps.audit(
        changeAuditEntry({
            method: 'energy.deletebaselineexclusion',
            action: 'delete',
            organizationId,
            username,
            before: removed,
            after: null
        })
    );
    return {deleted: true, removed: toApi(removed)};
}

function assertRealLocalDay(label: string, day: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        throw RpcError.InvalidParams(`${label} must be YYYY-MM-DD`);
    }
    const parsed = new Date(`${day}T00:00:00.000Z`);
    if (
        Number.isNaN(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== day
    ) {
        throw RpcError.InvalidParams(`${label} must be a real calendar day`);
    }
}

function validatedReason(value: string): string {
    const reason = value.trim();
    if (reason.length === 0 || reason.length > 200) {
        throw RpcError.InvalidParams(
            'reason must contain between 1 and 200 characters'
        );
    }
    return reason;
}

function toApi(row: BaselineExclusionRow): EnergyBaselineExclusion {
    return {
        id: row.id,
        fromDay: row.from_day,
        toDay: row.to_day,
        reason: row.reason,
        createdBy: row.created_by,
        createdAt: row.created_at
    };
}

function auditedValue(row: BaselineExclusionRow | null): {
    id: number;
    fromDay: string;
    toDay: string;
    reason: string;
} | null {
    if (!row) return null;
    return {
        id: row.id,
        fromDay: row.from_day,
        toDay: row.to_day,
        reason: row.reason
    };
}

interface BaselineExclusionAuditChange {
    method: 'energy.savebaselineexclusion' | 'energy.deletebaselineexclusion';
    action: 'create' | 'update' | 'delete';
    organizationId: string;
    username: string;
    before: BaselineExclusionRow | null;
    after: BaselineExclusionRow | null;
}

function changeAuditEntry(change: BaselineExclusionAuditChange): AuditLogEntry {
    return {
        eventType: 'baseline_exclusion_change',
        username: change.username,
        organizationId: change.organizationId,
        method: change.method,
        params: {
            action: change.action,
            before: auditedValue(change.before),
            after: auditedValue(change.after)
        },
        success: true
    };
}
