// Cluster-wide cap on concurrent device-init slots — IOTN reservation pattern.
// Wraps the ReservationPort with a fail-open shortcut when cap<=0.

import {tuning} from '../../../../config/tuning';
import * as Observability from '../../../Observability';
import type {Reservation, ReservationPort} from '../../../redis/ports';
import {reservation as defaultReservation} from '../../../redis/services';

export const CLUSTER_INIT_KEY = 'fm:device-inits-cluster';

interface ClusterInitConfig {
    cap: number;
    ttlSec: number;
}

export interface ClusterSlotDeps {
    reservation?: ReservationPort;
    config?: ClusterInitConfig;
    onRejected?: () => void;
}

function effectiveConfig(deps: ClusterSlotDeps): ClusterInitConfig {
    return (
        deps.config ?? {
            cap: tuning.device.initsClusterCap,
            ttlSec: tuning.device.initsClusterTtlSec
        }
    );
}

export async function acquireClusterInitSlot(
    deps: ClusterSlotDeps = {}
): Promise<Reservation> {
    const cfg = effectiveConfig(deps);
    if (cfg.cap <= 0) {
        return {ok: true, release: async () => {}};
    }
    const port = deps.reservation ?? defaultReservation;
    const r = await port.reserve(CLUSTER_INIT_KEY, cfg.cap, cfg.ttlSec);
    if (r.ok) return r;
    // Fail open on a Redis outage: the per-instance AdmissionGate still bounds
    // the burst, so losing the global cap beats locking the fleet out.
    if (r.reason === 'backend_error') {
        Observability.incrementCounter('device_inits_cluster_degraded_open');
        return {ok: true, release: async () => {}};
    }
    (deps.onRejected ?? defaultOnRejected)();
    return r;
}

export async function releaseClusterSlot(slot: Reservation): Promise<void> {
    if (slot.ok) await slot.release();
}

function defaultOnRejected(): void {
    Observability.incrementCounter('device_inits_cluster_rejected');
}
