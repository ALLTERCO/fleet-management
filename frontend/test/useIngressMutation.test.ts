import {beforeEach, describe, expect, it, vi} from 'vitest';

const toast = vi.hoisted(() => ({
    success: vi.fn(),
    error: vi.fn()
}));
vi.mock('@/stores/toast', () => ({useToastStore: () => toast}));

import {useIngressMutation} from '@/composables/useIngressMutation';

describe('useIngressMutation', () => {
    beforeEach(() => {
        toast.success.mockClear();
        toast.error.mockClear();
    });

    it('toasts success, runs onDone, and clears saving', async () => {
        const {saving, run} = useIngressMutation();
        const onDone = vi.fn();
        await run(() => Promise.resolve('ok'), 'Done', onDone);
        expect(toast.success).toHaveBeenCalledWith('Done');
        expect(onDone).toHaveBeenCalledOnce();
        expect(saving.value).toBe(false);
    });

    it('toasts the error message on failure and clears saving', async () => {
        const {saving, run} = useIngressMutation();
        await run(() => Promise.reject(new Error('boom')), 'Done');
        expect(toast.error).toHaveBeenCalledWith('boom');
        expect(toast.success).not.toHaveBeenCalled();
        expect(saving.value).toBe(false);
    });
});
