import {onScopeDispose, watch} from 'vue';
import {useDevicesStore} from '@/stores/devices';

// A gateway config write returns the moment the firmware acknowledges it, but
// the copy every list reads from is the persisted snapshot, and that trails by
// the persist debounce (FM_PERSIST_DEBOUNCE_MS, 5s by default). Reload straight
// after the write and you re-read the old value — the edit looks rejected and
// the field snaps back.
//
// So: wait for the settings to come back changed, then reload.
const DEFAULT_TIMEOUT_MS = 3000;

export function useDeviceSettingsSettled() {
    let timer: ReturnType<typeof setTimeout> | undefined;

    onScopeDispose(() => {
        if (timer) clearTimeout(timer);
    });

    /**
     * Resolves when the device's settings next change, or on timeout.
     *
     * Timing out still resolves: a gateway that never reports back should
     * leave the caller with a stale list, not a spinner that never stops.
     */
    function whenSettled(
        shellyID: string,
        timeoutMs: number = DEFAULT_TIMEOUT_MS
    ): Promise<void> {
        const devices = useDevicesStore();
        return new Promise((resolve) => {
            const stop = watch(
                () => devices.devices[shellyID]?.settings,
                () => finish(),
                {deep: true}
            );

            function finish(): void {
                stop();
                if (timer) {
                    clearTimeout(timer);
                    timer = undefined;
                }
                resolve();
            }

            timer = setTimeout(finish, timeoutMs);
        });
    }

    return {whenSettled};
}
