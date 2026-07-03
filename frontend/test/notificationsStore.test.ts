import type {
    DeliveryJob,
    NotificationInboxItem,
    NotificationRoutingPolicy
} from '@api/notification';
import type {Channel} from '@api/channel';
import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {toastRpcError} from '@/helpers/domainErrors';
import {useNotificationsStore} from '@/stores/notifications';
import {sendRPC} from '@/tools/websocket';

vi.mock('@/helpers/axios', () => ({
    default: {post: vi.fn()}
}));

vi.mock('@/helpers/domainErrors', () => ({
    toastRpcError: vi.fn()
}));

vi.mock('@/tools/uploadTickets', () => ({
    createUploadTicket: vi.fn()
}));

vi.mock('@/tools/websocket', () => ({
    onNotificationEvent: vi.fn(),
    sendRPC: vi.fn()
}));

function deferred<Result>() {
    let resolve!: (value: Result) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<Result>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return {promise, resolve, reject};
}

function inboxItem(
    id: number,
    state: 'read' | 'unread'
): NotificationInboxItem {
    return {
        id,
        state,
        createdAt: '2026-05-22T00:00:00.000Z',
        updatedAt: null,
        severity: 'info',
        title: 'Device event',
        body: 'Body',
        alertId: null,
        deliveryJobId: null,
        metadata: {}
    } as NotificationInboxItem;
}

function deliveryJob(fields: Partial<DeliveryJob> = {}): DeliveryJob {
    return {
        id: 1,
        organizationId: 'org',
        alertId: null,
        inboxItemId: null,
        endpointId: 1,
        state: 'succeeded',
        createdAt: '2026-05-22T00:00:00.000Z',
        completedAt: null,
        attemptCount: 1,
        ...fields
    };
}

function apiChannel(fields: Partial<Channel> = {}): Channel {
    return {
        id: 10,
        organizationId: 'org',
        provider: 'email_smtp',
        name: 'Ops email',
        enabled: true,
        config: {mode: 'use_system_smtp'},
        secretState: {hasSecretFields: true},
        lastTestAt: '2026-05-22T00:00:00.000Z',
        lastTestStatus: 'success',
        lastDeliveryAt: null,
        lastDeliveryStatus: null,
        health: {
            consecutiveFailures: 0,
            lastSuccessAt: null,
            lastFailureAt: null,
            autoDisabledAt: null,
            disableReason: null
        },
        quietHours: null,
        createdAt: '2026-05-22T00:00:00.000Z',
        updatedAt: null,
        ...fields
    };
}

function routingPolicy(
    fields: Partial<NotificationRoutingPolicy> = {}
): NotificationRoutingPolicy {
    return {
        id: 20,
        organizationId: 'org',
        parentPolicyId: null,
        name: 'Critical',
        sortOrder: 1,
        labelMatchers: [],
        severityMatchers: ['critical'],
        resourceSelectors: [],
        contactPoints: [{channelId: 10}],
        groupingKeys: ['rule_id'],
        muteWindows: [],
        runtimeSilences: [],
        inhibitionRules: [],
        escalationStages: [],
        enabled: true,
        createdAt: '2026-05-22T00:00:00.000Z',
        updatedAt: null,
        ...fields
    };
}

async function waitForRpcCount(count: number): Promise<void> {
    for (let attempt = 0; attempt < 10; attempt++) {
        if (vi.mocked(sendRPC).mock.calls.length === count) return;
        await Promise.resolve();
    }
    expect(sendRPC).toHaveBeenCalledTimes(count);
}

