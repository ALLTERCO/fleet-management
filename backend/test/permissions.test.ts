import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
    ADMIN_PERMISSIONS,
    INSTALLER_PERMISSIONS,
    VIEWER_PERMISSIONS,
    configHasWritePermissions,
    createEmptyConfig,
    mapLegacyComponentName,
    methodToCrudOperation,
    parsePermissionConfig,
    roleToPermissionConfig
} from '../src/model/permissions';

describe('roleToPermissionConfig', () => {
    it('admin returns full access', () => {
        const config = roleToPermissionConfig('admin');
        assert.deepStrictEqual(config, ADMIN_PERMISSIONS);
        assert.ok(config.components.devices?.execute);
        assert.ok(config.components.devices?.delete);
    });

    it('viewer returns read-only', () => {
        const config = roleToPermissionConfig('viewer');
        assert.deepStrictEqual(config, VIEWER_PERMISSIONS);
        assert.ok(config.components.devices?.read);
        assert.ok(!config.components.devices?.execute);
        assert.ok(!config.components.devices?.create);
    });

    it('installer can manage waiting room', () => {
        const config = roleToPermissionConfig('installer');
        assert.deepStrictEqual(config, INSTALLER_PERMISSIONS);
        assert.ok(config.components.waiting_room?.create);
        assert.ok(config.components.waiting_room?.read);
        assert.ok(config.components.waiting_room?.delete);
        assert.ok(!config.components.waiting_room?.update);
    });

    it('none returns empty config', () => {
        const config = roleToPermissionConfig('none');
        assert.ok(!config.components.devices?.read);
        assert.ok(!config.components.devices?.execute);
    });
});

describe('parsePermissionConfig', () => {
    it('returns null for non-object', () => {
        assert.equal(parsePermissionConfig(null), null);
        assert.equal(parsePermissionConfig('string'), null);
        assert.equal(parsePermissionConfig(42), null);
    });

    it('returns null without components key', () => {
        assert.equal(parsePermissionConfig({foo: 'bar'}), null);
        assert.equal(parsePermissionConfig({components: 'string'}), null);
    });

    it('parses partial config with defaults', () => {
        const config = parsePermissionConfig({
            components: {
                devices: {read: true, execute: true}
            }
        });
        assert.ok(config);
        assert.ok(config.components.devices?.read);
        assert.ok(config.components.devices?.execute);
        assert.ok(!config.components.devices?.create);
        assert.ok(!config.components.devices?.update);
        assert.ok(!config.components.devices?.delete);
        // Other components should be empty
        assert.ok(!config.components.groups?.read);
    });

    it('parses scoped SELECTED permissions', () => {
        const config = parsePermissionConfig({
            components: {
                groups: {
                    read: true,
                    scope: 'SELECTED',
                    selected: [1, 2, 3]
                }
            }
        });
        assert.ok(config);
        assert.equal(config.components.groups?.scope, 'SELECTED');
        assert.deepStrictEqual(config.components.groups?.selected, [1, 2, 3]);
    });

    it('ignores unknown component names', () => {
        const config = parsePermissionConfig({
            components: {
                unknown_component: {read: true},
                devices: {read: true}
            }
        });
        assert.ok(config);
        assert.ok(config.components.devices?.read);
        assert.ok(!('unknown_component' in config.components));
    });
});

describe('configHasWritePermissions', () => {
    it('returns false for viewer', () => {
        assert.ok(!configHasWritePermissions(VIEWER_PERMISSIONS));
    });

    it('returns true for admin', () => {
        assert.ok(configHasWritePermissions(ADMIN_PERMISSIONS));
    });

    it('returns true for installer (waiting room create)', () => {
        assert.ok(configHasWritePermissions(INSTALLER_PERMISSIONS));
    });

    it('returns false for empty config', () => {
        assert.ok(!configHasWritePermissions(createEmptyConfig()));
    });
});

describe('mapLegacyComponentName', () => {
    it('maps singular to plural', () => {
        assert.equal(mapLegacyComponentName('device'), 'devices');
        assert.equal(mapLegacyComponentName('action'), 'actions');
        assert.equal(mapLegacyComponentName('group'), 'groups');
    });

    it('maps entity to devices', () => {
        assert.equal(mapLegacyComponentName('entity'), 'devices');
        assert.equal(mapLegacyComponentName('entities'), 'devices');
    });

    it('maps storage to configurations', () => {
        assert.equal(mapLegacyComponentName('storage'), 'configurations');
        assert.equal(
            mapLegacyComponentName('storagecomponent'),
            'configurations'
        );
    });

    it('returns null for unknown names', () => {
        assert.equal(mapLegacyComponentName('nonexistent'), null);
    });

    it('is case-insensitive', () => {
        assert.equal(mapLegacyComponentName('Device'), 'devices');
        assert.equal(mapLegacyComponentName('GROUPS'), 'groups');
    });
});

describe('methodToCrudOperation', () => {
    it('maps create patterns', () => {
        assert.equal(methodToCrudOperation('createDevice'), 'create');
        assert.equal(methodToCrudOperation('addGroup'), 'create');
        assert.equal(methodToCrudOperation('uploadPlugin'), 'create');
        assert.equal(methodToCrudOperation('acceptDevice'), 'create');
    });

    it('maps read patterns', () => {
        assert.equal(methodToCrudOperation('listDevices'), 'read');
        assert.equal(methodToCrudOperation('getDevice'), 'read');
        assert.equal(methodToCrudOperation('fetchStatus'), 'read');
        assert.equal(methodToCrudOperation('searchDevices'), 'read');
    });

    it('maps delete patterns', () => {
        assert.equal(methodToCrudOperation('deleteDevice'), 'delete');
        assert.equal(methodToCrudOperation('removeGroup'), 'delete');
        assert.equal(methodToCrudOperation('rejectDevice'), 'delete');
    });

    it('maps execute patterns', () => {
        assert.equal(methodToCrudOperation('callMethod'), 'execute');
        assert.equal(methodToCrudOperation('runAction'), 'execute');
        assert.equal(methodToCrudOperation('setConfig'), 'execute');
    });

    it('maps update patterns', () => {
        assert.equal(methodToCrudOperation('updateDevice'), 'update');
        assert.equal(methodToCrudOperation('renameGroup'), 'update');
        assert.equal(methodToCrudOperation('enablePlugin'), 'update');
    });

    it('returns null for unknown methods', () => {
        assert.equal(methodToCrudOperation('doSomething'), null);
    });
});
