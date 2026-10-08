// Rotation job bookkeeping for the credential rotation batch view.

import {computed, ref} from 'vue';
import {
    cancelRotationJob,
    listRotationJobs,
    PAGE_SIZE,
    type RotationJob,
    type RotationJobState
} from '@/api/deviceIngressRpc';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {useToastStore} from '@/stores/toast';

type JobFilter = {batchId?: string; state?: RotationJobState};

function sameFilter(a: JobFilter, b: JobFilter): boolean {
    return a.batchId === b.batchId && a.state === b.state;
}

export function useRotationJobs() {
    const toast = useToastStore();
    const jobs = ref<RotationJob[]>([]);
    const loading = ref(false);
    const error = ref<string | null>(null);
    const cancelling = ref<string | null>(null);
    const total = ref(0);
    const page = ref(0);
    let lastFilter: JobFilter = {};
    // Bumped by every load, so only the newest one may write its result.
    let loadSeq = 0;

    const hasPrev = computed(() => page.value > 0);
    const hasNext = computed(() => (page.value + 1) * PAGE_SIZE < total.value);

    /** True when this call was still the newest one and wrote its result. */
    async function fetchPage(filter: JobFilter): Promise<boolean> {
        const seq = ++loadSeq;
        loading.value = true;
        error.value = null;
        try {
            const result = await listRotationJobs({
                ...filter,
                limit: PAGE_SIZE,
                offset: page.value * PAGE_SIZE
            });
            if (seq !== loadSeq) return false;
            jobs.value = result.items;
            total.value = result.total ?? result.items.length;
        } catch (err) {
            if (seq !== loadSeq) return false;
            error.value = rpcErrorMessage(err, 'Failed to load rotation jobs');
        } finally {
            if (seq === loadSeq) loading.value = false;
        }
        return seq === loadSeq;
    }

    async function load(filter: JobFilter = {}): Promise<void> {
        if (!sameFilter(filter, lastFilter)) page.value = 0;
        lastFilter = filter;
        const applied = await fetchPage(filter);
        if (!applied || error.value !== null) return;
        // A shrunken list leaves the pager past the end; land on the last page.
        if (jobs.value.length > 0 || page.value === 0) return;
        const last = Math.max(0, Math.ceil(total.value / PAGE_SIZE) - 1);
        if (last === page.value) return;
        page.value = last;
        await fetchPage(filter);
    }

    async function cancel(id: string): Promise<void> {
        cancelling.value = id;
        try {
            await cancelRotationJob(id);
            toast.success('Rotation cancelled');
            await load(lastFilter);
        } catch (err) {
            toast.error(rpcErrorMessage(err, 'Failed to cancel rotation'));
        } finally {
            cancelling.value = null;
        }
    }

    function next(): void {
        if (!hasNext.value) return;
        page.value += 1;
        void load(lastFilter);
    }

    function prev(): void {
        if (!hasPrev.value) return;
        page.value -= 1;
        void load(lastFilter);
    }

    return {
        jobs,
        loading,
        error,
        cancelling,
        total,
        page,
        pageSize: PAGE_SIZE,
        hasPrev,
        hasNext,
        load,
        cancel,
        next,
        prev
    };
}
