import {BoundedConcurrency} from '../util/boundedConcurrency';

export interface BluReconcileCapacitySnapshot {
    active: number;
    queued: number;
}

export type BluReconcileCapacityObserver = (
    snapshot: BluReconcileCapacitySnapshot
) => void;

// Process-wide capacity gate for gateway reconciliation. Per-gateway
// coalescing remains owned by BluChildReconcileCoordinator; this gate only
// prevents distinct gateways from creating unbounded concurrent DB work.
export class BluReconcileConcurrency {
    readonly #gate: BoundedConcurrency | undefined;
    readonly #observe: BluReconcileCapacityObserver;

    constructor(
        maxConcurrent: number,
        queueMax: number,
        observe: BluReconcileCapacityObserver = () => {},
        onReject: () => void = () => {}
    ) {
        this.#observe = observe;
        this.#gate =
            maxConcurrent > 0
                ? new BoundedConcurrency(maxConcurrent, queueMax, onReject)
                : undefined;
    }

    async run(task: () => Promise<boolean>): Promise<boolean> {
        if (!this.#gate) return task();

        let outcome = false;
        const execution = this.#gate.run(async () => {
            this.#observe(this.#gate?.stats() ?? {active: 0, queued: 0});
            outcome = await task();
        });
        this.#observe(this.#gate.stats());

        try {
            const admitted = await execution;
            return admitted && outcome;
        } finally {
            this.#observe(this.#gate.stats());
        }
    }

    stats(): BluReconcileCapacitySnapshot {
        return this.#gate?.stats() ?? {active: 0, queued: 0};
    }
}
