/** Shared calibration state for Light + Cover. The callers own their own
 *  signal-watchers (status.calibration vs status.state) because the signals
 *  differ per device family — but the state, action, and timeout/cleanup
 *  pattern are identical, so they live here.
 *
 *  Each caller wires up its own watchers that invoke finishCalibration()
 *  when the device-reported signal indicates completion or error. */

import {onUnmounted, type Ref, ref} from 'vue';
import {useEntityStore} from '@/stores/entities';

interface UseDeviceCalibrationOptions {
    /** Reactive getter for the entity id (return undefined if unavailable). */
    entityId: () => string | undefined;
    /** Hard ceiling — defaults to 120s (Light); Cover passes 180_000. */
    timeoutMs?: number;
    /** External error ref the composable writes into on timeout / RPC failure. */
    configError: Ref<string | null>;
}

export function useDeviceCalibration(opts: UseDeviceCalibrationOptions) {
    const entityStore = useEntityStore();
    const isCalibrating = ref(false);
    const calibrationProgress = ref<number | null>(null);
    let timeout: ReturnType<typeof setTimeout> | null = null;

    function clearCalibrationTimeout() {
        if (timeout) {
            clearTimeout(timeout);
            timeout = null;
        }
    }

    /** Mark calibration finished — used by callers from their device-specific watchers. */
    function finishCalibration() {
        isCalibrating.value = false;
        calibrationProgress.value = null;
        clearCalibrationTimeout();
    }

    async function calibrate() {
        const eid = opts.entityId();
        if (!eid) return;
        isCalibrating.value = true;
        calibrationProgress.value = 0;
        opts.configError.value = null;
        clearCalibrationTimeout();
        const ms = opts.timeoutMs ?? 120_000;
        timeout = setTimeout(() => {
            if (isCalibrating.value) {
                finishCalibration();
                opts.configError.value = 'Calibration timed out';
            }
        }, ms);
        try {
            await entityStore.invokeAction(eid, 'calibrate');
        } catch (e: any) {
            opts.configError.value = e?.message || 'Calibration failed';
            finishCalibration();
        }
    }

    onUnmounted(clearCalibrationTimeout);

    return {
        isCalibrating,
        calibrationProgress,
        calibrate,
        finishCalibration
    };
}
