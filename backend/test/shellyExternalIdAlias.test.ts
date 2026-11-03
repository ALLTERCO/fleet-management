import assert from 'node:assert/strict';
import test from 'node:test';
import {modelFromShellyIdPrefix} from '../src/config/shellyIdPrefixModels';
import {
    resolveAdmittedShellyExternalId,
    resolveKnownShellyExternalId,
    shellyExternalIdAliasTarget
} from '../src/model/shellyExternalId';
import {
    evaluateHandshake,
    type HandshakeLookupDeps
} from '../src/modules/deviceIngress/handshake';

const oldId = 'shelly1pmminig4-acebe6f1ff90';
const reportedAlias = 'shellymini1pmg4-acebe6f1ff90';

test('Mini 1PM G4 reported alias targets the stable Fleet id', () => {
    assert.equal(shellyExternalIdAliasTarget(reportedAlias), oldId);
    assert.equal(
        shellyExternalIdAliasTarget('shellymini1pmg4-ACEBE6F1FF90'),
        oldId
    );
    assert.equal(shellyExternalIdAliasTarget(oldId), null);
    assert.equal(
        shellyExternalIdAliasTarget('shellyplugsg3-acebe6f1ff90'),
        null
    );
});

test('both Mini 1PM G4 prefixes resolve the same model', () => {
    assert.equal(modelFromShellyIdPrefix(oldId), 'S4SW-001P8EU');
    assert.equal(modelFromShellyIdPrefix(reportedAlias), 'S4SW-001P8EU');
});

test('known exact id wins before alias resolution', () => {
    assert.equal(
        resolveKnownShellyExternalId(
            reportedAlias,
            (id) => id === reportedAlias
        ),
        reportedAlias
    );
    assert.equal(
        resolveKnownShellyExternalId(reportedAlias, (id) => id === oldId),
        oldId
    );
    assert.equal(
        resolveKnownShellyExternalId(reportedAlias, () => false),
        reportedAlias
    );
    assert.equal(
        resolveKnownShellyExternalId(oldId, (id) => id === oldId),
        oldId
    );
    assert.equal(
        resolveKnownShellyExternalId(
            'shellymini1pmg4-acebe6f1ff91',
            (id) => id === oldId
        ),
        'shellymini1pmg4-acebe6f1ff91'
    );
});

test('device construction only adopts alias target from the approved admission', () => {
    assert.equal(resolveAdmittedShellyExternalId(reportedAlias, oldId), oldId);
    assert.equal(
        resolveAdmittedShellyExternalId(reportedAlias, reportedAlias),
        reportedAlias
    );
    assert.equal(
        resolveAdmittedShellyExternalId(reportedAlias, 'some-other-device'),
        reportedAlias
    );
});

function handshakeDeps(): HandshakeLookupDeps {
    return {
        findTokenCredential: async () => null,
        findCertificateCredential: async () => null,
        certificateChainsToFmCa: async () => false,
        certificateSubject: () => null,
        deviceInScope: async () => false,
        consumeEnrollmentTokenForWaitingRoom: async () => null,
        findEnrollmentTokenOrg: async () => null,
        isPendingInWaitingRoom: async () => false,
        approvedDeviceOrg: (id) => (id === oldId ? 'org-1' : undefined)
    };
}

test('grandfathered known Mini 1PM G4 alias does not enter the waiting room', async () => {
    const result = await evaluateHandshake(
        {
            reportedExternalId: reportedAlias,
            observedTransport: 'wss',
            token: null,
            certificateFingerprint: null,
            certificatePem: null,
            waitingRoomEnabled: true,
            deploymentPolicy: {allowPlainWs: false},
            grandfatherKnownDevices: true
        },
        handshakeDeps()
    );
    assert.deepEqual(result, {result: 'known_device'});
});

test('genuinely new Mini 1PM G4 alias remains a waiting-room candidate', async () => {
    const deps = handshakeDeps();
    deps.approvedDeviceOrg = () => undefined;
    const result = await evaluateHandshake(
        {
            reportedExternalId: reportedAlias,
            observedTransport: 'wss',
            token: null,
            certificateFingerprint: null,
            certificatePem: null,
            waitingRoomEnabled: true,
            deploymentPolicy: {allowPlainWs: false},
            grandfatherKnownDevices: true
        },
        deps
    );
    assert.equal(result.result, 'waiting_room');
    if (result.result === 'waiting_room') {
        assert.equal(result.entry.reportedExternalId, reportedAlias);
    }
});
