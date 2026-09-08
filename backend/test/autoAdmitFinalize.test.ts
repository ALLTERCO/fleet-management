// Must come before anything that reaches src/config/runtimeMetadata, which throws on load
// when its required variables are absent. Import order is the mechanism.
import './helpers/env';

import assert from 'node:assert/strict';
import {afterEach, describe, it} from 'node:test';

import {
    __setAutoAdmitFinalizeDepsForTests,
    bindAutoAdmittedDeviceOrg
} from '../src/modules/discovery/autoAdmitFinalize';
import type {AdmissionIntent} from '../src/modules/WaitingRoom/types';

/**
 * Discovery.AdmitDevice on a device Fleet has never seen (issue #34).
 *
 * The organization bind runs before approve so that Shelly.Connect observes the org link. A
 * brand-new device has no row to bind, so the bind matches nothing — and that is the ordinary
 * first-admission state, not a failure. Reporting it as one made the caller skip approve, so
 * the row that would have made the bind succeed was never created, the intent survived, and
 * the device fell back to the waiting room where a manual create_new_device approval recovered
 * it immediately.
 *
 * These assert the distinction the caller needs: an unknown device and a failed write must not
 * look the same.
 */

const intent: AdmissionIntent = {
    organization_id: 'org-1',
    group_id: null
} as AdmissionIntent;

function withDeps(overrides: Parameters<typeof __setAutoAdmitFinalizeDepsForTests>[0]): void {
    __setAutoAdmitFinalizeDepsForTests(overrides);
}

afterEach(() => __setAutoAdmitFinalizeDepsForTests(null));

describe('auto-admit organization bind', () => {
    it('reports a device Fleet has no row for as unknown, not as a failure', async () => {
        let groupAdds = 0;
        withDeps({
            setDeviceOrganizationBatch: async () => [],
            groupAddDevicesBatch: async () => {
                groupAdds += 1;
                return 0;
            },
            setDeviceOrg: () => undefined,
            invalidateGroupCache: () => undefined
        });

        assert.equal(await bindAutoAdmittedDeviceOrg('shelly-new', intent), 'device-unknown');
        // Nothing was bound, so nothing may be filed under the organization either.
        assert.equal(groupAdds, 0);
    });

    it('reports a failed write as a failure, so the caller stops instead of approving', async () => {
        withDeps({
            setDeviceOrganizationBatch: async () => {
                throw new Error('connection terminated');
            },
            setDeviceOrg: () => undefined,
            invalidateGroupCache: () => undefined
        });

        assert.equal(await bindAutoAdmittedDeviceOrg('shelly-known', intent), 'failed');
    });

    it('binds an existing device and files it under its organization', async () => {
        const orgWrites: Array<[string, string]> = [];
        let invalidated = 0;
        withDeps({
            setDeviceOrganizationBatch: async (ids) => ids,
            setDeviceOrg: (id, org) => {
                orgWrites.push([id, org]);
            },
            invalidateGroupCache: () => {
                invalidated += 1;
            }
        });

        assert.equal(await bindAutoAdmittedDeviceOrg('shelly-known', intent), 'bound');
        assert.deepEqual(orgWrites, [['shelly-known', 'org-1']]);
        assert.equal(invalidated, 1);
    });

    it('still binds when the device is added to a group, and survives a group-add failure', async () => {
        let groupAdds = 0;
        withDeps({
            setDeviceOrganizationBatch: async (ids) => ids,
            groupAddDevicesBatch: async () => {
                groupAdds += 1;
                throw new Error('group vanished');
            },
            setDeviceOrg: () => undefined,
            invalidateGroupCache: () => undefined
        });

        // The bind is already committed at this point, so a group-add failure is reported and
        // counted but must not turn an admitted device back into an unadmitted one.
        assert.equal(
            await bindAutoAdmittedDeviceOrg('shelly-known', {
                ...intent,
                group_id: 7
            } as AdmissionIntent),
            'bound'
        );
        assert.equal(groupAdds, 1);
    });
});
