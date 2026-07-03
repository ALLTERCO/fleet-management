/**
 * motion_detected — state-based clear; opt-in timer via config.clearTimeoutSec.
 *
 * Schema source of truth: CLEAR_TIMEOUT_CONFIG_SCHEMA in
 * backend/src/types/api/alert.ts.
 */
import type {Signal} from '../signals';
import {makeSensorAlarmEvaluator} from './sensorAlarmEvaluator';
import {readBoolean} from './shared';

/** Seconds before timer-based auto-resolve, or null to rely on device. */
export function motionClearTimeoutSec(
    config: Record<string, unknown>
): number | null {
    const v = config.clearTimeoutSec;
    return typeof v === 'number' && v > 0 ? v : null;
}

function signalHasMotion(signal: Signal): string | null {
    // BLU: signals.ts emits {motion: value} for a Motion sensor.
    if (readBoolean(signal.status, 'motion') === true) return 'motion';
    if (readBoolean(signal.status, 'presence') === true) return 'presence';
    if (readBoolean(signal.status, 'occupancy') === true) return 'occupancy';
    // Native: any top-level status component with .motion === true.
    for (const [key, component] of Object.entries(signal.status)) {
        if (!component || typeof component !== 'object') continue;
        if (readBoolean(component, 'motion') === true) return key;
    }
    return null;
}

function signalMotionClear(signal: Signal): boolean {
    const direct = readBoolean(signal.status, 'motion');
    if (direct === false) return true;
    if (direct === true) return false;
    const presence = readBoolean(signal.status, 'presence');
    if (presence === false) return true;
    if (presence === true) return false;
    const occupancy = readBoolean(signal.status, 'occupancy');
    if (occupancy === false) return true;
    if (occupancy === true) return false;
    // No direct `motion` key — walk components looking for motion fields.
    let sawField = false;
    for (const [, component] of Object.entries(signal.status)) {
        if (!component || typeof component !== 'object') continue;
        const v = readBoolean(component, 'motion');
        if (v === null) continue;
        sawField = true;
        if (v === true) return false;
    }
    return sawField;
}

export const motionDetectedEvaluator = makeSensorAlarmEvaluator({
    kind: 'motion_detected',
    detect: signalHasMotion,
    isClear: signalMotionClear,
    title: (signal) => `${signal.displayName} motion detected`,
    message: (signal, channel) =>
        `Motion detected on ${signal.displayName}${channel !== 'motion' ? ` channel ${channel}` : ''}.`
});
