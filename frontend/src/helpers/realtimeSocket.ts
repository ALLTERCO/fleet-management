import type {RealtimeSocket} from '@/composables/useFocusedLocationLive';

let warned = false;

/** Production socket adapter for `location:N:kpi` topics is not yet wired.
 *  `isWired: false` tells the composable to surface the 'unwired' badge
 *  immediately instead of silently sitting on 'snapshot' forever. */
export const realtimeSocket: RealtimeSocket = {
    isWired: false,
    subscribe(_topic, _payload, _cb) {
        if (!warned) {
            console.warn(
                '[realtimeSocket] stub — location KPI stream not wired; ' +
                    "card shows 'Live unavailable' badge."
            );
            warned = true;
        }
        return () => {};
    }
};
