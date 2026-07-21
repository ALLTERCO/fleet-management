// Report-generation progress. WS Report.Progress drives live updates;
// Report.GetReport polling is the durable fallback (refresh/reconnect/missed).
//
//   const p = useReportProgress();
//   p.start();
//   try { await generateReportFile(ws, params, name, {onStart: p.setJobId, onProgress: p.update}); }
//   finally { p.stop(); }

import {computed, getCurrentScope, onScopeDispose, ref} from 'vue';
import type {ReportProgress} from '@/helpers/reportGeneration';
import {onReportEvent} from '@/tools/websocket';
import {REPORT_EVENT} from '@/tools/wsEvents';

interface ProgressParams {
    jobId?: string;
    kind?: string;
    phase?: string;
    durationMs?: number;
    estimatedRows?: number;
    rowsWritten?: number;
    bytesWritten?: number;
    currentPhase?: string;
    percent?: number;
}

const PHASE_LABELS: Record<string, string> = {
    started: 'Starting…',
    data_fetched: 'Data fetched…',
    computing: 'Aggregating data…',
    writing: 'Writing report…',
    streaming: 'Streaming rows…',
    ready: 'Finalising…',
    done: 'Finalising…',
    failed: 'Failed'
};

export function useReportProgress() {
    const activeJobId = ref<string | null>(null);
    const phase = ref<string | null>(null);
    const currentPhase = ref<string | null>(null);
    const percent = ref<number | null>(null);
    const rowsWritten = ref<number | null>(null);
    const bytesWritten = ref<number | null>(null);
    const estimatedRows = ref<number | null>(null);
    const watching = ref(false);
    let unsubscribe: (() => void) | null = null;

    function resetCounters(): void {
        currentPhase.value = null;
        percent.value = null;
        rowsWritten.value = null;
        bytesWritten.value = null;
        estimatedRows.value = null;
    }

    function start(): void {
        if (watching.value) return;
        activeJobId.value = null;
        phase.value = 'started';
        resetCounters();
        watching.value = true;
    }

    // Subscribe only once the jobId is known, so the WS filter is never
    // permissive. Pre-jobId events are recovered by the poll fallback.
    function setJobId(jobId: string): void {
        activeJobId.value = jobId;
        if (unsubscribe) return;
        unsubscribe = onReportEvent((event) => {
            const params = event.params as ProgressParams & {
                status?: 'ready' | 'failed' | 'cancelled';
            };
            if (params.jobId !== activeJobId.value) return;
            // Terminal push — reflect the outcome instantly. The caller's
            // Report.GetReport poll stays the durable fetch of the file.
            if (event.method === REPORT_EVENT.READY) {
                phase.value = params.status === 'failed' ? 'failed' : 'done';
                if (params.status !== 'failed') percent.value = 100;
                return;
            }
            if (event.method !== REPORT_EVENT.PROGRESS) return;
            if (typeof params.phase === 'string') phase.value = params.phase;
            update(params);
        });
    }

    // Merge a WS or poll snapshot. Only overwrite fields the backend sent.
    function update(p: ReportProgress): void {
        if (activeJobId.value && p.jobId && p.jobId !== activeJobId.value) {
            return;
        }
        if (typeof p.currentPhase === 'string')
            currentPhase.value = p.currentPhase;
        if (typeof p.percent === 'number') percent.value = p.percent;
        if (typeof p.rowsWritten === 'number')
            rowsWritten.value = p.rowsWritten;
        if (typeof p.bytesWritten === 'number')
            bytesWritten.value = p.bytesWritten;
        if (typeof p.estimatedRows === 'number')
            estimatedRows.value = p.estimatedRows;
    }

    function stop(): void {
        unsubscribe?.();
        unsubscribe = null;
        watching.value = false;
        activeJobId.value = null;
        phase.value = null;
        resetCounters();
    }

    // Drop the subscription if the component unmounts mid-generation.
    if (getCurrentScope()) onScopeDispose(stop);

    // Prefer the poll's currentPhase; fall back to the WS phase nudge.
    const label = computed(() => {
        const key = currentPhase.value ?? phase.value;
        return key ? (PHASE_LABELS[key] ?? key) : '';
    });

    return {
        phase,
        currentPhase,
        percent,
        rowsWritten,
        bytesWritten,
        estimatedRows,
        watching,
        start,
        setJobId,
        stop,
        update,
        label
    };
}
