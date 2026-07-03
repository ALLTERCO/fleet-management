// Shared boundary helpers for tenant-scoped, paginated read RPCs (audit log,
// device event journal, ...). One home so every such query validates its date
// range and resolves its org scope identically.

import {canCrossOrganizationBoundary} from '../../modules/authz/evaluator';
import RpcError from '../../rpc/RpcError';
import type CommandSender from '../CommandSender';

// Parse an optional ISO date param. Empty/absent yields undefined unless the
// caller marked it required; a non-date string fails loud.
export function parseDateParam(
    value: string | undefined,
    field: string,
    options?: {required?: boolean}
): Date | undefined {
    if (value == null || value === '') {
        if (options?.required) {
            throw RpcError.InvalidParams(`"${field}" is required`);
        }
        return undefined;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw RpcError.InvalidParams(`"${field}" must be a valid date`);
    }
    return date;
}

// Reject an inverted window so the SQL never runs an empty-by-mistake range.
export function assertOrderedRange(from?: Date, to?: Date): void {
    if (from && to && from.getTime() > to.getTime()) {
        throw RpcError.InvalidParams(
            '"from" must be earlier than or equal to "to"'
        );
    }
}

// Platform admins query every tenant (null). Everyone else is fail-closed to
// their own org — a missing org must not collapse to null, which the SQL reads
// as "all tenants".
export function tenantReadScope(sender: CommandSender): string | null {
    if (canCrossOrganizationBoundary(sender)) return null;
    const orgId = sender.getOrganizationId();
    if (!orgId) throw RpcError.Unauthorized();
    return orgId;
}
