import type {OperationJobListResponse, OperationJobSnapshot} from '@api/job';
import {defineStore} from 'pinia';
import {computed, reactive} from 'vue';
import {debugWarn} from '@/tools/debug';
import * as ws from '../tools/websocket';

export type BackendJobKind =
    | 'certificate'
    | 'credential'
    | 'firmware'
    | 'backup';
export type BackendJobStatus =
    | 'queued'
    | 'running'
    | 'done'
    | 'failed'
    | 'cancelled';
export type BackendJobUnitStatus = 'pending' | 'running' | 'done' | 'failed';

export interface BackendJobRecord {
    id: string;
    kind: BackendJobKind;
    label: string;
    status: BackendJobStatus;
    total: number;
    doneCount: number;
    failCount: number;
    startedAt: number;
    endedAt?: number;
    units: Record<string, BackendJobUnitStatus>;
    metadata?: Record<string, unknown>;
}

export interface TrackBackendJobInput {
    jobId: string;
    kind: BackendJobKind;
    label: string;
    status?: BackendJobStatus;
    total?: number;
    startedAt?: number;
    metadata?: Record<string, unknown>;
}

export interface BackendJobStatusEvent {
    jobId: string;
    status: BackendJobStatus;
    endedAt?: number;
}

export interface BackendJobUnitEvent {
    jobId: string;
    unitId: string;
    status: BackendJobUnitStatus;
}

interface JobUnitUpdatedParams {
    jobId?: string;
    unitId?: string;
    status?: BackendJobUnitStatus;
}

function countCompletedUnits(units: Record<string, BackendJobUnitStatus>) {
    let done = 0;
    let failed = 0;
    for (const status of Object.values(units)) {
        if (status === 'done') done += 1;
        if (status === 'failed') failed += 1;
    }
    return {done, failed};
}

function isActiveStatus(status: BackendJobStatus): boolean {
    return status === 'queued' || status === 'running';
}

function isTerminalStatus(status: BackendJobStatus): boolean {
    return status === 'done' || status === 'failed' || status === 'cancelled';
}

function isRestorableSnapshotKind(
    kind: BackendJobKind
): kind is OperationJobSnapshot['kind'] {
    return (
        kind === 'certificate' ||
        kind === 'credential' ||
        kind === 'backup' ||
        kind === 'firmware'
    );
}

function nonNegativeCount(value: number | undefined): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.trunc(value ?? 0));
}

function createJobRecord(input: TrackBackendJobInput): BackendJobRecord {
    return {
        id: input.jobId,
        kind: input.kind,
        label: input.label,
        status: input.status ?? 'queued',
        total: nonNegativeCount(input.total),
        doneCount: 0,
        failCount: 0,
        startedAt: input.startedAt ?? Date.now(),
        units: {},
        metadata: input.metadata
    };
}

function labelForSnapshot(snapshot: OperationJobSnapshot): string {
    if (snapshot.kind === 'certificate') {
        const slot = snapshot.metadata.slot;
        return typeof slot === 'string' ? `Push cert (${slot})` : 'Push cert';
    }
    if (snapshot.kind === 'backup') {
        const mode = snapshot.metadata.mode;
        return mode === 'restore' ? 'Restore backup' : 'Create backup';
    }
    if (snapshot.kind === 'firmware') {
        return 'Firmware update';
    }
    const mode = snapshot.metadata.mode;
    return typeof mode === 'string' ? `${mode} credentials` : 'Credential job';
}

function createJobRecordFromSnapshot(
    snapshot: OperationJobSnapshot
): BackendJobRecord {
    return {
        id: snapshot.id,
        kind: snapshot.kind,
        label: labelForSnapshot(snapshot),
        status: snapshot.status,
        total: nonNegativeCount(snapshot.total),
        doneCount: nonNegativeCount(snapshot.doneCount),
        failCount: nonNegativeCount(snapshot.failCount),
        startedAt: Date.parse(snapshot.startedAt ?? snapshot.createdAt),
        endedAt: snapshot.endedAt ? Date.parse(snapshot.endedAt) : undefined,
        units: {},
        metadata: snapshot.metadata
    };
}

function mergeJobRecord(
    existing: BackendJobRecord,
    input: TrackBackendJobInput
): BackendJobRecord {
    const status = input.status ?? existing.status;
    return {
        ...existing,
        kind: input.kind,
        label: input.label,
        status,
        total:
            input.total === undefined
                ? existing.total
                : nonNegativeCount(input.total),
        endedAt: isTerminalStatus(status)
            ? (existing.endedAt ?? Date.now())
            : existing.endedAt,
        metadata: input.metadata ?? existing.metadata
    };
}

