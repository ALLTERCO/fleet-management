// Init-frame helpers for /shelly admission.
//
// Devices announce themselves with one of two methods:
//   - `NotifyFullStatus` (ESP32) carries a complete status snapshot in
//     `params`.
//   - `NotifyStatus` (Wall Display) carries a partial snapshot in `params`.
// Both ride in the same field, so callers can unwrap uniformly.

export interface InitMessage {
    method: 'NotifyFullStatus' | 'NotifyStatus';
    src: string;
    // Shelly Gen2 frames carry `dst` (the FM identifier the device was
    // told to call into). Marked optional so a frame without it doesn't
    // get rejected on a field we don't strictly need — but we preserve
    // it when present so downstream handlers see a faithful copy.
    dst?: string;
    params?: unknown;
}

export function isInitMessage(message: {
    method: string;
}): message is InitMessage {
    return (
        message.method === 'NotifyFullStatus' ||
        message.method === 'NotifyStatus'
    );
}

// Unwrap the initial status payload from an init frame. Returns `null`
// when `params` is missing so callers can branch on "no snapshot yet"
// without spreading `undefined` checks.
export function initialStatusFor(message: InitMessage): unknown {
    return message.params ?? null;
}
