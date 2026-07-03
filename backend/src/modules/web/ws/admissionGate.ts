// Slow-start admission gate per WS cohort. IOTC pattern: cap accepts
// per second; over-cap upgrades close the socket immediately so the
// device falls back to its own reconnect backoff.

import * as Observability from '../../Observability';
import {
    type AdmissionState,
    canAccept,
    newAdmissionState,
    recordAccept
} from './admissionCounter';

export interface AdmissionGateOptions {
    label: string;
    capPerSec: number;
    now?: () => number;
}

export class AdmissionGate {
    readonly #label: string;
    readonly #capPerSec: number;
    readonly #now: () => number;
    #state: AdmissionState;

    constructor(opts: AdmissionGateOptions) {
        this.#label = opts.label;
        this.#capPerSec = opts.capPerSec;
        this.#now = opts.now ?? (() => Date.now());
        this.#state = newAdmissionState(this.#now());
    }

    // Disabled gate always admits; otherwise check + record.
    tryAdmit(): boolean {
        if (this.#capPerSec <= 0) return true;
        const now = this.#now();
        if (!canAccept(this.#state, this.#capPerSec, now)) {
            Observability.incrementLabeledCounter(
                'ws_admission_rejected_total',
                {cohort: this.#label}
            );
            return false;
        }
        this.#state = recordAccept(this.#state, now);
        return true;
    }
}
