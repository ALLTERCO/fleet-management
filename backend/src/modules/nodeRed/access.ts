// Who may see and change automations. Two doors reach them, the browser
// editor and RPC, and both go through canManageAutomations in
// authzPermissions.ts, which adapts a CommandSender onto this one rule.
//
// Reading is the same test as writing. A flow can hold a webhook URL, a token
// or a site layout, and the editor never had a read-only mode.

import {tuning} from '../../config/tuning';

/** What the rule needs to know about the caller. */
export interface AutomationPrincipal {
    authenticated: boolean;
    /** A credential boundary must not inherit its user's administrator shortcuts. */
    hasCredentialBoundary: boolean;
    credentialCoversTenant?: boolean;
    isAdmin: boolean;
    /** Coarse permission strings, derived from an identity-provider role. */
    permissions: readonly string[];
    /** The policy evaluator's answer for automation:update. A persona given
     *  inside Fleet Manager lives only there, never in `permissions`. */
    policyAllows: boolean;
}

function segmentMatches(granted: string, required: string): boolean {
    return granted === '*' || granted === required;
}

/** `automation:*` covers `automation:update`. Segment counts must match. */
export function permissionMatches(granted: string, required: string): boolean {
    if (granted === '*' || granted === required) return true;

    const grantedSegments = granted.split(':');
    const requiredSegments = required.split(':');
    if (grantedSegments.length !== requiredSegments.length) return false;
    if (grantedSegments.length < 2) return false;

    return grantedSegments.every((segment, index) =>
        segmentMatches(segment, requiredSegments[index]!)
    );
}

/** The one rule. Everything else here adapts onto it. */
export function automationAccessAllowed(
    principal: AutomationPrincipal
): boolean {
    if (!principal.authenticated) return false;
    if (principal.hasCredentialBoundary) {
        return (
            principal.credentialCoversTenant === true && principal.policyAllows
        );
    }
    if (principal.isAdmin) return true;
    if (principal.policyAllows) return true;
    if (principal.permissions.includes('*')) return true;

    // `integration:*` kept for admins who had it before the rename.
    const required = [
        ...tuning.nodeRed.uiPermissions,
        'integration:*',
        'integration:update'
    ];
    return required.some((need) =>
        principal.permissions.some((granted) =>
            permissionMatches(granted, need)
        )
    );
}
