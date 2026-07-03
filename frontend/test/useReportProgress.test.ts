import {describe, expect, it, vi} from 'vitest';
import {useReportProgress} from '@/composables/useReportProgress';

type ReportEvent = {
    method: string;
    params: Record<string, unknown>;
};

const reportListeners = vi.hoisted(
    () => new Set<(event: ReportEvent) => void>()
);

vi.mock('@/tools/websocket', () => ({
    onReportEvent: (cb: (event: ReportEvent) => void) => {
        reportListeners.add(cb);
        return () => reportListeners.delete(cb);
    }
}));

function emitReportProgress(params: Record<string, unknown>): void {
    for (const listener of reportListeners) {
        listener({method: 'Report.Progress', params});
    }
}

describe('useReportProgress', () => {
    it('merges rich Report.Progress websocket fields', () => {
        const progress = useReportProgress();
        progress.start();
        progress.setJobId('job-1');

        emitReportProgress({
            jobId: 'job-1',
            phase: 'writing',
            currentPhase: 'writing',
            rowsWritten: 25,
            bytesWritten: 4096,
            estimatedRows: 100,
            percent: 25
        });

        expect(progress.label.value).toBe('Writing report…');
        expect(progress.rowsWritten.value).toBe(25);
        expect(progress.bytesWritten.value).toBe(4096);
        expect(progress.estimatedRows.value).toBe(100);
        expect(progress.percent.value).toBe(25);
    });

    it('ignores rich progress for another active job', () => {
        const progress = useReportProgress();
        progress.start();
        progress.setJobId('job-1');

        emitReportProgress({
            jobId: 'job-2',
            phase: 'writing',
            rowsWritten: 50,
            percent: 50
        });

        expect(progress.phase.value).toBe('started');
        expect(progress.rowsWritten.value).toBeNull();
        expect(progress.percent.value).toBeNull();
    });

    it('ignores events that arrive before the jobId is known', () => {
        const progress = useReportProgress();
        progress.start();

        emitReportProgress({jobId: 'job-1', rowsWritten: 10, percent: 10});
        expect(progress.rowsWritten.value).toBeNull();

        progress.setJobId('job-1');
        emitReportProgress({jobId: 'job-1', rowsWritten: 20, percent: 20});
        expect(progress.rowsWritten.value).toBe(20);
    });

    it('ignores a stale poll snapshot from another job', () => {
        const progress = useReportProgress();
        progress.start();
        progress.setJobId('job-2');

        progress.update({
            jobId: 'job-1',
            rowsWritten: 10,
            bytesWritten: 1024,
            percent: 10
        });

        expect(progress.rowsWritten.value).toBeNull();
        expect(progress.bytesWritten.value).toBeNull();
        expect(progress.percent.value).toBeNull();
    });
});
