/** smoke_alarm — fires on any smoke channel or BLU smoke sensor reporting alarm. */
import type {Signal} from '../signals';
import {makeSensorAlarmEvaluator} from './sensorAlarmEvaluator';
import {collectChannels, readBoolean} from './shared';

function signalHasSmoke(signal: Signal): string | null {
    // BLU: signals.ts emits {smoke: value} for Smoke sensors.
    if (readBoolean(signal.status, 'smoke') === true) return 'smoke';
    for (const ch of collectChannels(signal.status, 'smoke:')) {
        if (readBoolean(ch.component, 'alarm') === true) return ch.idx;
    }
    return null;
}

// true = explicitly clear, null = no alarm field (indeterminate), false = firing.
function signalSmokeClear(signal: Signal): boolean | null {
    const topLevel = readBoolean(signal.status, 'smoke');
    const topLevelAlarm = readBoolean(signal.status, 'alarm');
    const channels = collectChannels(signal.status, 'smoke:');
    const channelValues = channels.map((ch) =>
        readBoolean(ch.component, 'alarm')
    );
    const hasAnyField =
        topLevel !== null ||
        topLevelAlarm !== null ||
        channelValues.some((v) => v !== null);
    if (!hasAnyField) return null;
    if (topLevel === true || topLevelAlarm === true) return false;
    if (channelValues.some((v) => v === true)) return false;
    return true;
}

export const smokeAlarmEvaluator = makeSensorAlarmEvaluator({
    kind: 'smoke_alarm',
    detect: signalHasSmoke,
    isClear: (signal) => signalSmokeClear(signal) === true,
    title: (signal) => `${signal.displayName} smoke alarm`,
    message: (signal, channel) =>
        `Smoke detected on ${signal.displayName}${channel !== 'smoke' ? ` channel ${channel}` : ''}.`,
    severity: 'critical'
});
