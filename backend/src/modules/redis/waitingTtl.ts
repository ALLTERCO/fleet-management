// TTL for a waiting-room entry. A sleeping (battery) device reports a
// wakeup_period and then disconnects; its entry must outlive that interval so
// it isn't evicted before the device wakes and an operator can accept it. Each
// wake refreshes the entry, so surviving ~2 cycles keeps a live sleeper listed.
// Non-sleepers keep the base TTL. Pure — no I/O.

// Survive roughly two full sleep cycles between wakes.
const SLEEPER_CYCLES = 2;

export function waitingEntryTtlMs(
    wakeupPeriodSec: number | undefined,
    baseTtlMs: number,
    maxTtlMs: number
): number {
    if (!wakeupPeriodSec || wakeupPeriodSec <= 0) return baseTtlMs;
    const sleeperMs = wakeupPeriodSec * SLEEPER_CYCLES * 1000;
    return Math.min(maxTtlMs, Math.max(baseTtlMs, sleeperMs));
}

// A sleeper reports then disconnects to sleep; dropping its entry on socket
// close would defeat the extended TTL. Keep sleepers, drop always-on devices.
export function keepWaitingEntryOnDisconnect(
    wakeupPeriodSec: number | undefined
): boolean {
    return (wakeupPeriodSec ?? 0) > 0;
}

// The sleeper wake interval carried in a sanitized status' sys block, or
// undefined for an always-on device. Single home for the read.
export function wakeupPeriodFromStatus(
    jdoc: Record<string, unknown> | undefined
): number | undefined {
    const sys = jdoc?.sys as {wakeup_period?: unknown} | undefined;
    const value = sys?.wakeup_period;
    return typeof value === 'number' && value > 0 ? value : undefined;
}
