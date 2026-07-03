import {ref} from 'vue';
import {UI_CONFIG} from '@/config/ui';

// One shared interval for every live timer; consumers subscribe via refcount.
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;
let refCount = 0;

export function useNowTicker() {
    refCount += 1;
    if (!timer) {
        timer = setInterval(() => {
            now.value = Date.now();
        }, UI_CONFIG.nowTickerMs);
    }
    return {
        now,
        release() {
            refCount = Math.max(0, refCount - 1);
            if (refCount === 0 && timer) {
                clearInterval(timer);
                timer = null;
            }
        }
    };
}
