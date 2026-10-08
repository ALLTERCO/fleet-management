// Shared authz policies for organization-level administration.

import {
    canCrossOrganizationBoundary,
    canPerformComponent,
    canPerformComponentOperationAsync,
    canUsePlatformAdmin as canUsePlatformAdminAuthority,
    isComponentPermissionAllowed
} from '../../modules/authz/evaluator';
import {automationAccessAllowed} from '../../modules/nodeRed/access';
import {nodeRedOrgAllows} from '../../modules/nodeRed/orgLock';
import {
    type default as CommandSender,
    statementDeniesAction,
    statementGrantsAction
} from '../CommandSender';

export function canManageAuthz(sender: CommandSender): boolean {
    return canManageOrganizationSettings(sender);
}

export function canViewAuthz(sender: CommandSender): boolean {
    return canManageOrganizationSettings(sender);
}

// Audit-log read: organization manager, or any grant that carries the
// auditor persona's authz_audit:read action (Zitadel role or FM assignment).
// A plain reader (viewer) sees the fleet, not who changed it.
export function canViewAuditLog(sender: CommandSender): boolean {
    return (
        canManageOrganizationSettings(sender) ||
        sender.allowsAction('authz_audit:read', 'authz_audit')
    );
}

// Read access to the access matrix (personas, assignments, groups,
// administrator list). Excludes secrets-bearing reads which use canViewAuthz.
export function canReadPolicies(sender: CommandSender): boolean {
    return canReadOrganizationSettings(sender);
}

export function canViewSharedMediaAssets(sender: CommandSender): boolean {
    return sender.getUser() !== undefined;
}

export function canManageSharedMediaAssets(sender: CommandSender): boolean {
    return canManageOrganizationSettings(sender);
}

export function canUsePlatformAdmin(sender: CommandSender): boolean {
    return canUsePlatformAdminAuthority(sender);
}

export function canCrossOrganizationSupport(sender: CommandSender): boolean {
    return canCrossOrganizationBoundary(sender);
}

/**
 * Self-or-admin check for routes like User.GetEffectivePermissions.
 * Admins see anyone; users see only their own resolved permissions.
 * Match by username (CommandSender doesn't expose Zitadel sub).
 */
export function canViewOwnOrAdmin(
    sender: CommandSender,
    targetUsername: string
): boolean {
    if (canReadOrganizationSettings(sender)) return true;
    return sender.getUser()?.username === targetUsername;
}

/**
 * Node-RED automations. The same test that opens the editor in a browser, so
 * one room keeps one lock: an automation runs unattended and switches real
 * circuits, and a flow can hold a webhook URL, a token or a site layout, which
 * is why reading is not loosened relative to writing.
 *
 * The rule itself lives in modules/nodeRed/access.ts, shared with the browser
 * proxy. This is the authz-owned adapter that turns a CommandSender into the
 * facts the rule needs, so no component reaches for a raw authority primitive
 * of its own.
 */
export function canManageAutomations(sender: CommandSender): boolean {
    const boundary = sender.getCredentialBoundary();
    const statements = boundary
        ? (sender.getEffectiveShape()?.statements ?? [])
        : [];
    const query = {action: 'automation:update', resourceType: 'automation'};
    // The exported shape already evaluates session MFA and IP conditions.
    const context = {mfaPresent: false};
    const scopedGrant =
        statements.some(
            (statement) =>
                statement.scope.all === true &&
                statementGrantsAction(statement, query, context)
        ) &&
        !statements.some((statement) =>
            statementDeniesAction(statement, query, context)
        );
    return automationAccessAllowed({
        authenticated: sender.getUser() !== undefined,
        hasCredentialBoundary: sender.getCredentialBoundary() !== undefined,
        credentialCoversTenant: sender.getCredentialBoundary()?.all === true,
        isAdmin:
            sender.hasFullTenantAuthority() ||
            canUsePlatformAdminAuthority(sender),
        permissions: sender.getPermissions(),
        policyAllows: boundary
            ? scopedGrant
            : sender.allowsAction('automation:update', 'automation')
    });
}

/** May manage automations here: the rule above plus the Node-RED org lock. */
export function canManageThisNodeRed(sender: CommandSender): boolean {
    return (
        nodeRedOrgAllows(sender.getOrganizationId()) &&
        canManageAutomations(sender)
    );
}

export async function canAuthorDeviceScopedAutomation(
    sender: CommandSender,
    deviceIds: readonly string[]
): Promise<boolean> {
    const query = {action: 'automation:update', resourceType: 'automation'};
    const context = {mfaPresent: false};
    const statements = sender.getEffectiveShape()?.statements ?? [];
    const explicitGrant = statements.some((statement) =>
        statementGrantsAction(statement, query, context)
    );
    const explicitDeny = statements.some((statement) =>
        statementDeniesAction(statement, query, context)
    );
    const authoringAllowed = sender.getCredentialBoundary()
        ? explicitGrant && !explicitDeny
        : canManageAutomations(sender) && !explicitDeny;
    if (
        sender.getUser() === undefined ||
        !authoringAllowed ||
        deviceIds.length === 0
    ) {
        return false;
    }
    const decisions = await Promise.all(
        deviceIds.map((deviceId) =>
            canPerformComponentOperationAsync(
                sender,
                'devices',
                'execute',
                deviceId
            )
        )
    );
    return decisions.every(isComponentPermissionAllowed);
}

export function canReadOrganizationSettings(sender: CommandSender): boolean {
    return allowsOrganization(sender, 'read');
}

export function canManageOrganizationSettings(sender: CommandSender): boolean {
    return allowsOrganization(sender, 'update');
}

function allowsOrganization(
    sender: CommandSender,
    operation: 'read' | 'update'
): boolean {
    return canPerformComponent(sender, 'organizations', operation);
}
