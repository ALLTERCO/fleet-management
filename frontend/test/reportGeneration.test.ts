import {describe, expect, it, vi} from 'vitest';
import {
    generateReportFile,
    pollUntilReady,
    ReportCancelledError,
    ReportPollAbortedError
} from '@/helpers/reportGeneration';

// A fake RPC client: report.generate yields a fixed jobId; report.getreport
// returns the queued status snapshots in order (last one repeats).
function mockWs(getReportResponses: unknown[]) {
    let i = 0;
    return {
        sendRPC: async <T>(_target: string, method: string): Promise<T> => {
            if (method === 'report.generate') return {jobId: 'job-1'} as T;
            const idx = Math.min(i++, getReportResponses.length - 1);
            return getReportResponses[idx] as T;
        }
    };
}

const ready = {
    status: 'ready',
    downloadUrl: '/api/exports/download/report.csv.gz',
    htmlUrl: null,
    progress: {percent: 100, rowsWritten: 5, bytesWritten: 2048},
    error: null
};

describe('pollUntilReady', () => {
    it('forwards each progress snapshot to onProgress', async () => {
        const onProgress = vi.fn();
        const ref = await pollUntilReady(
            mockWs([ready]),
            'job-1',
            'r',
            onProgress
        );
        expect(onProgress).toHaveBeenCalledWith({
            ...ready.progress,
            jobId: 'job-1'
        });
        expect(ref.file).toBe('report.csv.gz');
    });

    it('stops polling when the caller aborts', async () => {
        const abort = new AbortController();
        abort.abort();
        await expect(
            pollUntilReady(
                mockWs([ready]),
                'job-1',
                'r',
                undefined,
                abort.signal
            )
        ).rejects.toBeInstanceOf(ReportPollAbortedError);
    });

    it('rejects with ReportCancelledError when the job is cancelled', async () => {
        const cancelled = {
            status: 'cancelled',
            downloadUrl: null,
            htmlUrl: null,
            progress: null,
            error: null
        };
        await expect(
            pollUntilReady(mockWs([cancelled]), 'job-1', 'r')
        ).rejects.toBeInstanceOf(ReportCancelledError);
    });

    it('surfaces the backend error message when the job fails', async () => {
        const failed = {
            status: 'failed',
            downloadUrl: null,
            htmlUrl: null,
            progress: null,
            error: 'range too large'
        };
        await expect(
            pollUntilReady(mockWs([failed]), 'job-1', 'r')
        ).rejects.toThrow('range too large');
    });
});

describe('generateReportFile', () => {
    it('reports the jobId via onStart before polling', async () => {
        const onStart = vi.fn();
        await generateReportFile(mockWs([ready]), {}, 'r', {onStart});
        expect(onStart).toHaveBeenCalledWith('job-1');
    });

    it('does not start a report when already aborted', async () => {
        const abort = new AbortController();
        abort.abort();
        const sendRPC = vi.fn();
        await expect(
            generateReportFile({sendRPC}, {}, 'r', {signal: abort.signal})
        ).rejects.toBeInstanceOf(ReportPollAbortedError);
        expect(sendRPC).not.toHaveBeenCalled();
    });
});
