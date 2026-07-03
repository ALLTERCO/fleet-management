// Sliding 1-second counter for accepted connections. Pure functions —
// state is owned by the caller. Matches IOTC's slowStart() semantics.

export interface AdmissionState {
    windowStartMs: number;
    countInWindow: number;
}

export function newAdmissionState(nowMs: number): AdmissionState {
    return {windowStartMs: nowMs, countInWindow: 0};
}

// True when accepting one more would stay inside the per-second cap.
export function canAccept(
    state: AdmissionState,
    capPerSecond: number,
    nowMs: number
): boolean {
    const refreshed = rolloverIfStale(state, nowMs);
    return refreshed.countInWindow < capPerSecond;
}

export function recordAccept(
    state: AdmissionState,
    nowMs: number
): AdmissionState {
    const refreshed = rolloverIfStale(state, nowMs);
    return {
        windowStartMs: refreshed.windowStartMs,
        countInWindow: refreshed.countInWindow + 1
    };
}

function rolloverIfStale(state: AdmissionState, nowMs: number): AdmissionState {
    if (nowMs - state.windowStartMs >= 1000) {
        return {windowStartMs: nowMs, countInWindow: 0};
    }
    return state;
}
