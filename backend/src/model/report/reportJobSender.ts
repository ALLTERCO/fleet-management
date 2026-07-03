import CommandSender from '../CommandSender';
import type {ReportJobSenderSnapshot} from '../energy/reportExportPayload';

export function snapshotReportSender(
    sender: CommandSender
): ReportJobSenderSnapshot {
    return {
        permissions: [...sender.getPermissions()],
        roles: [...sender.getRoles()],
        username: sender.getUser()?.username,
        organizationId: sender.getOrganizationId(),
        tenantPinned: sender.isTenantPinned(),
        userId: sender.getUserId(),
        isPlatformAdmin: sender.isPlatformAdmin(),
        trusted: sender.isTrusted(),
        mfaPresent: sender.isMfaPresent(),
        sourceIp: sender.getSourceIp(),
        credentialBoundary: sender.getCredentialBoundary()
    };
}

export function restoreReportSender(
    snapshot: ReportJobSenderSnapshot
): CommandSender {
    return new CommandSender(snapshot);
}
