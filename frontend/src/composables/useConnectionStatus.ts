import {type ComputedRef, computed, onBeforeUnmount, ref, watch} from 'vue';
import {useAuthStore} from '@/stores/auth';

export type ConnectionPhase = 'online' | 'reconnecting' | 'offline';

const RECONNECT_GRACE_MS = 2_000;

export interface UseConnectionStatusOptions {
    /** Hide the "reconnecting" banner until the outage exceeds this delay. */
    graceMs?: number;
}

// Auth's permissionsLoaded flips false on WS drop; flips back on reconnect.
// We only flag the banner once the outage has persisted past the grace window.
export function useConnectionStatus(options: UseConnectionStatusOptions = {}): {
    phase: ComputedRef<ConnectionPhase>;
} {
    const auth = useAuthStore();
    const grace = options.graceMs ?? RECONNECT_GRACE_MS;
    const passedGrace = ref(false);
    let graceTimer: ReturnType<typeof setTimeout> | null = null;

    watch(
        () => auth.permissionsLoaded,
        (loaded) => {
            if (graceTimer) clearTimeout(graceTimer);
            if (loaded) {
                passedGrace.value = false;
                return;
            }
            graceTimer = setTimeout(() => {
                passedGrace.value = true;
            }, grace);
        },
        {immediate: true}
    );

    onBeforeUnmount(() => {
        if (graceTimer) clearTimeout(graceTimer);
    });

    const phase = computed<ConnectionPhase>(() => {
        if (auth.permissionsLoaded) return 'online';
        if (passedGrace.value) return 'reconnecting';
        return 'offline'; // brief drop, no banner yet
    });
    return {phase};
}
