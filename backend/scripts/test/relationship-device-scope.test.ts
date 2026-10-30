import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FM_API_CONTRACT_VERSION ??= 'test';
process.env.FM_UI_CONTRACT_VERSION ??= 'test';
process.env.FM_FRONTEND_ARTIFACT_ID ??= 'test';
process.env.FM_FRONTEND_ARTIFACT_VERSION ??= 'default';
process.env.FM_DEPLOYMENT_MODE ??= 'oss';
process.env.FM_SAFE_MODE ??= 'false';

test('Bluetooth relationship facts cannot reveal hidden BLU children or gateway IDs', async () => {
    const {
        visibleRelatedBluetoothDevices,
        visibleBluetoothTransportRows,
        visibleFallbackGatewayId,
        primaryBluetoothGatewayExternalId,
        primaryBluetoothTransport
    } = await import('../../src/modules/deviceRelationships/bluetoothFacts.js');

    const input = {
        organizationId: 'org-a',
        centerExternalId: 'blu-center',
        filterAccessibleDevices: async (ids: readonly string[]) =>
            new Set(
                ids.filter(
                    (id) => id === 'blu-visible' || id === 'gateway-visible'
                )
            )
    } as any;

    const devices = [
        {externalId: 'blu-center'},
        {externalId: 'blu-visible'},
        {externalId: 'blu-hidden'}
    ] as any[];
    assert.deepEqual(
        (await visibleRelatedBluetoothDevices(input, devices)).map(
            (device) => device.externalId
        ),
        ['blu-center', 'blu-visible']
    );

    const transports = [
        {
            bluetooth_external_id: 'blu-hidden',
            shelly_device_external_id: 'gateway-hidden',
            assistant_device_external_id: null,
            id: 'hidden'
        },
        {
            bluetooth_external_id: 'blu-visible',
            shelly_device_external_id: 'gateway-hidden',
            assistant_device_external_id: 'gateway-visible',
            id: 'visible'
        },
        {
            bluetooth_external_id: 'blu-center',
            shelly_device_external_id: 'gateway-visible',
            assistant_device_external_id: null,
            id: 'center'
        }
    ] as any[];
    const visible = await visibleBluetoothTransportRows(input, transports);
    assert.deepEqual(
        visible.map((row) => [
            row.id,
            row.shelly_device_external_id,
            row.assistant_device_external_id
        ]),
        [
            ['visible', null, 'gateway-visible'],
            ['center', 'gateway-visible', null]
        ]
    );

    // Fallback rows must not restore a gateway hidden by a scoped lookup.
    assert.equal(
        visibleFallbackGatewayId(
            'gateway-hidden',
            input,
            new Set(['gateway-visible'])
        ),
        null
    );
    assert.equal(
        visibleFallbackGatewayId(
            'gateway-visible',
            input,
            new Set(['gateway-visible'])
        ),
        'gateway-visible'
    );
    assert.equal(
        visibleFallbackGatewayId('blu-center', input, new Set()),
        'blu-center'
    );
    // Even when a primary row exists with a redacted gateway, it must not
    // leak the original gateway through the BLU record fallback.
    const hiddenPrimary = {
        device: {
            primaryTransport: {
                shellyDeviceExternalId: 'gateway-hidden',
                lastSeenAt: '2026-01-01T00:00:00Z',
                lastRssi: -55
            }
        },
        transports: [
            {
                is_primary: true,
                shelly_device_external_id: null,
                last_seen_at: '2026-01-01T00:00:00Z',
                last_rssi: -55
            }
        ],
        input,
        visibleGatewayIds: new Set<string>()
    } as any;
    assert.equal(primaryBluetoothGatewayExternalId(hiddenPrimary), null);
    assert.equal(
        primaryBluetoothTransport(hiddenPrimary)?.gatewayExternalId,
        null
    );
    assert.equal(
        primaryBluetoothGatewayExternalId({
            ...hiddenPrimary,
            transports: []
        }),
        null
    );
});

test('Historical virtual binding events omit inaccessible virtual and source devices', async () => {
    const {visibleVirtualBindingHistoryFacts} = await import(
        '../../src/modules/deviceRelationships/historyEventFacts.js'
    );
    const input = {
        organizationId: 'org-a',
        centerExternalId: 'virtual-center',
        filterAccessibleDevices: async (ids: readonly string[]) =>
            new Set(ids.filter((id) => id === 'source-visible'))
    } as any;
    const rows = [
        {
            id: 'old-and-new',
            virtual_external_id: 'virtual-center',
            old_source_json: {
                deviceExternalId: 'source-hidden',
                componentKey: 'sensor:0'
            },
            new_source_json: {
                deviceExternalId: 'source-visible',
                componentKey: 'sensor:0'
            },
            event_type: 'rebound',
            role_key: 'temperature',
            reason: 'maintenance',
            created_at: new Date('2026-01-01T00:00:00Z')
        },
        {
            id: 'hidden-virtual',
            virtual_external_id: 'virtual-hidden',
            old_source_json: {
                deviceExternalId: 'virtual-center',
                componentKey: 'sensor:0'
            },
            new_source_json: null,
            event_type: 'unbound',
            role_key: 'temperature',
            reason: 'maintenance',
            created_at: new Date('2026-01-01T00:00:00Z')
        }
    ] as any[];
    const facts = await visibleVirtualBindingHistoryFacts(input, rows);
    assert.equal(facts.length, 1);
    assert.equal(facts[0].targetExternalId, 'source-visible');
    assert.equal(facts[0].meta?.virtualExternalId, 'virtual-center');
    assert.ok(!JSON.stringify(facts).includes('source-hidden'));
    assert.ok(!JSON.stringify(facts).includes('virtual-hidden'));
});
