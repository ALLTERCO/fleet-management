import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FM_API_CONTRACT_VERSION ??= 'test';
process.env.FM_UI_CONTRACT_VERSION ??= 'test';
process.env.FM_FRONTEND_ARTIFACT_ID ??= 'test';
process.env.FM_FRONTEND_ARTIFACT_VERSION ??= 'default';
process.env.FM_DEPLOYMENT_MODE ??= 'oss';
process.env.FM_SAFE_MODE ??= 'false';

test('WaitingRoom accepted and denied events stay inside their organization', async () => {
    const EventDistributor = await import(
        '../../src/modules/EventDistributor.js'
    );
    const ShellyEvents = await import('../../src/modules/ShellyEvents.js');
    const {default: CommandSender} = await import(
        '../../src/model/CommandSender.js'
    );

    const senderA = new CommandSender({
        permissions: [],
        roles: ['viewer'],
        organizationId: 'tenant-a',
        username: 'tenant-a-user'
    });
    const senderB = new CommandSender({
        permissions: [],
        roles: ['viewer'],
        organizationId: 'tenant-b',
        username: 'tenant-b-user'
    });

    const seenA: Array<{method: string; params: Record<string, unknown>}> = [];
    const seenB: Array<{method: string; params: Record<string, unknown>}> = [];
    const listeners: Array<{id: number; eventName: string}> = [];

    const listen = (
        sender: InstanceType<typeof CommandSender>,
        eventName: string,
        target: Array<{method: string; params: Record<string, unknown>}>
    ) => {
        const id = EventDistributor.addEventListener(
            sender,
            eventName,
            {},
            (event) => {
                target.push({
                    method: event.method,
                    params: event.params as Record<string, unknown>
                });
            }
        );
        listeners.push({id, eventName});
    };

    listen(senderA, 'WaitingRoomEvent.Accepted', seenA);
    listen(senderA, 'WaitingRoomEvent.Denied', seenA);
    listen(senderB, 'WaitingRoomEvent.Accepted', seenB);
    listen(senderB, 'WaitingRoomEvent.Denied', seenB);

    try {
        ShellyEvents.emitWaitingRoomAccepted(101, 'tenant-b');
        ShellyEvents.emitWaitingRoomAcceptedBatch([102, 103], 'tenant-b');
        ShellyEvents.emitWaitingRoomDenied(104, 'tenant-b');

        assert.deepEqual(seenA, []);
        assert.deepEqual(seenB, [
            {method: 'WaitingRoomEvent.Accepted', params: {id: 101}},
            {method: 'WaitingRoomEvent.Accepted', params: {ids: [102, 103]}},
            {method: 'WaitingRoomEvent.Denied', params: {id: 104}}
        ]);
        for (const event of seenB) {
            assert.equal(Object.hasOwn(event.params, 'organizationId'), false);
        }
    } finally {
        for (const {id, eventName} of listeners) {
            EventDistributor.removeEventListener(id, eventName);
        }
    }
});
