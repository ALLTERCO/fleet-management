import log4js from 'log4js';
import {tuning} from '../../config/tuning';
import * as Observability from '../Observability';
import {createLeaderPollWorker} from '../worker/leaderPollWorker';
import {runRetentionCleanup} from './deviceIngressRepository';

const logger = log4js.getLogger('device-ingress-cleanup');
const LEADER_NAME = 'device-ingress-cleanup';

const worker = createLeaderPollWorker({
    leaderName: LEADER_NAME,
    logger,
    pollIntervalMs: () => tuning.deviceIngress.cleanupIntervalMs,
    tick: runCleanup
});

export async function startDeviceIngressCleanup(): Promise<void> {
    await worker.start();
}

export function stopDeviceIngressCleanup(): void {
    worker.stop();
}

export async function runCleanup(): Promise<void> {
    const result = await runRetentionCleanup({
        waitingRoomRetentionDays: tuning.deviceIngress.waitingRoomRetentionDays,
        connectionHistoryRetentionDays:
            tuning.deviceIngress.connectionHistoryRetentionDays
    });
    Observability.incrementCounter(
        'fm_device_ingress_cleanup_rows',
        result.expiredCredentials +
            result.expiredSetupSessions +
            result.expiredWaitingRoomEntries +
            result.disconnectedConnections
    );
}
