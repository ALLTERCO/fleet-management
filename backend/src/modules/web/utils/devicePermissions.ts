import {
    type FleetPermissionConfig,
    INSTALLER_PERMISSIONS,
    type ScopedExecutablePermission,
    VIEWER_PERMISSIONS
} from '../../../model/permissions';
import type {user_t} from '../../../types';

/**
 * Check if user can execute commands on a specific device.
 * Implements the same logic as CommandSender.canPerformOnItem for user_t objects.
 */
export function canExecuteOnDevice(user: user_t, shellyID: string): boolean {
    // Admin users have full access
    if (user.role === 'admin' || user.group === 'admin') {
        return true;
    }

    // Legacy permission check
    if (user.permissions.includes('*')) {
        return true;
    }

    // Get effective permission config
    let config: FleetPermissionConfig | undefined = user.permissionConfig;

    if (!config) {
        // Derive from role if no explicit config
        // Note: admin role is already handled above, so only installer/viewer remain
        switch (user.role) {
            case 'installer':
                config = INSTALLER_PERMISSIONS;
                break;
            case 'viewer':
                config = VIEWER_PERMISSIONS;
                break;
            default:
                return false;
        }
    }

    // Check device execute permission
    const devicePerms = config.components.devices as
        | ScopedExecutablePermission<string>
        | undefined;
    if (!devicePerms) {
        return false;
    }

    // Check if execute is allowed
    if (!devicePerms.execute) {
        return false;
    }

    // Check scope
    if (devicePerms.scope === 'ALL') {
        return true;
    }

    // SELECTED scope - check if device is in list
    if (devicePerms.scope === 'SELECTED' && devicePerms.selected) {
        return devicePerms.selected.includes(shellyID);
    }

    return false;
}
