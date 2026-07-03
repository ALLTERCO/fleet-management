/** flood_alarm — fires on any flood channel or BLU Flood/Moisture sensor. */
import type {Signal} from '../signals';
import {makeSensorAlarmEvaluator} from './sensorAlarmEvaluator';
import {collectChannels, readBoolean} from './shared';

function signalHasFlood(signal: Signal): string | null {
    if (readBoolean(signal.status, 'flood') === true) return 'flood';
    for (const ch of collectChannels(signal.status, 'flood:')) {
        if (readBoolean(ch.component, 'alarm') === true) return ch.idx;
    }
    return null;
}

// true = explicitly clear, null = no alarm field (indeterminate), false = firing.
function signalFloodClear(signal: Signal): boolean | null {
    const topLevel = readBoolean(signal.status, 'flood');
    const topLevelAlarm = readBoolean(signal.status, 'alarm');
    const channels = collectChannels(signal.status, 'flood:');
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

export const floodAlarmEvaluator = makeSensorAlarmEvaluator({
    kind: 'flood_alarm',
    detect: signalHasFlood,
    isClear: (signal) => signalFloodClear(signal) === true,
    title: (signal) => `${signal.displayName} water leak`,
    message: (signal, channel) =>
        `Flood detected on ${signal.displayName}${channel !== 'flood' ? ` channel ${channel}` : ''}.`,
    severity: 'critical'
});
