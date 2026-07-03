import {flushPromises, mount} from '@vue/test-utils';
import {defineComponent, h, nextTick} from 'vue';
import {describe, expect, it, vi} from 'vitest';
import ReportProgress from '@/components/reports/ReportProgress.vue';
import {useReportProgress} from '@/composables/useReportProgress';

type ReportEvent = {
    method: string;
    params: Record<string, unknown>;
};

const reportListeners = vi.hoisted(() => new Set<(event: ReportEvent) => void>());

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

const Harness = defineComponent({
    setup() {
        const progress = useReportProgress();
        progress.start();
        progress.setJobId('job-1');
        return () =>
            h(ReportProgress, {
                label: progress.label.value,
                percent: progress.percent.value,
                rowsWritten: progress.rowsWritten.value,
                bytesWritten: progress.bytesWritten.value,
                estimatedRows: progress.estimatedRows.value
            });
    }
});

describe('report progress live UI', () => {
    it('renders rich websocket progress before any poll snapshot', async () => {
        const wrapper = mount(Harness);

        emitReportProgress({
            jobId: 'job-1',
            phase: 'writing',
            currentPhase: 'writing',
            rowsWritten: 25,
            bytesWritten: 4096,
            estimatedRows: 100,
            percent: 25
        });
        await nextTick();
        await flushPromises();

        expect(wrapper.text()).toContain('Writing report…');
        expect(wrapper.text()).toContain('25%');
        expect(wrapper.text()).toContain('25 / 100 rows');
        expect(wrapper.text()).toContain('4.0 KB');
    });

    it('renders zero bytes as 0 B', async () => {
        const wrapper = mount(Harness);

        emitReportProgress({
            jobId: 'job-1',
            phase: 'streaming',
            currentPhase: 'streaming',
            bytesWritten: 0
        });
        await nextTick();
        await flushPromises();

        expect(wrapper.text()).toContain('0 B');
    });
});