describe('notifications store optimistic inbox state', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.resetAllMocks();
    });

    it('marks one notification read before the RPC resolves', async () => {
        const rpc = deferred<NotificationInboxItem>();
        vi.mocked(sendRPC).mockReturnValue(rpc.promise);
        const store = useNotificationsStore();
        store.inbox = {1: inboxItem(1, 'unread')};

        const command = store.markRead(1);

        expect(store.inbox[1].state).toBe('read');
        rpc.resolve(inboxItem(1, 'read'));
        await expect(command).resolves.toBe(true);
        expect(store.inbox[1].state).toBe('read');
    });

    it('rolls back one notification when mark read fails', async () => {
        vi.mocked(sendRPC).mockRejectedValue(new Error('denied'));
        const store = useNotificationsStore();
        store.inbox = {1: inboxItem(1, 'unread')};

        await expect(store.markRead(1)).resolves.toBe(false);

        expect(store.inbox[1].state).toBe('unread');
        expect(toastRpcError).toHaveBeenCalledTimes(1);
    });

    it('marks one notification unread before the RPC resolves', async () => {
        const rpc = deferred<NotificationInboxItem>();
        vi.mocked(sendRPC).mockReturnValue(rpc.promise);
        const store = useNotificationsStore();
        store.inbox = {1: inboxItem(1, 'read')};

        const command = store.markUnread(1);

        expect(store.inbox[1].state).toBe('unread');
        rpc.resolve(inboxItem(1, 'unread'));
        await expect(command).resolves.toBe(true);
        expect(store.inbox[1].state).toBe('unread');
    });

    it('runs the latest inbox state filter after an active refresh', async () => {
        const first = deferred<{
            items: NotificationInboxItem[];
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        }>();
        const second = deferred<{
            items: NotificationInboxItem[];
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        }>();
        vi.mocked(sendRPC)
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        const store = useNotificationsStore();

        const firstFetch = store.fetchInbox('unread');
        const secondFetch = store.fetchInbox('read');

        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'notification.inbox.list',
            {state: 'unread', limit: 1000, offset: 0}
        );
        first.resolve({
            items: [inboxItem(1, 'unread')],
            total: 1,
            limit: 1000,
            offset: 0,
            has_more: false
        });
        await waitForRpcCount(2);
        expect(sendRPC).toHaveBeenLastCalledWith(
            'FLEET_MANAGER',
            'notification.inbox.list',
            {state: 'read', limit: 1000, offset: 0}
        );
        second.resolve({
            items: [inboxItem(2, 'read')],
            total: 1,
            limit: 1000,
            offset: 0,
            has_more: false
        });
        await Promise.all([firstFetch, secondFetch]);

        expect(store.inbox).toEqual({
            1: expect.objectContaining({state: 'unread'}),
            2: expect.objectContaining({state: 'read'})
        });
    });

    it('runs the latest delivery history filter after an active refresh', async () => {
        const first = deferred<{
            items: DeliveryJob[];
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        }>();
        const second = deferred<{
            items: DeliveryJob[];
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        }>();
        vi.mocked(sendRPC)
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        const store = useNotificationsStore();

        const firstFetch = store.fetchHistory({state: 'failed'});
        const secondFetch = store.fetchHistory({state: 'succeeded'});

        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'notification.history.list',
            {state: 'failed', limit: 1000, offset: 0}
        );
        first.resolve({
            items: [deliveryJob({id: 1, state: 'failed'})],
            total: 1,
            limit: 1000,
            offset: 0,
            has_more: false
        });
        await waitForRpcCount(2);
        expect(sendRPC).toHaveBeenLastCalledWith(
            'FLEET_MANAGER',
            'notification.history.list',
            {state: 'succeeded', limit: 1000, offset: 0}
        );
        second.resolve({
            items: [deliveryJob({id: 2, state: 'succeeded'})],
            total: 1,
            limit: 1000,
            offset: 0,
            has_more: false
        });
        await Promise.all([firstFetch, secondFetch]);

        expect(store.history).toEqual({
            2: expect.objectContaining({state: 'succeeded'})
        });
    });

    it('loads and saves reusable notification channels through Channel', async () => {
        vi.mocked(sendRPC)
            .mockResolvedValueOnce({items: [apiChannel()]})
            .mockResolvedValueOnce(
                apiChannel({id: 11, provider: 'slack_webhook', name: 'Slack'})
            );
        const store = useNotificationsStore();

        await store.fetchChannels();
        const saved = await store.saveChannel({
            name: 'Slack',
            type: 'slack_webhook',
            config: {urlSecretRef: 'secret'}
        });

        expect(sendRPC).toHaveBeenNthCalledWith(
            1,
            'FLEET_MANAGER',
            'channel.list',
            {}
        );
        expect(sendRPC).toHaveBeenNthCalledWith(
            2,
            'FLEET_MANAGER',
            'channel.create',
            {
                provider: 'slack_webhook',
                name: 'Slack',
                config: {urlSecretRef: 'secret'}
            }
        );
        expect(saved?.id).toBe(11);
        expect(Object.keys(store.channels)).toEqual(['10', '11']);
    });

    it('tests reusable notification channels through Channel', async () => {
        vi.mocked(sendRPC)
            .mockResolvedValueOnce({items: [apiChannel()]})
            .mockResolvedValueOnce({
                channelId: 10,
                state: 'success',
                testedAt: '2026-05-25T10:00:00.000Z',
                errorMessage: null
            });
        const store = useNotificationsStore();

        await store.fetchChannels();
        const result = await store.testChannel(10);

        expect(sendRPC).toHaveBeenNthCalledWith(
            2,
            'FLEET_MANAGER',
            'channel.test',
            {id: 10, dryRun: false}
        );
        expect(result?.state).toBe('success');
        expect(store.channels[10]).toEqual(
            expect.objectContaining({
                lastTestStatus: 'success',
                lastDeliveryStatus: 'success',
                lastDeliveryAt: '2026-05-25T10:00:00.000Z'
            })
        );
    });

    it('loads and saves routing policies through Notification.Routing', async () => {
        vi.mocked(sendRPC)
            .mockResolvedValueOnce({items: [routingPolicy()]})
            .mockResolvedValueOnce(routingPolicy({id: 21, name: 'Warnings'}));
        const store = useNotificationsStore();
        const draft = {
            name: 'Warnings',
            labelMatchers: [],
            severityMatchers: ['warning'],
            resourceSelectors: [],
            contactPoints: [{channelId: 10}],
            groupingKeys: ['rule_id'],
            muteWindows: [],
            runtimeSilences: [],
            inhibitionRules: [],
            escalationStages: []
        };

        await store.fetchRoutingPolicies();
        const saved = await store.saveRoutingPolicy(draft);

        expect(sendRPC).toHaveBeenNthCalledWith(
            1,
            'FLEET_MANAGER',
            'notification.routing.list',
            {enabledOnly: false}
        );
        expect(sendRPC).toHaveBeenNthCalledWith(
            2,
            'FLEET_MANAGER',
            'notification.routing.set',
            draft
        );
        expect(saved?.id).toBe(21);
        expect(Object.keys(store.routingPolicies)).toEqual(['20', '21']);
    });

    it('sends bundle import mappings with the backend contract field names', async () => {
        vi.mocked(sendRPC).mockResolvedValue({dryRun: true, operations: []});
        const store = useNotificationsStore();
        const bundle = {schema: 'fm.notification.bundle', version: 1};

        await store.planBundleImport(bundle, {'ops-email': 55});
        await store.applyBundleImport({
            bundle,
            channelMappings: {'ops-email': 55}
        });

        expect(sendRPC).toHaveBeenNthCalledWith(
            1,
            'FLEET_MANAGER',
            'notification.bundle.planimport',
            {bundle, channelMappings: {'ops-email': 55}}
        );
        expect(sendRPC).toHaveBeenNthCalledWith(
            2,
            'FLEET_MANAGER',
            'notification.bundle.applyimport',
            {bundle, channelMappings: {'ops-email': 55}}
        );
    });

    it('sends external bundle adapter input as config', async () => {
        vi.mocked(sendRPC).mockResolvedValue({dryRun: true, bundle: {}});
        const store = useNotificationsStore();
        const config = {contactPoints: []};

        await store.importGrafanaBundle(config);
        await store.importAlertmanagerBundle(config);

        expect(sendRPC).toHaveBeenNthCalledWith(
            1,
            'FLEET_MANAGER',
            'notification.bundle.importgrafana',
            {config}
        );
        expect(sendRPC).toHaveBeenNthCalledWith(
            2,
            'FLEET_MANAGER',
            'notification.bundle.importalertmanager',
            {config}
        );
    });
});
