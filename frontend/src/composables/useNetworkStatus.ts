// Tracks browser online state. `navigator.onLine` is reactive via window events.

import {onBeforeUnmount, onMounted, ref} from 'vue';

let refCount = 0;
let cleanup: (() => void) | undefined;
const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine);

function attach(): void {
    if (refCount > 0) {
        refCount++;
        return;
    }
    refCount = 1;
    const set = (v: boolean) => {
        online.value = v;
    };
    const onOnline = () => set(true);
    const onOffline = () => set(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    online.value = navigator.onLine;
    cleanup = () => {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
    };
}

function detach(): void {
    refCount = Math.max(0, refCount - 1);
    if (refCount === 0 && cleanup) {
        cleanup();
        cleanup = undefined;
    }
}

export function useNetworkStatus() {
    onMounted(attach);
    onBeforeUnmount(detach);
    return {online};
}
