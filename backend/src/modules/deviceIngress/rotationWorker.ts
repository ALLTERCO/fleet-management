// Token rotation worker. Leader-gated, paced by rotationInFlight, restart-safe.
import log4js from 'log4js';
import {tuning} from '../../config/tuning';
import * as DeviceCollector from '../DeviceCollector';
import {formatError} from '../util/formatError';
import {runBoundedParallel} from '../util/runBoundedParallel';
import {createLeaderPollWorker} from '../worker/leaderPollWorker';
import {deviceKeysChecked} from './authMethods';
import * as repository from './deviceIngressRepository';
import {requirePublicWsBaseUrl} from './publicWsBaseUrl';
import {
    claimQueuedJobs,
    countJobsInState,
    findOpenJobByCredential,
    markStaleSentWaiting,
    type RotationJob,
    recordJobCredential,
    resumeRecordedJob,
    setJobState
} from './rotationJobRepository';
import {runRotationJob} from './rotationRunner';

const logger = log4js.getLogger('device-ingress-rotation');
const LEADER_NAME = 'device-ingress-rotation-worker';

export interface RotationTickDeps {
    requirePublicWsBaseUrl: () => string;
    markStaleSentWaiting: (input: {
        olderThanMs: number;
    }) => Promise<RotationJob[]>;
    countJobsInState: (state: 'sent') => Promise<number>;
    claimQueuedJobs: (input: {
        limit: number;
        staleClaimMs: number;
    }) => Promise<RotationJob[]>;
    runJob: (job: RotationJob) => Promise<RotationJob | null>;
    inFlight: () => number;
    waitCapMs: () => number;
    staleClaimMs: () => number;
    keysChecked: () => boolean;
}

// Logged once per process: repeating it every poll would drown the log for a
// condition that only a config change (or a restart) can fix.
let warnedKeysNotChecked = false;

export async function runRotationTick(deps: RotationTickDeps): Promise<number> {
    // Fail the whole tick, not one key per job: an unconfigured base URL would
    // mint a credential the device can never reach and then revoke it.
    deps.requirePublicWsBaseUrl();
    const waited = await deps.markStaleSentWaiting({
        olderThanMs: deps.waitCapMs()
    });
    if (waited.length > 0) {
        logger.info('%d rotation jobs moved to waiting', waited.length);
    }
    if (!deps.keysChecked()) {
        if (!warnedKeysNotChecked) {
            warnedKeysNotChecked = true;
            logger.warn(
                'rotation jobs wait: this server does not check device keys'
            );
        }
        return 0;
    }
    const busy = await deps.countJobsInState('sent');
    const free = deps.inFlight() - busy;
    if (free <= 0) return 0;
    const jobs = await deps.claimQueuedJobs({
        limit: free,
        staleClaimMs: deps.staleClaimMs()
    });
    if (jobs.length === 0) return 0;
    const results = await runBoundedParallel({
        tasks: jobs,
        run: deps.runJob,
        concurrency: free,
        perTaskTimeoutMs: tuning.deviceIngress.rotationSendTimeoutMs * 2,
        label: 'device-ingress-rotation'
    });
    logRejections(jobs, results);
    return jobs.length;
}

function logRejections(
    jobs: readonly RotationJob[],
    results: readonly PromiseSettledResult<RotationJob | null>[]
): void {
    for (const [index, result] of results.entries()) {
        if (result.status !== 'rejected') continue;
        logger.error(
            'rotation job %s failed: %s',
            jobs[index]?.id,
            formatError(result.reason)
        );
    }
}

function waitCapMs(): number {
    return tuning.deviceIngress.rotationWaitCapMinutes * 60_000;
}

const liveDeps: RotationTickDeps = {
    requirePublicWsBaseUrl,
    markStaleSentWaiting,
    countJobsInState,
    claimQueuedJobs,
    runJob: (job) =>
        runRotationJob(job, {
            jobs: {
                setJobState,
                recordJobCredential,
                resumeRecordedJob,
                findOpenJobByCredential
            },
            credentials: repository,
            identities: repository,
            getDevice: (externalId) => DeviceCollector.getDevice(externalId),
            sendTimeoutMs: () => tuning.deviceIngress.rotationSendTimeoutMs
        }),
    inFlight: () => tuning.deviceIngress.rotationInFlight,
    waitCapMs,
    // Four send timeouts: two for the bounded-parallel task cap, doubled so a
    // tick that is merely slow is never mistaken for one that died.
    staleClaimMs: () => tuning.deviceIngress.rotationSendTimeoutMs * 4,
    keysChecked: () =>
        deviceKeysChecked({
            enabled: tuning.deviceIngress.enabled,
            enforcementMode: tuning.deviceIngress.enforcementMode
        })
};

const worker = createLeaderPollWorker({
    leaderName: LEADER_NAME,
    logger,
    pollIntervalMs: () => tuning.deviceIngress.rotationPollMs,
    tick: () => runRotationTick(liveDeps)
});

export type RotationWorkerStartState =
    | 'ok'
    | 'disabled'
    | 'no_public_ws_base_url';

export function rotationWorkerStartState(): RotationWorkerStartState {
    if (!tuning.deviceIngress.rotationEnabled) return 'disabled';
    if (!tuning.deviceIngress.publicWsBaseUrl.trim()) {
        return 'no_public_ws_base_url';
    }
    return 'ok';
}

export async function start(): Promise<void> {
    const state = rotationWorkerStartState();
    if (state === 'disabled') return;
    // Warn once at boot instead of throwing from every tick forever.
    if (state === 'no_public_ws_base_url') {
        logger.warn(
            'device ingress rotation stays off until FM_DEVICE_INGRESS_PUBLIC_WS_BASE_URL is set'
        );
        return;
    }
    await worker.start();
}

export const stop = worker.stop;

export async function __tickForTests(): Promise<void> {
    await worker.tickOnce();
}
