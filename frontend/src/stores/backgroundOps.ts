import {defineStore} from 'pinia';
import type {Raw} from 'vue';
import {computed, markRaw, reactive} from 'vue';
import type {Actor} from 'xstate';
import {assign, createActor, setup} from 'xstate';
import {BG_OPS_SNAPSHOT_KEY} from '@/constants';
import {useToastStore} from '@/stores/toast';
import * as ws from '@/tools/websocket';

export type JobType = 'firmware' | 'backup' | 'certificate';
export type JobStatus = 'running' | 'done' | 'failed' | 'cancelled';

type JobMachineContext = {
    doneCount: number;
    failCount: number;
    error?: string;
};

type JobMachineEvent =
    | {type: 'DEVICE_DONE'}
    | {type: 'DEVICE_FAILED'; error?: string}
    | {type: 'COMPLETE'}
    | {type: 'FAIL'; error: string}
    | {type: 'ABORT'};

const jobMachine = setup({
    types: {} as {
        context: JobMachineContext;
        events: JobMachineEvent;
        input: {doneCount?: number; failCount?: number};
    }
}).createMachine({
    id: 'job',
    initial: 'running',
    context: ({input}) => ({
        doneCount: input.doneCount ?? 0,
        failCount: input.failCount ?? 0,
        error: undefined
    }),
    states: {
        running: {
            on: {
                DEVICE_DONE: {
                    actions: assign({
                        doneCount: ({context}) => context.doneCount + 1
                    })
                },
                DEVICE_FAILED: {
                    actions: assign({
                        failCount: ({context}) => context.failCount + 1
                    })
                },
                COMPLETE: 'done',
                FAIL: {
                    target: 'failed',
                    actions: assign({error: ({event}) => event.error})
                },
                ABORT: 'cancelled'
            }
        },
        done: {type: 'final'},
        failed: {type: 'final'},
        cancelled: {type: 'final'}
    }
});

export type JobActor = Actor<typeof jobMachine>;

export interface JobRecord {
    id: string;
    type: JobType;
    label: string;
    deviceIds: string[];
    startedAt: number;
    endedAt?: number;
    status: JobStatus;
    // Reactive mirrors of actor context — updated via subscribe so Vue can track them
    doneCount: number;
    failCount: number;
    _actor: Raw<JobActor>;
}

type RegistrationLifecycle = {
    _cleanup?: () => void;
};

type StagedJobEvent = {
    applyTo: (actor: JobActor) => void;
};

// WS event binder strategy — one entry per event namespace.
const WS_BINDERS: Array<{
    match: (ev: string) => boolean;
    bind: (ev: string, handler: (e: unknown) => void) => () => void;
}> = [
    {
        match: (ev) => ev === 'ota_progress',
        bind: (_ev, handler) => ws.onOtaProgress(handler)
    },
    {
        match: (ev) => ev.startsWith('component_status.'),
        bind: (ev, handler) =>
            ws.onComponentStatus(ev.slice('component_status.'.length), handler)
    },
    {
        match: (ev) => ev === 'certificate_event',
        bind: (_ev, handler) => ws.onCertificateEvent(handler)
    }
];

function bindWsEvent(
    wsEvent: string,
    handler: (e: unknown) => void
): () => void {
    const binder = WS_BINDERS.find((b) => b.match(wsEvent));
    return binder ? binder.bind(wsEvent, handler) : () => {};
}

