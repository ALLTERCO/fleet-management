// Event capture for one socket's subscriptions. In Redis mode it outlives
// the socket for the resume grace window so the gap is recorded, not lost.

// live: socket bound. parked: socket gone, still recording. handover: a
// resuming socket claimed it. lost: gap broke (cap or write failure).
type CaptureState = 'live' | 'parked' | 'handover' | 'lost' | 'released';

const RECORDING_STATES: ReadonlySet<CaptureState> = new Set([
    'live',
    'parked',
    'handover'
]);

export interface SessionCaptureOptions {
    /** Events allowed while parked; one more breaks the gap. */
    maxGapEvents: number;
    /** False once the owner may no longer receive events. */
    ownerMayReceive: () => boolean;
}

export class SessionCapture {
    readonly #options: SessionCaptureOptions;
    readonly #releaseHooks: Array<() => void> = [];
    readonly released: Promise<void>;
    #resolveReleased!: () => void;
    #state: CaptureState = 'live';
    #gapEvents = 0;
    #predecessor: SessionCapture | undefined;

    constructor(options: SessionCaptureOptions) {
        this.#options = options;
        this.released = new Promise((resolve) => {
            this.#resolveReleased = resolve;
        });
    }

    /** True while subscription listeners should record events. */
    accepts(): boolean {
        return (
            RECORDING_STATES.has(this.#state) && this.#options.ownerMayReceive()
        );
    }

    /** True when a resume cannot replay the gap without holes. */
    gapBroken(): boolean {
        return this.#state === 'lost' || !this.#options.ownerMayReceive();
    }

    /** Runs `hook` when the capture stops; at once if it already has. */
    onRelease(hook: () => void): void {
        if (this.#listenersDetached()) {
            hook();
            return;
        }
        this.#releaseHooks.push(hook);
    }

    park(): void {
        if (this.#state === 'live') this.#state = 'parked';
    }

    countAppend(): void {
        if (this.#state !== 'parked') return;
        this.#gapEvents++;
        if (this.#gapEvents > this.#options.maxGapEvents) this.#breakGap();
    }

    markWriteFailed(): void {
        if (this.#state === 'parked') this.#breakGap();
    }

    /** A resuming socket keeps this recording until its own listeners exist. */
    adoptPredecessor(predecessor: SessionCapture): void {
        predecessor.#state = 'handover';
        this.#predecessor = predecessor;
    }

    releasePredecessor(): void {
        const predecessor = this.#predecessor;
        this.#predecessor = undefined;
        predecessor?.release();
    }

    release(): void {
        this.releasePredecessor();
        if (this.#state === 'released') return;
        this.#state = 'released';
        this.#detachListeners();
    }

    #breakGap(): void {
        this.#state = 'lost';
        this.#detachListeners();
    }

    #listenersDetached(): boolean {
        return this.#state === 'lost' || this.#state === 'released';
    }

    #detachListeners(): void {
        const hooks = this.#releaseHooks.splice(0);
        for (const hook of hooks) hook();
        this.#resolveReleased();
    }
}
