import {
    canCrossOrganizationBoundary,
    canPerformComponentOperationAsync,
    isComponentPermissionAllowed,
    requireComponentPermission,
    requireComponentPermissionAsync
} from '../../modules/authz/evaluator';
import type CommandSender from '../CommandSender';

// Field reads mask to empty on denial, not throw.
export async function canReadDeviceFieldAsync(
    sender: CommandSender,
    shellyID: string
): Promise<boolean> {
    if (canCrossOrganizationBoundary(sender)) return true;
    return isComponentPermissionAllowed(
        await canPerformComponentOperationAsync(
            sender,
            'devices',
            'read',
            shellyID
        )
    );
}

// Per-device fallback: decorator can't gate on shellyID derived via lookup.
export function assertDeviceReadAccess(
    sender: CommandSender,
    shellyID: string
): void {
    requireComponentPermission(sender, 'devices', 'read', shellyID);
}

export async function assertDeviceReadAccessAsync(
    sender: CommandSender,
    shellyID: string
): Promise<void> {
    await requireComponentPermissionAsync(sender, 'devices', 'read', shellyID);
}
