import {configRc} from '../../../config';
import {envBool} from '../../../config/envReader';
import type CommandSender from '../../../model/CommandSender';
import type {ComponentName, CrudOperation} from '../../../model/permissions';
import {canCrossOrganizationBoundary} from '../crossOrg';
import {
    canPerformComponentOperation,
    isComponentPermissionAllowed,
    requireComponentPermissionAsync
} from './componentPermission';

export {canCrossOrganizationBoundary};

// Mirrors config.DEV_MODE but evaluates at call time so tests that mutate
// FM_DEV_MODE work regardless of module-load order. Same predicate as the
// module-level const so the .fleet-managerrc + env-var parity stays whole.
function isDevMode(): boolean {
    return !!configRc['dev-mode'] || envBool('FM_DEV_MODE', false);
}

export function hasTenantAdminAuthority(sender: CommandSender): boolean {
    return sender.isAdmin();
}

// @Component.CheckPermissions form of hasTenantAdminAuthority — makes
// the transport-auth matrix classify tenant-admin RPCs explicitly.
export function canUseTenantAdmin(sender: CommandSender): boolean {
    return hasTenantAdminAuthority(sender);
}

export function canUsePlatformAdmin(sender: CommandSender): boolean {
    // DEV_MODE has no Zitadel, so PlatformAdminResolver can't populate the
    // flag — tenant admin stands in for platform admin in the single-tenant
    // local dev loop (debug observability, log levels, DB-write toggles).
    if (isDevMode() && sender.isAdmin()) return true;
    return sender.isPlatformAdmin();
}

// Per-device update gate shared by the certificate and credential components:
// a cross-org actor is unrestricted, otherwise every device id is checked.
export async function assertDeviceUpdateAccess(
    sender: CommandSender,
    shellyIDs: string[]
): Promise<void> {
    if (canCrossOrganizationBoundary(sender)) return;
    for (const id of shellyIDs) {
        await requireComponentPermissionAsync(sender, 'devices', 'update', id);
    }
}

export function canUseAuthenticatedRead(sender: CommandSender): boolean {
    return sender.isAuthenticated();
}

export function canUseAuthenticatedWrite(sender: CommandSender): boolean {
    return sender.isAuthenticated() && sender.canWrite();
}

export function canPerformComponent(
    sender: CommandSender,
    component: ComponentName,
    operation: CrudOperation,
    itemId?: string | number
): boolean {
    return isComponentPermissionAllowed(
        canPerformComponentOperation(sender, component, operation, itemId)
    );
}

export function canReadComponent(
    sender: CommandSender,
    component: ComponentName,
    itemId?: string | number
): boolean {
    return canPerformComponent(sender, component, 'read', itemId);
}

export function canManageComponent(
    sender: CommandSender,
    component: ComponentName,
    itemId?: string | number
): boolean {
    return canPerformComponent(sender, component, 'update', itemId);
}
