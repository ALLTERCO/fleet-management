import {onScopeDispose, type Ref, ref, watch} from 'vue';

/**
 * Ensures a loading state stays true for at least `minMs` milliseconds.
 * Prevents skeleton flash when data loads faster than the eye can register.
 */
export function useMinDelay(source: Ref<boolean>, minMs = 500): Ref<boolean> {
    const delayed = ref(source.value);
    let startedAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function clearTimer() {
        if (timer) {
            clearTimeout(timer);
            timer = undefined;
        }
    }

    watch(
        source,
        (isLoading) => {
            if (isLoading) {
                delayed.value = true;
                startedAt = Date.now();
                clearTimer();
            } else {
                const remaining = Math.max(0, minMs - (Date.now() - startedAt));
                if (remaining === 0) {
                    delayed.value = false;
                } else {
                    timer = setTimeout(() => {
                        delayed.value = false;
                        timer = undefined;
                    }, remaining);
                }
            }
        },
        {immediate: true}
    );

    // Why: prevent zombie timer firing after component unmounts
    onScopeDispose(clearTimer);

    return delayed;
}