function mergeJobSnapshot(
    existing: BackendJobRecord,
    snapshot: OperationJobSnapshot
): BackendJobRecord {
    return {
        ...existing,
        label: labelForSnapshot(snapshot),
        status: snapshot.status,
        total: nonNegativeCount(snapshot.total),
        doneCount: nonNegativeCount(snapshot.doneCount),
        failCount: nonNegativeCount(snapshot.failCount),
        endedAt: snapshot.endedAt
            ? Date.parse(snapshot.endedAt)
            : existing.endedAt,
        metadata: snapshot.metadata
    };
}

export const useJobsStore = defineStore('jobs', () => {
    const jobs = reactive(new Map<string, BackendJobRecord>());

    ws.onJobEvent(handleJobEvent);
    ws.onResyncRequired(reconcileActiveJobs);

    const allJobs = computed(() =>
        Array.from(jobs.values()).sort((a, b) => b.startedAt - a.startedAt)
    );
    const activeJobs = computed(() =>
        allJobs.value.filter((job) => isActiveStatus(job.status))
    );
    const activeJobCount = computed(() => activeJobs.value.length);

    function track(input: TrackBackendJobInput): BackendJobRecord {
        const existing = jobs.get(input.jobId);
        const next = existing
            ? mergeJobRecord(existing, input)
            : createJobRecord(input);
        jobs.set(input.jobId, next);
        return next;
    }

    function trackSnapshot(snapshot: OperationJobSnapshot): BackendJobRecord {
        const existing = jobs.get(snapshot.id);
        const next = existing
            ? mergeJobSnapshot(existing, snapshot)
            : createJobRecordFromSnapshot(snapshot);
        jobs.set(snapshot.id, next);
        return next;
    }

    async function restoreMissingActiveJobs(
        backendActiveIds: Set<string>
    ): Promise<void> {
        const missing = activeJobs.value.filter(
            (job) =>
                isRestorableSnapshotKind(job.kind) &&
                !backendActiveIds.has(job.id)
        );
        await Promise.all(
            missing.map(async (job) => {
                const snapshot = await ws.sendRPC<OperationJobSnapshot>(
                    'FLEET_MANAGER',
                    'job.get',
                    {jobId: job.id, kind: job.kind}
                );
                trackSnapshot(snapshot);
            })
        );
    }

    async function restoreActive(): Promise<void> {
        const response = await ws.sendRPC<OperationJobListResponse>(
            'FLEET_MANAGER',
            'job.listactive',
            {}
        );
        const activeIds = new Set(
            response.items.map((snapshot) => snapshot.id)
        );
        for (const snapshot of response.items) trackSnapshot(snapshot);
        await restoreMissingActiveJobs(activeIds);
    }

    function reconcileActiveJobs(): void {
        void reconcileActiveJobsSafely();
    }

    async function reconcileActiveJobsSafely(): Promise<void> {
        try {
            await restoreActive();
        } catch (error) {
            debugWarn('[jobs] resync reconcile failed', error);
        }
    }

    function applyStatus(event: BackendJobStatusEvent): void {
        const job = jobs.get(event.jobId);
        if (!job) return;
        job.status = event.status;
        if (isTerminalStatus(event.status)) {
            job.endedAt = event.endedAt ?? Date.now();
        }
    }

    function applyUnit(event: BackendJobUnitEvent): void {
        const job = jobs.get(event.jobId);
        if (!job || isTerminalStatus(job.status)) return;
        job.units[event.unitId] = event.status;
        const counts = countCompletedUnits(job.units);
        job.doneCount = counts.done;
        job.failCount = counts.failed;
    }

    function get(jobId: string): BackendJobRecord | undefined {
        return jobs.get(jobId);
    }

    function handleJobEvent(event: ws.NamespacedEvent): void {
        if (event.method === 'Job.Updated') {
            const job = event.params.job as OperationJobSnapshot | undefined;
            if (job) trackSnapshot(job);
            return;
        }
        if (event.method !== 'Job.UnitUpdated') return;
        const params = event.params as JobUnitUpdatedParams;
        if (!params.jobId || !params.unitId || !params.status) return;
        applyUnit({
            jobId: params.jobId,
            unitId: params.unitId,
            status: params.status
        });
    }

    function clear(): void {
        jobs.clear();
    }

    return {
        jobs,
        allJobs,
        activeJobs,
        activeJobCount,
        track,
        trackSnapshot,
        restoreActive,
        applyStatus,
        applyUnit,
        get,
        clear
    };
});
