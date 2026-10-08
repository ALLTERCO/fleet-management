// The metric family with no framework: a live poller and a history read, both
// as external stores. The interval, the overlap guard and the tab-visibility
// pause are the same rules for every renderer, so they live here once. A copy
// per binding is a second set of bugs, and only one of them ever gets fixed.

import type {
    EnergyCurrentParams,
    EnergyCurrentResponse,
    EnergyQueryParams,
    EnergyQueryResponse
} from '@api/energy';
import {createExternalStore, type ExternalStore} from './external-store';
import type {HostLifecycle, HostLoadState} from './types';

// Floor on the live poll period — a template cannot hammer the backend
// faster than this, regardless of what it passes.
const MIN_METRIC_INTERVAL_MS = 1000;
const DEFAULT_METRIC_INTERVAL_MS = 3000;

// A read that never settles would pin the overlap guard and silence every
// later tick, so one is abandoned after this many poll periods.
const READ_DEADLINE_PERIODS = 2;
// Floor on that window: a 1s poll must still leave a slow backend time to
// answer before its reply is called lost.
const MIN_READ_DEADLINE_MS = 10000;
/** Stable reason on the snapshot when a read outlived its deadline. */
const READ_TIMEOUT_REASON = 'metric_read_timeout';

type MetricScope = {groupId?: number; locationId?: number; tagId?: number};
type MetricSelector = {scope?: MetricScope; devices?: string[]};

export type LiveMetricOptions = MetricSelector & {
    /** Component-key allowlist, e.g. ['switch:0','switch:2']. */
    components?: string[];
    /** total = one number; device = per-device sums; channel = per-channel. */
    detail?: EnergyCurrentParams['detail'];
    /** Poll period (ms). Clamped to >= 1000. Default 3000. */
    intervalMs?: number;
    /** Begin reading as soon as a binding attaches. Default true. */
    immediate?: boolean;
};

export type MetricHistoryOptions = MetricSelector & {
    from: string;
    to: string;
    /** Defaults to ['power']. */
    tags?: EnergyQueryParams['tags'];
    bucket?: EnergyQueryParams['bucket'];
    perDevice?: boolean;
    perPhase?: boolean;
    /** Commodity filter — defaults to AC-mains electricity for a metric widget. */
    commodity?: EnergyQueryParams['commodity'];
    electricalSource?: EnergyQueryParams['electricalSource'];
    /** Fetch as soon as a binding attaches. Default true. */
    immediate?: boolean;
};

/**
 * What every binding renders. `data` survives a failed read, so a card keeps
 * the last real number instead of blanking on one bad tick. `kind` is the
 * discriminant a front door reads to tell the two apart without a cast.
 */
export type LiveMetricSnapshot = {
    kind: 'live';
    status: HostLoadState;
    data: EnergyCurrentResponse | null;
    error: string | null;
};

export type MetricHistorySnapshot = {
    kind: 'history';
    status: HostLoadState;
    data: EnergyQueryResponse | null;
    error: string | null;
};

export type MetricSnapshot = LiveMetricSnapshot | MetricHistorySnapshot;

/** The controls both sources answer to. Live keeps a schedule; history has
 *  nothing to keep current, so starting it is the one read. */
type MetricSourceControls = HostLifecycle & {
    // Both sources implement the whole lifecycle, so a binding never has to
    // ask whether the half it needs is there.
    attach(): void;
    detach(): void;
    /** One read outside the schedule. */
    refresh(): Promise<void>;
    /** Reads now, and keeps reading if this source has a schedule. */
    start(): void;
    /** Stops reading until `start`. */
    stop(): void;
};

export type LiveMetricSource = ExternalStore<LiveMetricSnapshot> &
    MetricSourceControls;

export type MetricHistorySource = ExternalStore<MetricHistorySnapshot> &
    MetricSourceControls;

/** Either source, seen through the one shape a front door needs. */
export type MetricSource = ExternalStore<MetricSnapshot> & MetricSourceControls;

type LiveMetricSourceOptions = LiveMetricOptions & {
    /** How this binding reaches energy.current. */
    read(params: EnergyCurrentParams): Promise<EnergyCurrentResponse>;
};

type MetricHistorySourceOptions = MetricHistoryOptions & {
    /** How this binding reaches energy.query. */
    read(params: EnergyQueryParams): Promise<EnergyQueryResponse>;
};

// One idle snapshot per kind: readers get the stable reference React's
// useSyncExternalStore contract wants.
const IDLE_LIVE: LiveMetricSnapshot = {
    kind: 'live',
    status: 'idle',
    data: null,
    error: null
};

const IDLE_HISTORY: MetricHistorySnapshot = {
    kind: 'history',
    status: 'idle',
    data: null,
    error: null
};

function failureMessage(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause);
}

function currentParams(options: LiveMetricOptions): EnergyCurrentParams {
    return {
        ...(options.scope ? {scope: options.scope} : {}),
        ...(options.devices ? {devices: options.devices} : {}),
        ...(options.components ? {components: options.components} : {}),
        ...(options.detail ? {detail: options.detail} : {})
    };
}

function historyParams(options: MetricHistoryOptions): EnergyQueryParams {
    return {
        from: options.from,
        to: options.to,
        tags: options.tags ?? ['power'],
        ...(options.bucket ? {bucket: options.bucket} : {}),
        ...(options.scope ? {scope: options.scope} : {}),
        ...(options.devices ? {devices: options.devices} : {}),
        ...(options.perDevice !== undefined
            ? {perDevice: options.perDevice}
            : {}),
        ...(options.perPhase !== undefined ? {perPhase: options.perPhase} : {}),
        // Default a metric widget to AC-mains electricity so DC never mixes
        // into a power/voltage chart; caller can override either.
        commodity: options.commodity ?? 'electricity',
        electricalSource: options.electricalSource ?? 'ac_mains'
    };
}

