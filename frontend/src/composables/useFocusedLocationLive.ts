import {type Ref, ref, watch} from 'vue';
import {
    FOCUS_CARD_LIVENESS_TIMEOUT_MS,
    type LiveFallback,
    type LocationKpiSnapshot
} from '@/types/focusCard';

export interface RealtimeSocket {
    /** True when the socket transport is actually wired to the backend topic.
     *  False means the stub is shipping → fallback surfaces as 'unwired'. */
    readonly isWired: boolean;
    subscribe(
        topic: string,
        payload: unknown,
        cb: (event: unknown) => void
    ): () => void;
}

export function useFocusedLocationLive(input: {
    readonly focusedId: Ref<number | null>;
    readonly socket: RealtimeSocket;
    readonly livenessTimeoutMs?: number;
}): {
    readonly live: Ref<LocationKpiSnapshot | null>;
    readonly fallback: Ref<LiveFallback>;
} {
    const live = ref<LocationKpiSnapshot | null>(null);
    const fallback = ref<LiveFallback>(initialFallback(input.socket));

    // Watch both the focused id AND the socket's wired-state so a transport
    // reconnect mid-session flips the fallback away from 'unwired' without
    // requiring the user to close + reopen the card on a different location.
    watch(
        [input.focusedId, () => input.socket.isWired],
        ([id], _prev, onCleanup) => {
            live.value = null;
            fallback.value = initialFallback(input.socket);
            if (id == null || !input.socket.isWired) return;

            const timeoutMs =
                input.livenessTimeoutMs ?? FOCUS_CARD_LIVENESS_TIMEOUT_MS;
            const session = {
                timer: null as ReturnType<typeof setTimeout> | null,
                warnedMalformed: false
            };

            function armLivenessTimer(): void {
                if (session.timer !== null) clearTimeout(session.timer);
                session.timer = setTimeout(() => {
                    fallback.value = 'snapshot';
                    live.value = null;
                    session.timer = null;
                }, timeoutMs);
            }

            const unsubscribe = input.socket.subscribe(
                `location:${id}:kpi`,
                {locationId: id},
                (event) => {
                    if (isErrorEvent(event)) {
                        fallback.value = errorToFallback(event.error);
                        return;
                    }
                    if (!isValidKpiPayload(event)) {
                        if (!session.warnedMalformed) {
                            console.warn(
                                '[focus-card] dropped malformed WS payload',
                                event
                            );
                            session.warnedMalformed = true;
                        }
                        return;
                    }
                    live.value = event;
                    fallback.value = 'live';
                    armLivenessTimer();
                }
            );

            armLivenessTimer();

            onCleanup(() => {
                if (session.timer !== null) {
                    clearTimeout(session.timer);
                    session.timer = null;
                }
                unsubscribe();
            });
        },
        {immediate: true}
    );

    return {live, fallback};
}

function initialFallback(socket: RealtimeSocket): LiveFallback {
    return socket.isWired ? 'snapshot' : 'unwired';
}

function isErrorEvent(event: unknown): event is {error: string} {
    return (
        typeof event === 'object' &&
        event !== null &&
        'error' in event &&
        typeof (event as {error: unknown}).error === 'string'
    );
}

function errorToFallback(error: string): LiveFallback {
    if (error === 'forbidden') return 'forbidden';
    return 'snapshot';
}

function isValidKpiPayload(event: unknown): event is LocationKpiSnapshot {
    if (typeof event !== 'object' || event === null) return false;
    const obj = event as Record<string, unknown>;
    const numericRequired = [
        'total',
        'on',
        'off',
        'warn',
        'powerKW',
        'lastSeenTs',
        'savingsPotentialPct',
        'firmwareHealthPct',
        'signalHealthPct'
    ] as const;
    for (const key of numericRequired) {
        const v = obj[key];
        if (typeof v !== 'number' || !Number.isFinite(v)) return false;
    }
    return isNullableNumber(obj.todayKWh) && isNullableNumber(obj.alerts);
}

function isNullableNumber(value: unknown): value is number | null {
    if (value === null) return true;
    return typeof value === 'number' && Number.isFinite(value);
}
