import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FM_API_CONTRACT_VERSION ??= 'test';
process.env.FM_UI_CONTRACT_VERSION ??= 'test';
process.env.FM_FRONTEND_ARTIFACT_ID ??= 'test';
process.env.FM_FRONTEND_ARTIFACT_VERSION ??= 'default';
process.env.FM_DEPLOYMENT_MODE ??= 'oss';
process.env.FM_SAFE_MODE ??= 'false';

test('getDeniedDevices excludes denied rows owned by another organization', async () => {
    const postgres = await import('../../src/modules/PostgresProvider.js');
    const calls: Array<{name: string; params: Record<string, unknown>}> = [];
    postgres.__setCallDbMethodForTests(async (name, params) => {
        calls.push({name, params});
        if (name === 'device.fn_fetch') {
            return {
                rows: [
                    {external_id: 'tenant-a-device', id: 1},
                    {external_id: 'tenant-b-device', id: 2}
                ]
            };
        }
        if (name === 'device.fn_list_shelly_ids_by_org') {
            return {rows: [{external_id: 'tenant-a-device'}]};
        }
        throw new Error(`unexpected DB method ${name}`);
    });

    try {
        const result = await postgres.getDeniedDevices('tenant-a');

        assert.deepEqual(
            result.map((row) => row.external_id),
            ['tenant-a-device']
        );
        assert.deepEqual(calls, [
            {
                name: 'device.fn_fetch',
                params: {
                    p_external_id: null,
                    p_control_access: postgres.ACCESS_CONTROL.DENIED
                }
            },
            {
                name: 'device.fn_list_shelly_ids_by_org',
                params: {p_organization_id: 'tenant-a'}
            }
        ]);
    } finally {
        postgres.__setCallDbMethodForTests(undefined);
    }
});

test('legacy denied list passes the caller organization into the denied store', async () => {
    const waitingRoom = await import('../../src/modules/WaitingRoom/index.js');
    const {listUnifiedWaitingRoom} = await import(
        '../../src/modules/WaitingRoom/unified.js'
    );
    let requestedOrganization: string | undefined;
    const restore = waitingRoom.__setStoreForTests({
        getDeniedDevices: async (organizationId: string) => {
            requestedOrganization = organizationId;
            return [
                {
                    external_id: 'tenant-a-device',
                    id: 1,
                    control_access: 2,
                    created: new Date(0),
                    updated: new Date(0),
                    jdoc: {
                        shellyID: 'tenant-a-device',
                        status: {sys: {model: 'fixture'}}
                    }
                }
            ];
        }
    });

    try {
        const result = await listUnifiedWaitingRoom({
            organizationId: 'tenant-a',
            source: 'legacy',
            state: 'rejected'
        });

        assert.equal(requestedOrganization, 'tenant-a');
        assert.equal(result.total, 1);
        assert.equal(result.items[0]?.shellyID, 'tenant-a-device');
    } finally {
        restore();
        waitingRoom.stop();
    }
});