export const useBackgroundOpsStore = defineStore('backgroundOps', () => {
    const toast = useToastStore();
    const jobs = reactive(new Map<string, JobRecord>());
    const registrations = new Map<JobType, RegistrationLifecycle>();
    // Non-reactive staging — no Vue triggers during accumulation
    const _stagingMap = new Map<string, StagedJobEvent[]>();
    let _drainScheduled = false;
    // Active job id per type — for routing staged events
    const _activeJobByType = new Map<JobType, string>();
    // Debounce flag for localStorage writes
    let _savePending = false;

    function _scheduleFlush() {
        if (_drainScheduled) return;
        _drainScheduled = true;
        setTimeout(_flush, 0);
    }

    function _flush() {
        _drainScheduled = false;
        for (const [key, events] of _stagingMap) {
            _stagingMap.delete(key);
            const colonIdx = key.indexOf(':');
            const type = key.slice(0, colonIdx) as JobType;
            const jobId = _activeJobByType.get(type);
            if (!jobId) continue;
            const job = jobs.get(jobId);
            if (!job || job.status !== 'running') continue;
            for (const event of events) event.applyTo(job._actor);
        }
    }

    function _doSave() {
        _savePending = false;
        try {
            const data = Array.from(jobs.values()).map((j) => ({
                id: j.id,
                type: j.type,
                label: j.label,
                deviceIds: j.deviceIds,
                startedAt: j.startedAt,
                endedAt: j.endedAt,
                status: j.status,
                actorSnapshot: j._actor.getPersistedSnapshot()
            }));
            localStorage.setItem(BG_OPS_SNAPSHOT_KEY, JSON.stringify(data));
        } catch {
            // localStorage unavailable — skip
        }
    }

    // Batches multiple saves per event loop tick into one write
    function _saveSnapshot() {
        if (_savePending) return;
        _savePending = true;
        setTimeout(_doSave, 0);
    }

    function register<E>(config: {
        type: JobType;
        policy: 'keep-running' | 'cancel-on-nav';
        wsEvent: string;
        getId: (event: E) => string | undefined;
        apply: (actor: JobActor, event: E) => void;
    }) {
        const existing = registrations.get(config.type);
        if (existing?._cleanup) existing._cleanup();

        const handler = (event: unknown) => {
            const typedEvent = event as E;
            const shellyID = config.getId(typedEvent);
            if (!shellyID) return;
            const key = `${config.type}:${shellyID}`;
            const q = _stagingMap.get(key) ?? [];
            q.push({applyTo: (actor) => config.apply(actor, typedEvent)});
            _stagingMap.set(key, q);
            _scheduleFlush();
        };

        const cleanup = bindWsEvent(config.wsEvent, handler);
        registrations.set(config.type, {_cleanup: cleanup});
    }

    function _makeSubscribeCallback(
        id: string,
        record: JobRecord,
        actor: JobActor
    ) {
        return () => {
            const snap = actor.getSnapshot();
            record.doneCount = snap.context.doneCount;
            record.failCount = snap.context.failCount;
            // Re-set in Map so Vue's reactive Map tracks the value change
            jobs.set(id, record);
            _saveSnapshot();
        };
    }

    function startJob(opts: {
        type: JobType;
        deviceIds: string[];
        label: string;
    }): string {
        const id = `${opts.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const actor = createActor(jobMachine, {input: {}});

        const record: JobRecord = {
            id,
            type: opts.type,
            label: opts.label,
            deviceIds: opts.deviceIds,
            startedAt: Date.now(),
            status: 'running',
            doneCount: 0,
            failCount: 0,
            _actor: markRaw(actor)
        };

        jobs.set(id, record);
        _activeJobByType.set(opts.type, id);
        actor.start();
        actor.subscribe(_makeSubscribeCallback(id, record, actor));
        _saveSnapshot();
        return id;
    }

    function completeJob(id: string) {
        const job = jobs.get(id);
        if (!job || job.status !== 'running') return;
        job._actor.send({type: 'COMPLETE'});
        job.status = 'done';
        job.endedAt = Date.now();
        _activeJobByType.delete(job.type);
        jobs.set(id, job);
        _saveSnapshot();
        toast.success(`${job.label} complete`);
    }

    function failJob(id: string, error: string) {
        const job = jobs.get(id);
        if (!job || job.status !== 'running') return;
        job._actor.send({type: 'FAIL', error});
        job.status = 'failed';
        job.endedAt = Date.now();
        _activeJobByType.delete(job.type);
        jobs.set(id, job);
        _saveSnapshot();
        toast.error(`${job.label} failed: ${error}`);
    }

    function abortJob(id: string) {
        const job = jobs.get(id);
        if (!job || job.status !== 'running') return;
        job._actor.send({type: 'ABORT'});
        job.status = 'cancelled';
        job.endedAt = Date.now();
        _activeJobByType.delete(job.type);
        jobs.set(id, job);
        _saveSnapshot();
    }

    function activeJobFor(type: JobType): JobRecord | undefined {
        const id = _activeJobByType.get(type);
        return id ? jobs.get(id) : undefined;
    }

    // Send to a specific job's actor by id. Use over activeJobFor when the
    // event was started against a job that may no longer be the active one
    // by completion time (e.g. retryFailed aborts + starts a new job while
    // an in-flight RPC is still pending).
    function dispatchToJob(id: string | null, event: JobMachineEvent): void {
        if (!id) return;
        const job = jobs.get(id);
        if (!job || job.status !== 'running') return;
        job._actor.send(event);
    }

    function historyFor(type: JobType): JobRecord[] {
        return Array.from(jobs.values())
            .filter((j) => j.type === type && j.status !== 'running')
            .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
    }

    function progressFor(type: JobType): {
        done: number;
        failed: number;
        total: number;
    } {
        const job = activeJobFor(type);
        if (!job) return {done: 0, failed: 0, total: 0};
        return {
            done: job.doneCount,
            failed: job.failCount,
            total: job.deviceIds.length
        };
    }

    const activeJobCount = computed(
        () =>
            Array.from(jobs.values()).filter((j) => j.status === 'running')
                .length
    );

    function restoreFromSnapshot() {
        // Pinia setup runs once per app instance, but HMR / test mode
        // can re-create the store with non-empty `jobs` already populated.
        if (jobs.size > 0) return;
        try {
            const raw = localStorage.getItem(BG_OPS_SNAPSHOT_KEY);
            if (!raw) return;
            const data = JSON.parse(raw) as Array<{
                id: string;
                type: JobType;
                label: string;
                deviceIds: string[];
                startedAt: number;
                endedAt?: number;
                status: JobStatus;
                actorSnapshot: any;
            }>;
            for (const d of data) {
                // Running jobs cannot be resumed after a page reload —
                // their WS subscriptions are gone. Mark them cancelled.
                const status: JobStatus =
                    d.status === 'running' ? 'cancelled' : d.status;
                const actor = createActor(jobMachine, {
                    input: {},
                    snapshot: d.actorSnapshot
                });
                actor.start();
                // Align actor state with the cancelled status
                if (status === 'cancelled' && d.status === 'running') {
                    actor.send({type: 'ABORT'});
                }
                const actorSnap = actor.getSnapshot();
                const record: JobRecord = {
                    id: d.id,
                    type: d.type,
                    label: d.label,
                    deviceIds: d.deviceIds,
                    startedAt: d.startedAt,
                    endedAt: d.endedAt ?? Date.now(),
                    status,
                    doneCount: actorSnap.context.doneCount,
                    failCount: actorSnap.context.failCount,
                    _actor: markRaw(actor)
                };
                actor.subscribe(_makeSubscribeCallback(d.id, record, actor));
                jobs.set(d.id, record);
            }
        } catch {
            // Corrupt snapshot — start clean
            localStorage.removeItem(BG_OPS_SNAPSHOT_KEY);
        }
    }

    restoreFromSnapshot();

    return {
        jobs,
        register,
        startJob,
        completeJob,
        failJob,
        abortJob,
        activeJobFor,
        dispatchToJob,
        historyFor,
        progressFor,
        activeJobCount
    };
});
