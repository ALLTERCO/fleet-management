// Audit-write for report generation. One shape across every report kind.

import {
    authzAuditActor,
    authzAuditWriter
} from '../../modules/authz/audit/AuthzAuditWriter';
import {canCrossOrganizationBoundary} from '../../modules/authz/evaluator';
import {requireOrganizationId} from '../../rpc/scope';
import type CommandSender from '../CommandSender';

export async function writeReportGeneratedAudit(
    sender: CommandSender,
    input: {
        reportType: string;
        rows: number;
        meta: {file: string; size?: number | unknown};
        generateStart: number;
    }
): Promise<void> {
    await authzAuditWriter.writeReportGenerated({
        tenantId: canCrossOrganizationBoundary(sender)
            ? null
            : requireOrganizationId(sender),
        actorId: authzAuditActor(sender.getUser?.()),
        reportType: input.reportType,
        rows: input.rows,
        sizeBytes:
            typeof input.meta.size === 'number' ? input.meta.size : undefined,
        durationMs: Date.now() - input.generateStart,
        file: input.meta.file
    });
}
