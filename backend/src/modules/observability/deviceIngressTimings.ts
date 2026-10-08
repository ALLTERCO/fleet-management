import {Histogram} from 'prom-client';
import {registry} from './registry';
import {getLevel} from './samplers';

const ingressElapsed = new Histogram({
    name: 'fm_device_ingress_elapsed_seconds',
    help: 'Wall time from device WebSocket connect to each ingress stage',
    labelNames: ['stage'] as const,
    buckets: [
        0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60,
        120
    ],
    registers: [registry]
});

export function recordDeviceIngressElapsed(
    stage: string,
    elapsedMs: number
): void {
    if (getLevel() < 2 || elapsedMs < 0) return;
    ingressElapsed.observe({stage}, elapsedMs / 1000);
}
