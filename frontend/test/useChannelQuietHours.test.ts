import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const {sendRPC, toastError} = vi.hoisted(() => ({
    sendRPC: vi.fn(),
    toastError: vi.fn()
}));

vi.mock('@/tools/websocket', () => ({sendRPC}));
vi.mock('@/stores/toast', () => ({
    useToastStore: () => ({error: toastError})
}));

import type {Channel} from '@api/channel';
import {useChannelQuietHours} from '@/composables/useChannelQuietHours';

function channel(
    overrides: Partial<Channel> = {}
): Channel {
    return {
        id: 1,
        organizationId: 'org',
        provider: 'slack_webhook',
        name: 'Ops Slack',
        enabled: true,
        config: {},
        secretState: {hasSecretFields: false},
        lastTestAt: null,
        lastTestStatus: null,
        lastDeliveryStatus: null,
        lastDeliveryAt: null,
        health: {
            consecutiveFailures: 0,
            lastSuccessAt: null,
            lastFailureAt: null,
            autoDisabledAt: null,
            disableReason: null
        },
        quietHours: null,
        createdAt: '2026-05-01T00:00:00Z',
        updatedAt: null,
        ...overrides
    };
}

describe('useChannelQuietHours', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        sendRPC.mockReset();
        toastError.mockReset();
    });

    it('starts with an empty form', () => {
        const q = useChannelQuietHours();
        expect(q.form.value).toEqual({start: '', end: '', timezone: ''});
        expect(q.buildPatch()).toBe(null);
    });

    it('load() with a null channel leaves form empty', async () => {
        const q = useChannelQuietHours();
        await q.load(null);
        expect(q.buildPatch()).toBe(null);
        expect(sendRPC).not.toHaveBeenCalled();
    });

    it('load() with a null channel skips fetch', async () => {
        const q = useChannelQuietHours();
        await q.load(null);
        expect(sendRPC).not.toHaveBeenCalled();
        expect(q.buildPatch()).toBe(null);
    });

    it('load() populates form from the fetched endpoint quietHours', async () => {
        sendRPC.mockResolvedValueOnce({
            id: 42,
            organizationId: 'org',
            provider: 'slack_webhook',
            name: 'Ops',
            enabled: true,
            config: {},
            secretState: {hasSecretFields: false},
            quietHours: {
                startHour: 22,
                endHour: 7,
                timezone: 'America/New_York'
            }
        });
        const q = useChannelQuietHours();
        await q.load(channel());
        expect(q.form.value).toEqual({
            start: '22',
            end: '7',
            timezone: 'America/New_York'
        });
    });

    it('buildPatch() rejects out-of-range hours', () => {
        const q = useChannelQuietHours();
        q.form.value = {start: '25', end: '10', timezone: 'UTC'};
        expect(q.buildPatch()).toBe(null);
    });

    it('buildPatch() returns a valid patch + defaults missing timezone to UTC', () => {
        const q = useChannelQuietHours();
        q.form.value = {start: '20', end: '8', timezone: ''};
        expect(q.buildPatch()).toEqual({
            startHour: 20,
            endHour: 8,
            timezone: 'UTC'
        });
    });

    it('clear() resets the form', () => {
        const q = useChannelQuietHours();
        q.form.value = {start: '20', end: '8', timezone: 'Europe/Sofia'};
        q.clear();
        expect(q.form.value).toEqual({start: '', end: '', timezone: ''});
    });
});
