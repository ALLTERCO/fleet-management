// Per-device event-rate tracker. EWMA-smoothed; flag with hysteresis.
import {tuning} from '../../config';
import {BoundedMap} from '../boundedMap';
import * as Observability from '../Observability';

interface DeviceState {
    rateHz: number;
    lastTickMs: number;
    anomalous: boolean;
}

const tracked = new BoundedMap<string, DeviceState>({
    maxSize: tuning.device.rateTrackedMax
});

let anomalousCount = 0;

Observability.registerModule('deviceAnomaly', {
    stats: () => ({
        tracked: tracked.size,
        currentAnomalous: anomalousCount,
        thresholdHz: tuning.device.rateAnomalyHz,
        recoveryHz: tuning.device.rateRecoveryHz,
        instantCapHz: tuning.device.rateInstantCapHz
    }),
    topology: {
        role: 'transform',
        cluster: 'pipeline',
        upstreams: ['statusQueue'],
        label: 'Anomaly Detection',
        description: 'Per-device rate anomaly tracker',
        route: '/monitoring/events'
    }
});

export function recordEvent(shellyID: string, nowMs = Date.now()): void {
    const alpha = tuning.device.rateEwmaAlpha;
    const prev = tracked.get(shellyID);
    let rate: number;
    if (!prev) {
        rate = 1;
    } else {
        const dt = Math.max(1, nowMs - prev.lastTickMs);
        const instant = Math.min(1000 / dt, tuning.device.rateInstantCapHz);
        rate = alpha * instant + (1 - alpha) * prev.rateHz;
    }
    const wasAnomalous = prev?.anomalous ?? false;
    const nowAnomalous = wasAnomalous
        ? rate > tuning.device.rateRecoveryHz
        : rate > tuning.device.rateAnomalyHz;
    if (nowAnomalous && !wasAnomalous) {
        Observability.incrementCounter('device_anomaly_transitions_total');
        anomalousCount++;
    } else if (!nowAnomalous && wasAnomalous) {
        anomalousCount = Math.max(0, anomalousCount - 1);
    }
    tracked.set(shellyID, {
        rateHz: rate,
        lastTickMs: nowMs,
        anomalous: nowAnomalous
    });
}

export function getRate(shellyID: string): number {
    return tracked.get(shellyID)?.rateHz ?? 0;
}

export function isAnomalous(shellyID: string): boolean {
    return tracked.get(shellyID)?.anomalous ?? false;
}

export function trackedSize(): number {
    return tracked.size;
}

export function currentAnomalousCount(): number {
    return anomalousCount;
}

export function resetForTests(): void {
    for (const k of [...tracked.keys()]) tracked.delete(k);
    anomalousCount = 0;
}
