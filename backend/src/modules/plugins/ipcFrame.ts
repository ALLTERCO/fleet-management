// Pure validation for plugin worker IPC frames. Lives outside worker.ts so it
// can be unit-tested without spinning up a worker_thread. OWASP API4:2023
// caps size + arity at the IPC boundary so a malicious or buggy parent
// can't pump unbounded payloads or shape-mismatched frames into the worker.

// Per-method expected `others.length` (the frame minus the leading method
// string). Methods not listed here skip the arity check (e.g. 'load' has 0).
export const EXPECTED_IPC_ARITY: Readonly<Record<string, number>> = {
    load: 0,
    unload: 0,
    on: 2,
    add_metadata: 3,
    command_called: 5,
    commander_response: 3
};

export type IpcFrameValidation =
    | {ok: true; method: string; others: unknown[]}
    | {ok: false; reason: string; idForReject?: unknown};

export function validateIpcFrame(
    args: unknown,
    maxBytes: number
): IpcFrameValidation {
    if (!Array.isArray(args) || args.length === 0) {
        return {ok: false, reason: 'ipc frame must be a non-empty array'};
    }
    let serializedLen: number;
    try {
        serializedLen = JSON.stringify(args).length;
    } catch {
        return {ok: false, reason: 'ipc frame is not JSON-serializable'};
    }
    if (serializedLen > maxBytes) {
        return {ok: false, reason: 'ipc frame exceeds size cap'};
    }
    const [method, ...others] = args as [unknown, ...unknown[]];
    if (typeof method !== 'string') {
        return {ok: false, reason: 'ipc method must be a string'};
    }
    const expected = EXPECTED_IPC_ARITY[method];
    if (expected !== undefined && others.length !== expected) {
        return {
            ok: false,
            reason: `ipc method=${method} expected ${expected} args, got ${others.length}`,
            // command_called puts the request id at others[0]; on reject we
            // can echo it back so the parent's pending promise rejects too.
            idForReject: others[0]
        };
    }
    return {ok: true, method, others};
}
