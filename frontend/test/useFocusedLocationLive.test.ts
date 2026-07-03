import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {nextTick, ref} from 'vue';
import {useFocusedLocationLive} from '@/composables/useFocusedLocationLive';
import type {LocationKpiSnapshot} from '@/types/focusCard';

const SAMPLE: LocationKpiSnapshot = Object.freeze({
    total: 5,
    on: 5,
    off: 0,
    warn: 0,
    powerKW: 1,
    todayKWh: 2,
    alerts: 0,
    lastSeenTs: 0,
    savingsPotentialPct: 0,
    firmwareHealthPct: 100,
    signalHealthPct: 100
});

class FakeSocket {
    public readonly isWired: boolean = true;
    public sent: unknown[] = [];
    private listeners: ((event: unknown) => void)[] = [];

    subscribe(
        topic: string,
        payload: unknown,
        cb: (event: unknown) => void
    ): () => void {
        this.sent.push({topic, payload});
        this.listeners.push(cb);
        return () => {
            this.listeners = this.listeners.filter((l) => l !== cb);
        };
    }

    emitFromServer(payload: unknown): void {
        for (const cb of this.listeners) cb(payload);
    }

    get listenerCount(): number {
        return this.listeners.length;
    }
}

describe('useFocusedLocationLive', () => {
    let socket: FakeSocket;

    beforeEach(() => {
        socket = new FakeSocket();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('subscribes on non-null focusedId and stops updating after unsubscribe', async () => {
        const focusedId = ref<number | null>(null);
        const {live, fallback} = useFocusedLocationLive({focusedId, socket});

        expect(socket.sent).toHaveLength(0);
        expect(live.value).toBeNull();

        focusedId.value = 42;
        await nextTick();

        expect(socket.sent).toHaveLength(1);
        expect((socket.sent[0] as {topic: string}).topic).toBe(
            'location:42:kpi'
        );
        expect(socket.listenerCount).toBe(1);

        socket.emitFromServer({...SAMPLE});
        await nextTick();
        expect(live.value).toEqual(SAMPLE);
        expect(fallback.value).toBe('live');

        // Go back to null — cleanup fires, listener removed
        focusedId.value = null;
        await nextTick();
        expect(socket.listenerCount).toBe(0);

        // Further server emits must not update live
        socket.emitFromServer({...SAMPLE, total: 99});
        await nextTick();
        expect(live.value).toBeNull();
        expect(fallback.value).toBe('snapshot');
    });

    it('re-subscribes when focusedId switches to a different location', async () => {
        const focusedId = ref<number | null>(1);
        useFocusedLocationLive({focusedId, socket});
        await nextTick();

        expect(socket.sent).toHaveLength(1);
        expect((socket.sent[0] as {topic: string}).topic).toBe(
            'location:1:kpi'
        );

        focusedId.value = 2;
        await nextTick();

        expect(socket.sent).toHaveLength(2);
        expect((socket.sent[1] as {topic: string}).topic).toBe(
            'location:2:kpi'
        );
        // old listener cleaned up, only new one active
        expect(socket.listenerCount).toBe(1);
    });

    it('drops malformed payloads and console.warns exactly once', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const focusedId = ref<number | null>(7);
        const {live} = useFocusedLocationLive({focusedId, socket});
        await nextTick();

        const malformed = {total: 'not-a-number', on: 1, off: 0, warn: 0};

        socket.emitFromServer(malformed);
        await nextTick();
        expect(live.value).toBeNull();
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toContain('[focus-card]');

        // Second malformed event must NOT trigger another warn
        socket.emitFromServer(malformed);
        await nextTick();
        expect(live.value).toBeNull();
        expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('sets fallback to forbidden on {error: "forbidden"}', async () => {
        const focusedId = ref<number | null>(3);
        const {live, fallback} = useFocusedLocationLive({focusedId, socket});
        await nextTick();

        socket.emitFromServer({error: 'forbidden'});
        await nextTick();

        expect(live.value).toBeNull();
        expect(fallback.value).toBe('forbidden');
    });

    it('keeps fallback as snapshot on {error: "rate_limited"}', async () => {
        const focusedId = ref<number | null>(5);
        const {live, fallback} = useFocusedLocationLive({focusedId, socket});
        await nextTick();

        socket.emitFromServer({error: 'rate_limited'});
        await nextTick();

        expect(live.value).toBeNull();
        expect(fallback.value).toBe('snapshot');
    });

    it('reverts fallback to snapshot after livenessTimeoutMs without events', async () => {
        vi.useFakeTimers();
        const focusedId = ref<number | null>(7);
        const {fallback} = useFocusedLocationLive({
            focusedId,
            socket,
            livenessTimeoutMs: 200
        });
        await nextTick();
        expect(fallback.value).toBe('snapshot'); // initial state, no event yet

        socket.emitFromServer(SAMPLE);
        expect(fallback.value).toBe('live');

        // No further events for the timeout window.
        vi.advanceTimersByTime(250);
        expect(fallback.value).toBe('snapshot');
        vi.useRealTimers();
    });

    it("badges 'unwired' when the socket adapter is the stub and never subscribes", async () => {
        const unwiredSocket = new FakeSocket() as FakeSocket & {
            isWired: boolean;
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (unwiredSocket as any).isWired = false;

        const focusedId = ref<number | null>(9);
        const {live, fallback} = useFocusedLocationLive({
            focusedId,
            socket: unwiredSocket
        });
        await nextTick();

        expect(fallback.value).toBe('unwired');
        expect(unwiredSocket.sent).toHaveLength(0);
        expect(live.value).toBeNull();
    });
});
