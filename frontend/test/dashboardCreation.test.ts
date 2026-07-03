// Dashboard.Create call shapes — must match DASHBOARD_CREATE_PARAMS_SCHEMA.
import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const {sendRPC} = vi.hoisted(() => ({sendRPC: vi.fn()}));
vi.mock('@/tools/websocket', () => ({sendRPC}));

import {useAnalyticsStore} from '@/stores/analytics';

describe('analytics store — dashboard creation', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        sendRPC.mockReset();
        sendRPC.mockResolvedValue({
            id: 42,
            organizationId: 'org',
            name: 'stub',
            dashboardType: 'analytics',
            locationId: null,
            groupId: null,
            tagId: null,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: null
        });
    });

    it('createAnalyticsDashboard sends {name, dashboardType: analytics, scope: {groupId}}', async () => {
        const store = useAnalyticsStore();
        await store.createAnalyticsDashboard('My Chart', 7);

        expect(sendRPC).toHaveBeenCalledTimes(1);
        const [ns, method, params] = sendRPC.mock.calls[0];
        expect(ns).toBe('FLEET_MANAGER');
        expect(method).toBe('dashboard.create');
        expect(params).toEqual({
            name: 'My Chart',
            dashboardType: 'analytics',
            scope: {groupId: 7}
        });
    });

    it('createDomainDashboard with groupId sends scope.groupId', async () => {
        const store = useAnalyticsStore();
        await store.createDomainDashboard('Energy', 'energy', 3);

        const [, , params] = sendRPC.mock.calls[0];
        expect(params).toEqual({
            name: 'Energy',
            dashboardType: 'energy',
            scope: {groupId: 3}
        });
    });

    it('createDomainDashboard without groupId omits scope entirely', async () => {
        const store = useAnalyticsStore();
        await store.createDomainDashboard('Overview', 'overview');

        const [, , params] = sendRPC.mock.calls[0];
        expect(params).toEqual({
            name: 'Overview',
            dashboardType: 'overview'
        });
        expect(params).not.toHaveProperty('scope');
    });

    it('createDomainDashboard with undefined groupId omits scope', async () => {
        const store = useAnalyticsStore();
        await store.createDomainDashboard('Safety', 'safety', undefined);

        const [, , params] = sendRPC.mock.calls[0];
        expect(params).not.toHaveProperty('scope');
    });

    it('covers all five domain dashboard types', async () => {
        const store = useAnalyticsStore();
        const types = [
            'overview',
            'energy',
            'environment',
            'control',
            'safety'
        ] as const;
        for (const type of types) {
            sendRPC.mockClear();
            await store.createDomainDashboard(`${type} board`, type, 1);
            const [, , params] = sendRPC.mock.calls[0];
            expect(params.dashboardType).toBe(type);
            expect(params.scope).toEqual({groupId: 1});
        }
    });

    it('propagates RPC errors to the caller', async () => {
        sendRPC.mockRejectedValue(new Error('dashboard.create failed'));
        const store = useAnalyticsStore();
        await expect(store.createAnalyticsDashboard('X', 1)).rejects.toThrow(
            'dashboard.create failed'
        );
    });

    it('returns the full Dashboard response shape from the server', async () => {
        sendRPC.mockResolvedValue({
            id: 999,
            organizationId: 'org-a',
            name: 'Full Fields',
            dashboardType: 'energy',
            locationId: null,
            groupId: 7,
            tagId: null,
            createdAt: '2026-04-21T00:00:00Z',
            updatedAt: '2026-04-21T01:00:00Z'
        });
        const store = useAnalyticsStore();
        const result = await store.createDomainDashboard(
            'Full Fields',
            'energy',
            7
        );

        expect(result.id).toBe(999);
        expect(result.groupId).toBe(7);
        expect(result.createdAt).toBe('2026-04-21T00:00:00Z');
        expect(result.updatedAt).toBe('2026-04-21T01:00:00Z');
    });
});
