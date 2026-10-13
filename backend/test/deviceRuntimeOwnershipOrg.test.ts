import assert from 'node:assert/strict';
import {test} from 'node:test';
import type AbstractDevice from '../src/model/AbstractDevice';
import {
    disconnectForIdentityChange,
    getDevice,
    register
} from '../src/modules/DeviceCollector';
import {
    claimDeviceRuntimeOwnership,
    heartbeatDeviceRuntimeOwnership
} from '../src/modules/deviceIdentityRuntime';
import {
    evaluateHandshake,
    type HandshakeLookupDeps
} from '../src/modules/deviceIngress/handshake';
import * as EventDistributor from '../src/modules/EventDistributor';

const ORG_ID = 'test-device-org';

function registerDevice(shellyID: string, destroyed: unknown[]): void {
    register({
        shellyID,
        id: 42,
        source: 'ws',
        entities: [],
        info: {model: 'test'},
        destroy(options: unknown) {
            destroyed.push(options);
        }
    } as unknown as AbstractDevice);
    EventDistributor.setDeviceOrg(shellyID, ORG_ID);
}

test('losing a runtime ownership lease disconnects but retains an approved device organization', async () => {
    const shellyID = 'test-shelly-lease-loss';
    const destroyed: unknown[] = [];
    registerDevice(shellyID, destroyed);

    try {
        const lease = await claimDeviceRuntimeOwnership(shellyID, {
            claim: async () => true
        });
        assert.ok(lease);

        await heartbeatDeviceRuntimeOwnership({
            heartbeatMany: async () => [false]
        });

        assert.equal(getDevice(shellyID), undefined);
        assert.deepEqual(destroyed, [{skipDeleteEvent: true}]);
        assert.equal(
            EventDistributor.getDeviceOrg(shellyID),
            ORG_ID,
            'a known, still-approved Shelly must remain trusted on reconnect'
        );
        const reconnect = await evaluateHandshake(
            {
                reportedExternalId: shellyID,
                observedTransport: 'wss',
                token: null,
                certificateFingerprint: null,
                certificatePem: null,
                waitingRoomEnabled: true,
                deploymentPolicy: {allowPlainWs: false},
                grandfatherKnownDevices: true
            },
            {
                approvedDeviceOrg: EventDistributor.getDeviceOrg
            } as HandshakeLookupDeps
        );
        assert.equal(
            reconnect.result,
            'known_device',
            'enforce_new must not put a previously approved Shelly in the Waiting Room'
        );
    } finally {
        EventDistributor.clearDeviceOrg(shellyID);
    }
});

test('a deliberate identity change still clears the cached device organization', () => {
    const shellyID = 'test-shelly-identity-change';
    const destroyed: unknown[] = [];
    registerDevice(shellyID, destroyed);

    try {
        disconnectForIdentityChange([shellyID]);
        assert.equal(getDevice(shellyID), undefined);
        assert.equal(EventDistributor.getDeviceOrg(shellyID), undefined);
        assert.deepEqual(destroyed, [{skipDeleteEvent: true}]);
    } finally {
        EventDistributor.clearDeviceOrg(shellyID);
    }
});
