// Shared authz policies for organization-level administration.

import {
    canCrossOrganizationBoundary,
    canPerformComponent,
    canUsePlatformAdmin as canUsePlatformAdminAuthority
} from '../../modules/authz/evaluator';
import type CommandSender from '../CommandSender';

export function canManageAuthz(sender: CommandSender): boolean {
    return canManageOrganizationSettings(sender);
}

export function canViewAuthz(sender: CommandSender): boolean {
    return canManageOrganizationSettings(sender);
}

// Audit-log read: organization reader OR any role set including auditor.
export function canViewAuditLog(sender: CommandSender): boolean {
    return canReadOrganizationSettings(sender) || sender.hasRole('auditor');
}

// Read access to the access matrix (personas, assignments, groups,
// administrator list). Excludes secrets-bearing reads which use canViewAuthz.
export function canReadPolicies(sender: CommandSender): boolean {
    return canReadOrganizationSettings(sender) || sender.hasRole('auditor');
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
