import {ref, type Ref} from 'vue';
import {UI_CONFIG} from '@/config/ui';

// One shared interval per rate; consumers subscribe via refcount. The
// default rate serves freshness rows ("Seen 2m ago"); countdown surfaces
// pass 1000 for a second-level tick.

export const SECOND_TICK_MS = 1_000;

interface TickerBucket {
    now: Ref<number>;
    timer: ReturnType<typeof setInterval> | null;
    refCount: number;
}

const buckets = new Map<number, TickerBucket>();

export function useNowTicker(intervalMs: number = UI_CONFIG.nowTickerMs) {
    let bucket = buckets.get(intervalMs);
    if (!bucket) {
        bucket = {now: ref(Date.now()), timer: null, refCount: 0};
        buckets.set(intervalMs, bucket);
    }
    const owned = bucket;
    owned.refCount += 1;
    if (!owned.timer) {
        owned.now.value = Date.now();
        owned.timer = setInterval(() => {
            owned.now.value = Date.now();
        }, intervalMs);
    }
    return {
        now: owned.now,
        release() {
            owned.refCount = Math.max(0, owned.refCount - 1);
            if (owned.refCount === 0 && owned.timer) {
                clearInterval(owned.timer);
                owned.timer = null;
            }
        }
    };
}
