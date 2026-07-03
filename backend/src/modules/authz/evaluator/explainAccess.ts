import type CommandSender from '../../../model/CommandSender';
import type {AuthzDecision} from '../contracts';
import {
    type AccessRoleSummary,
    emptyAccessRoleSummary,
    summarizeAccessProvenance
} from '../provenance';

export interface AccessExplanation {
    user?: {
        username?: string;
        userId?: string;
    };
    organizationId?: string;
    roles: readonly string[];
    hasCredentialBoundary: boolean;
    effectiveShape: ReturnType<CommandSender['getEffectiveShape']>;
    provenance: AccessRoleSummary;
    decision?: AuthzDecision;
    noAccessReason?: string;
}

export function explainAccess(
    sender: CommandSender | undefined,
    decision?: AuthzDecision
): AccessExplanation {
    if (!sender) {
        return {
            roles: [],
            hasCredentialBoundary: false,
            effectiveShape: null,
            provenance: emptyAccessRoleSummary(),
            decision,
            noAccessReason: 'No authenticated caller was available.'
        };
    }
    const noAccessReason = sender.hasNoPermissions()
        ? 'No effective permissions are assigned.'
        : undefined;
    return {
        user: sender.getUser(),
        organizationId: sender.getOrganizationId(),
        roles: sender.getRoles(),
        hasCredentialBoundary: sender.hasCredentialBoundary(),
        effectiveShape: sender.getEffectiveShape(),
        provenance: accessRoleSummary(sender),
        decision,
        ...(noAccessReason ? {noAccessReason} : {})
    };
}

function accessRoleSummary(sender: CommandSender): AccessRoleSummary {
    return summarizeAccessProvenance(
        sender.getRoles(),
        sender.getEffectiveAccessProvenance()
    );
}