/**
 * A live reading that keeps itself current. Building one acquires nothing: the
 * timer and the visibility listener start at `attach`, because a binding that
 * builds a source and throws the render away has no teardown to run.
 */
export function createLiveMetric(
    options: LiveMetricSourceOptions
): LiveMetricSource {
    const period = Math.max(
        MIN_METRIC_INTERVAL_MS,
        options.intervalMs ?? DEFAULT_METRIC_INTERVAL_MS
    );
    const store = createExternalStore<LiveMetricSnapshot>(IDLE_LIVE);
    const hasDocument = typeof document !== 'undefined';

    const readDeadlineMs = Math.max(
        MIN_READ_DEADLINE_MS,
        period * READ_DEADLINE_PERIODS
    );
    let timer: ReturnType<typeof setInterval> | null = null;
    let deadline: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let disposed = false;
    let attached = false;
    let wantRunning = options.immediate ?? true;
    // Bumped whenever a read is started or abandoned; a reply whose ticket is
    // no longer current belongs to a read nobody is waiting for.
    let ticket = 0;

    function clearDeadline(): void {
        if (deadline === null) return;
        clearTimeout(deadline);
        deadline = null;
    }

    async function refresh(): Promise<void> {
        // Skip overlapping ticks — a slow backend must not pile up requests.
        if (inFlight || disposed) return;
        inFlight = true;
        const mine = ++ticket;
        store.setSnapshot({...store.getSnapshot(), status: 'loading'});
        deadline = setTimeout(() => {
            if (disposed || mine !== ticket) return;
            // Abandon the hung read: the guard clears, the next tick proceeds,
            // and the last good reading stays on the card.
            deadline = null;
            ticket += 1;
            inFlight = false;
            store.setSnapshot({
                ...store.getSnapshot(),
                status: 'error',
                error: READ_TIMEOUT_REASON
            });
        }, readDeadlineMs);
        try {
            const data = await options.read(currentParams(options));
            if (disposed || mine !== ticket) return;
            store.setSnapshot({
                kind: 'live',
                status: 'ready',
                data,
                error: null
            });
        } catch (cause) {
            if (disposed || mine !== ticket) return;
            store.setSnapshot({
                ...store.getSnapshot(),
                status: 'error',
                error: failureMessage(cause)
            });
        } finally {
            if (mine === ticket) {
                clearDeadline();
                inFlight = false;
            }
        }
    }

    function arm(): void {
        if (timer || disposed) return;
        if (hasDocument && document.hidden) return;
        timer = setInterval(() => void refresh(), period);
    }

    function disarm(): void {
        if (timer === null) return;
        clearInterval(timer);
        timer = null;
    }

    function run(): void {
        void refresh();
        arm();
    }

    function start(): void {
        if (disposed) return;
        wantRunning = true;
        if (attached) run();
    }

    function stop(): void {
        wantRunning = false;
        disarm();
    }

    // Pause polling while the tab is hidden; resume (and read once) when it
    // returns. Saves the backend the scope sum for invisible cards.
    function onVisibility(): void {
        if (disposed || !wantRunning) return;
        if (document.hidden) disarm();
        else run();
    }

    function detach(): void {
        if (!attached) return;
        attached = false;
        disarm();
        if (hasDocument) {
            document.removeEventListener('visibilitychange', onVisibility);
        }
    }

    return {
        getSnapshot: store.getSnapshot,
        subscribe: store.subscribe,
        refresh,
        start,
        stop,
        attach(): void {
            if (disposed || attached) return;
            attached = true;
            if (hasDocument) {
                document.addEventListener('visibilitychange', onVisibility);
            }
            if (wantRunning) run();
        },
        detach,
        dispose(): void {
            disposed = true;
            detach();
            stop();
            // The deadline outlives detach on purpose (a hung read must still
            // release the guard), so disposal is where it is dropped.
            clearDeadline();
        }
    };
}

/** One pre-aggregated history read, on the same contract. There is no schedule
 *  to pause, so a hidden tab costs nothing and no visibility listener exists. */
export function createMetricHistory(
    options: MetricHistorySourceOptions
): MetricHistorySource {
    const store = createExternalStore<MetricHistorySnapshot>(IDLE_HISTORY);
    let disposed = false;
    let attached = false;
    let wantRunning = options.immediate ?? true;

    async function refresh(): Promise<void> {
        if (disposed) return;
        store.setSnapshot({...store.getSnapshot(), status: 'loading'});
        try {
            const data = await options.read(historyParams(options));
            if (disposed) return;
            store.setSnapshot({
                kind: 'history',
                status: 'ready',
                data,
                error: null
            });
        } catch (cause) {
            if (disposed) return;
            store.setSnapshot({
                ...store.getSnapshot(),
                status: 'error',
                error: failureMessage(cause)
            });
        }
    }

    return {
        getSnapshot: store.getSnapshot,
        subscribe: store.subscribe,
        refresh,
        start(): void {
            if (disposed) return;
            wantRunning = true;
            if (attached) void refresh();
        },
        stop(): void {
            wantRunning = false;
        },
        attach(): void {
            if (disposed || attached) return;
            attached = true;
            if (wantRunning) void refresh();
        },
        detach(): void {
            attached = false;
        },
        dispose(): void {
            disposed = true;
            attached = false;
            wantRunning = false;
        }
    };
}
