import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {INSTALLER_PERMISSIONS} from '../src/model/permissions';
import {canExecuteOnDevice} from '../src/modules/web/utils/devicePermissions';
import {isValidDeviceIp} from '../src/modules/web/utils/ipValidation';
import type {user_t} from '../src/types';

// ---------------------------------------------------------------------------
// canExecuteOnDevice
// ---------------------------------------------------------------------------

function makeUser(overrides: Partial<user_t> = {}): user_t {
    return {
        username: 'test',
        password: '',
        permissions: [],
        group: 'user',
        enabled: true,
        ...overrides
    };
}

describe('canExecuteOnDevice', () => {
    it('admin role has full access', () => {
        const user = makeUser({role: 'admin'});
        assert.ok(canExecuteOnDevice(user, 'any-device'));
    });

    it('admin group has full access', () => {
        const user = makeUser({group: 'admin'});
        assert.ok(canExecuteOnDevice(user, 'any-device'));
    });

    it('wildcard permission has full access', () => {
        const user = makeUser({permissions: ['*']});
        assert.ok(canExecuteOnDevice(user, 'any-device'));
    });

    it('installer role denied execute (execute=false in default config)', () => {
        const user = makeUser({role: 'installer'});
        assert.strictEqual(canExecuteOnDevice(user, 'any-device'), false);
    });

    it('viewer role is denied execute', () => {
        const user = makeUser({role: 'viewer'});
        assert.strictEqual(canExecuteOnDevice(user, 'any-device'), false);
    });

    it('unknown role is denied', () => {
        const user = makeUser({role: 'none'});
        assert.strictEqual(canExecuteOnDevice(user, 'any-device'), false);
    });

    it('custom config with execute=true and ALL scope allows access', () => {
        const user = makeUser({
            permissionConfig: {
                ...INSTALLER_PERMISSIONS,
                components: {
                    ...INSTALLER_PERMISSIONS.components,
                    devices: {
                        ...INSTALLER_PERMISSIONS.components.devices,
                        execute: true,
                        scope: 'ALL' as const
                    }
                }
            }
        });
        assert.ok(canExecuteOnDevice(user, 'any-device'));
    });

    it('SELECTED scope — allowed device passes', () => {
        const user = makeUser({
            permissionConfig: {
                ...INSTALLER_PERMISSIONS,
                components: {
                    ...INSTALLER_PERMISSIONS.components,
                    devices: {
                        ...INSTALLER_PERMISSIONS.components.devices,
                        execute: true,
                        scope: 'SELECTED' as const,
                        selected: ['shelly-abc', 'shelly-xyz']
                    }
                }
            }
        });
        assert.ok(canExecuteOnDevice(user, 'shelly-abc'));
    });

    it('SELECTED scope — disallowed device fails', () => {
        const user = makeUser({
            permissionConfig: {
                ...INSTALLER_PERMISSIONS,
                components: {
                    ...INSTALLER_PERMISSIONS.components,
                    devices: {
                        ...INSTALLER_PERMISSIONS.components.devices,
                        execute: true,
                        scope: 'SELECTED' as const,
                        selected: ['shelly-abc']
                    }
                }
            }
        });
        assert.strictEqual(canExecuteOnDevice(user, 'shelly-other'), false);
    });

    it('no permissionConfig falls back to role defaults', () => {
        // Both installer and viewer have execute=false by default
        const installer = makeUser({
            role: 'installer',
            permissionConfig: undefined
        });
        assert.strictEqual(canExecuteOnDevice(installer, 'any-device'), false);

        const viewer = makeUser({role: 'viewer', permissionConfig: undefined});
        assert.strictEqual(canExecuteOnDevice(viewer, 'any-device'), false);
    });
});

// ---------------------------------------------------------------------------
// isValidDeviceIp
// ---------------------------------------------------------------------------

describe('isValidDeviceIp', () => {
    it('accepts normal private IPs', () => {
        assert.ok(isValidDeviceIp('192.168.1.100'));
        assert.ok(isValidDeviceIp('10.0.0.1'));
        assert.ok(isValidDeviceIp('172.16.0.50'));
    });

    it('accepts public IPs', () => {
        assert.ok(isValidDeviceIp('8.8.8.8'));
        assert.ok(isValidDeviceIp('1.2.3.4'));
    });

    it('rejects loopback', () => {
        assert.strictEqual(isValidDeviceIp('127.0.0.1'), false);
        assert.strictEqual(isValidDeviceIp('127.255.255.255'), false);
    });

    it('rejects unspecified (0.x.x.x)', () => {
        assert.strictEqual(isValidDeviceIp('0.0.0.0'), false);
        assert.strictEqual(isValidDeviceIp('0.1.2.3'), false);
    });

    it('rejects link-local', () => {
        assert.strictEqual(isValidDeviceIp('169.254.0.1'), false);
        assert.strictEqual(isValidDeviceIp('169.254.255.255'), false);
    });

    it('rejects multicast and reserved', () => {
        assert.strictEqual(isValidDeviceIp('224.0.0.1'), false);
        assert.strictEqual(isValidDeviceIp('239.255.255.255'), false);
        assert.strictEqual(isValidDeviceIp('255.255.255.255'), false);
    });

    it('rejects invalid formats', () => {
        assert.strictEqual(isValidDeviceIp('not-an-ip'), false);
        assert.strictEqual(isValidDeviceIp('192.168.1'), false);
        assert.strictEqual(isValidDeviceIp('192.168.1.1.1'), false);
        assert.strictEqual(isValidDeviceIp(''), false);
    });

    it('rejects octets > 255', () => {
        assert.strictEqual(isValidDeviceIp('256.1.1.1'), false);
        assert.strictEqual(isValidDeviceIp('1.1.1.999'), false);
    });
});
