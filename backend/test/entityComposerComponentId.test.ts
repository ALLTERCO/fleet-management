import assert from 'node:assert/strict';
import {test} from 'node:test';

process.env.FM_API_CONTRACT_VERSION ??= 'test';
process.env.FM_UI_CONTRACT_VERSION ??= 'test';
process.env.FM_FRONTEND_ARTIFACT_ID ??= 'test';
process.env.FM_FRONTEND_ARTIFACT_VERSION ??= 'default';
process.env.FM_DEPLOYMENT_MODE ??= 'oss';
process.env.FM_SAFE_MODE ??= 'false';

async function loadComposer() {
    return import('../src/modules/EntityComposer');
}

function fakeShelly(
    status: Record<string, unknown>,
    config: Record<string, unknown> = {}
) {
    let commandReads = 0;
    const device = new Proxy(
        {
            id: 42,
            shellyID: 'test-zigbee-gateway',
            status,
            config,
            info: {name: 'Test Gateway'}
        },
        {
            get(target, prop, receiver) {
                if (
                    prop === 'transport' ||
                    prop === 'sendRPC' ||
                    prop === 'call' ||
                    prop === 'rpc'
                ) {
                    commandReads += 1;
                    throw new Error(
                        `composer attempted device command access: ${String(prop)}`
                    );
                }
                return Reflect.get(target, prop, receiver);
            }
        }
    );
    return {device, commandReads: () => commandReads};
}

test('component index falls back only to an exact numeric component key', async () => {
    const {resolveComponentEntityIndex} = await loadComposer();

    assert.deepEqual(resolveComponentEntityIndex('zigbee', 'zigbee:0', null), {
        id: 0,
        source: 'key'
    });
    assert.deepEqual(
        resolveComponentEntityIndex('zigbee', 'zigbee:17', undefined),
        {
            id: 17,
            source: 'key'
        }
    );
    assert.equal(resolveComponentEntityIndex('zigbee', 'zigbee:', null), null);
    assert.equal(
        resolveComponentEntityIndex('zigbee', 'zigbee:-1', null),
        null
    );
    assert.equal(
        resolveComponentEntityIndex('zigbee', 'zigbee:1:2', null),
        null
    );
    assert.equal(
        resolveComponentEntityIndex('zigbee', 'zigbee:not-a-number', null),
        null
    );
    assert.equal(resolveComponentEntityIndex('zigbee', 'switch:0', null), null);
});

test('finite numeric status id keeps precedence over the key fallback', async () => {
    const {resolveComponentEntityIndex} = await loadComposer();

    assert.deepEqual(resolveComponentEntityIndex('zigbee', 'zigbee:0', 7), {
        id: 7,
        source: 'status'
    });
    // Preserve existing behavior for a status object that already carries a
    // numeric id even if its opaque key suffix is not parseable.
    assert.deepEqual(
        resolveComponentEntityIndex('zigbee', 'zigbee:opaque', 9),
        {
            id: 9,
            source: 'status'
        }
    );
});

test('zigbee null id composes from zigbee:0 without fabricating readings or commands', async () => {
    const {proposeEntities} = await loadComposer();
    const {device, commandReads} = fakeShelly(
        {
            'zigbee:0': {id: null, connected: true, channel: 15}
        },
        {
            'zigbee:0': {enabled: true}
        }
    );

    const entities = proposeEntities(device as never);
    const zigbee = entities.filter((entity) => entity.type === 'zigbee');

    assert.equal(zigbee.length, 1);
    assert.equal(zigbee[0].id, '42_0:zigbee');
    assert.deepEqual(zigbee[0].properties, {id: 0});
    assert.equal(commandReads(), 0);
});

test('invalid key without numeric status id is skipped', async () => {
    const {proposeEntities} = await loadComposer();
    const {device} = fakeShelly({'zigbee:not-a-number': {id: null}});

    const zigbee = proposeEntities(device as never).filter(
        (entity) => entity.type === 'zigbee'
    );
    assert.equal(zigbee.length, 0);
});

test('duplicate resolved ids prefer explicit status id independent of key order', async () => {
    const {proposeEntities} = await loadComposer();

    for (const status of [
        {
            'zigbee:0': {id: null},
            'zigbee:1': {id: 0}
        },
        {
            'zigbee:1': {id: 0},
            'zigbee:0': {id: null}
        }
    ]) {
        const {device} = fakeShelly(status, {
            'zigbee:0': {name: 'Key fallback'},
            'zigbee:1': {name: 'Explicit status id'}
        });

        const zigbee = proposeEntities(device as never).filter(
            (entity) => entity.type === 'zigbee'
        );
        assert.equal(zigbee.length, 1);
        assert.equal(zigbee[0].id, '42_0:zigbee');
        assert.equal(zigbee[0].name, 'Explicit status id');
        assert.equal(zigbee[0].properties.id, 0);
    }
});
