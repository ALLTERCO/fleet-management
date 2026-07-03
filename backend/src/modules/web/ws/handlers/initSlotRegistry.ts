// Lifecycle-tracked device-init slots. A slot is an object (owner, age,
// stage), not a bare counter, so a hung init that never releases is reclaimed
// by the watchdog instead of jamming the fleet silently.

// The init's current phase, so a reclaim names where it died: 'build' = the
// device probe/build, 'post-register' = the after-commit tasks.
export type InitStage = 'build' | 'post-register' | 'reclaimed';

export const INIT_QUEUE_STALE_REASON = 'init_queue_stale';
export const INIT_SLOT_RECLAIMED_REASON = 'init_slot_reclaimed';

export interface SlotHandle {
    readonly shellyID: string;
    // Aborted when the watchdog reclaims this slot, so the init it guards
    // unwinds (RPCs/awaits that honor the signal stop) instead of hanging.
    readonly signal: AbortSignal;
    // Records where the init currently is, so a reclaim names the slow step.
    setStage(stage: InitStage): void;
}

export interface MetricsSink {
    incrementCounter(name: string, delta?: number): void;
    incrementLabeledCounter(name: string, labels: Record<string, string>): void;
    setGauge(name: string, value: number): void;
}

export interface RegistryConfig {
    maxConcurrent: number;
    queueMax: number;
    queueHighWaterPct: number;
    queueMaxWaitMs: number;
    // A slot held longer than this is treated as stuck and reclaimed.
    maxHoldMs: number;
}

export interface RegistryDeps {
    now: () => number;
    metrics: MetricsSink;
    log: (message: string) => void;
}

interface ActiveSlot {
    shellyID: string;
    activatedAtMs: number;
    stage: InitStage;
    abort: AbortController;
}

interface QueuedInit {
    shellyID: string;
    queuedAtMs: number;
    resolve: (handle: SlotHandle) => void;
    reject: (err: Error) => void;
}

export class InitSlotRegistry {
    // Keyed by the handle so release/reclaim are O(1), not a scan.
    readonly #active = new Map<SlotHandle, ActiveSlot>();
    #queue: QueuedInit[] = [];
    // Cumulative stuck-slot reclaims since boot, surfaced in stats() so the
    // in-app monitor shows the self-heal count (Grafana gets it per-stage).
    #reclaimedTotal = 0;
    readonly #cfg: RegistryConfig;
    readonly #deps: RegistryDeps;

    constructor(cfg: RegistryConfig, deps: RegistryDeps) {
        this.#cfg = cfg;
        this.#deps = deps;
    }

    // Resolves to a handle once a slot is active. Null = queue over high-water,
    // so the caller refuses the device.
    acquire(shellyID: string): Promise<SlotHandle> | null {
        if (this.#active.size < this.#cfg.maxConcurrent) {
            return Promise.resolve(this.#activate(shellyID));
        }
        if (this.#queue.length >= this.#highWater()) {
            this.#deps.metrics.incrementCounter('device_inits_queue_dropped');
            return null;
        }
        return new Promise<SlotHandle>((resolve, reject) => {
            this.#queue.push({
                shellyID,
                queuedAtMs: this.#deps.now(),
                resolve,
                reject
            });
        });
    }

    release(handle: SlotHandle): void {
        if (!this.#active.has(handle)) return;
        this.#deps.metrics.incrementCounter('device_inits_completed');
        this.#removeAndPromote(handle);
    }

    // Watchdog tick. Call on a timer. Reads top-down: drain give-ups, reclaim
    // the stuck, publish the snapshot.
    sweep(): void {
        this.#pruneStaleQueue();
        this.#reclaimStuckSlots();
        this.#publishGauges();
    }

    #reclaimStuckSlots(): void {
        const now = this.#deps.now();
        for (const [handle, slot] of [...this.#active]) {
            if (now - slot.activatedAtMs >= this.#cfg.maxHoldMs) {
                this.#reclaimSlot(handle, slot);
            }
        }
    }

    // Free a stuck slot, name the stage it died in, and abort its init.
    #reclaimSlot(handle: SlotHandle, slot: ActiveSlot): void {
        const heldMs = this.#deps.now() - slot.activatedAtMs;
        this.#deps.log(
            `init-slot STUCK shellyID=${slot.shellyID} heldMs=${heldMs} stage=${slot.stage} — reclaiming`
        );
        this.#deps.metrics.incrementLabeledCounter(
            'device_init_slot_reclaimed_total',
            {stage: slot.stage}
        );
        this.#reclaimedTotal++;
        slot.stage = 'reclaimed';
        slot.abort.abort(new Error(INIT_SLOT_RECLAIMED_REASON));
        this.#removeAndPromote(handle);
    }

    stats(): {
        active: number;
        queued: number;
        oldestHeldMs: number;
        oldestQueuedMs: number;
        reclaimedTotal: number;
    } {
        return {
            active: this.#active.size,
            queued: this.#queue.length,
            oldestHeldMs: this.#oldestHeldMs(),
            oldestQueuedMs: this.#oldestQueuedMs(),
            reclaimedTotal: this.#reclaimedTotal
        };
    }

    // --- internals ----------------------------------------------------

    #activate(shellyID: string): SlotHandle {
        const slot: ActiveSlot = {
            shellyID,
            activatedAtMs: this.#deps.now(),
            stage: 'build',
            abort: new AbortController()
        };
        const handle: SlotHandle = {
            shellyID,
            signal: slot.abort.signal,
            setStage: (stage: InitStage) => {
                slot.stage = stage;
            }
        };
        this.#active.set(handle, slot);
        this.#deps.metrics.incrementCounter('device_inits_started');
        return handle;
    }

    #removeAndPromote(handle: SlotHandle): void {
        this.#active.delete(handle);
        this.#pruneStaleQueue();
        const next = this.#queue.shift();
        if (!next) return;
        next.resolve(this.#activate(next.shellyID));
    }

    #pruneStaleQueue(): void {
        const cutoff = this.#deps.now() - this.#cfg.queueMaxWaitMs;
        while (this.#queue.length > 0 && this.#queue[0].queuedAtMs < cutoff) {
            const stale = this.#queue.shift();
            if (!stale) break;
            this.#deps.metrics.incrementCounter(
                'device_inits_queue_stale_dropped'
            );
            stale.reject(new Error(INIT_QUEUE_STALE_REASON));
        }
    }

    #highWater(): number {
        return Math.floor(
            (this.#cfg.queueMax * this.#cfg.queueHighWaterPct) / 100
        );
    }

    #oldestHeldMs(): number {
        const now = this.#deps.now();
        let oldest = 0;
        for (const slot of this.#active.values()) {
            const held = now - slot.activatedAtMs;
            if (held > oldest) oldest = held;
        }
        return oldest;
    }

    // The queue is FIFO, so the front entry has waited the longest. This is the
    // signal that a storm (e.g. 2k accepts) is backed up behind the slot cap.
    #oldestQueuedMs(): number {
        if (this.#queue.length === 0) return 0;
        return this.#deps.now() - this.#queue[0].queuedAtMs;
    }

    #publishGauges(): void {
        this.#deps.metrics.setGauge(
            'device_init_slots_active',
            this.#active.size
        );
        this.#deps.metrics.setGauge(
            'device_init_slots_queued',
            this.#queue.length
        );
        this.#deps.metrics.setGauge(
            'device_init_slot_oldest_held_ms',
            this.#oldestHeldMs()
        );
        this.#deps.metrics.setGauge(
            'device_init_slot_oldest_queued_ms',
            this.#oldestQueuedMs()
        );
    }
}
