import {describe, expect, it, vi} from 'vitest';
import {
    reconcileAcceptedDevices,
    removeWaitingRoomEntries,
    shouldPublishPendingCount
} from '@/composables/waitingRoomLocalState';

describe('waitingRoomLocalState', () => {
    it('removes accepted entries and returns the new count', () => {
        const devices = {
            '1': {shellyID: 'shelly-a'},
            '2': {shellyID: 'shelly-b'}
        };

        const result = removeWaitingRoomEntries(devices, ['1']);

        expect(result.devices).toEqual({'2': {shellyID: 'shelly-b'}});
        expect(result.count).toBe(1);
    });

    it('does not mutate the original waiting-room snapshot', () => {
        const devices = {
            '1': {shellyID: 'shelly-a'},
            '2': {shellyID: 'shelly-b'}
        };

        removeWaitingRoomEntries(devices, ['1']);

        expect(devices).toEqual({
            '1': {shellyID: 'shelly-a'},
            '2': {shellyID: 'shelly-b'}
        });
    });

    it('publishes sidebar counts only for the pending waiting-room view', () => {
        expect(shouldPublishPendingCount('pending')).toBe(true);
        expect(shouldPublishPendingCount('denied')).toBe(false);
    });

    it('keeps waiting-room UI flow alive when device reconciliation throws', async () => {
        const reconciler = {
            reconcileDevicesFromBackend: vi
                .fn()
                .mockRejectedValue(new Error('device refresh failed'))
        };

        await expect(
            reconcileAcceptedDevices(reconciler)
        ).resolves.toBeUndefined();
        expect(reconciler.reconcileDevicesFromBackend).toHaveBeenCalledWith(
            'waiting-room'
        );
    });

    it('re-checks over a window so a slow-to-register device is still caught', async () => {
        vi.useFakeTimers();
        try {
            const reconciler = {
                reconcileDevicesFromBackend: vi
                    .fn()
                    .mockResolvedValue(undefined)
            };
            await reconcileAcceptedDevices(reconciler);
            // Immediate pass.
            expect(
                reconciler.reconcileDevicesFromBackend
            ).toHaveBeenCalledTimes(1);
            // Backstop passes across the window catch a device that registers late.
            await vi.advanceTimersByTimeAsync(20_000);
            expect(
                reconciler.reconcileDevicesFromBackend.mock.calls.length
            ).toBeGreaterThan(2);
        } finally {
            vi.useRealTimers();
        }
    });
});
