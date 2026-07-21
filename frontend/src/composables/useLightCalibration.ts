import {type ComputedRef, computed} from 'vue';

// Shared calibration state for the light cards (dimmer + RGBW/CCT). A dimmable
// Light rejects brightness until calibrated (status flag 'uncalibrated'); while
// calibrating it reports a `calibration` object. Controls stay locked until it
// is calibrated so the user never hits the device's "not calibrated" error.

export function useLightCalibration(
    status: ComputedRef<Record<string, any> | null>,
    canExecute: ComputedRef<boolean>
) {
    const needsCalibration = computed(() =>
        ((status.value?.flags as string[] | undefined) ?? []).includes(
            'uncalibrated'
        )
    );
    const isCalibrating = computed(() => !!status.value?.calibration);
    const calibrationProgress = computed(() => {
        // Shelly docs spell the field 'progess'; accept both.
        const c = status.value?.calibration as
            | {progress?: number; progess?: number}
            | undefined;
        return Math.round(Number(c?.progress ?? c?.progess ?? 0));
    });
    const controlsDisabled = computed(
        () => !canExecute.value || needsCalibration.value || isCalibrating.value
    );

    return {
        needsCalibration,
        isCalibrating,
        calibrationProgress,
        controlsDisabled
    };
}
