// Turn a refused device action into a message worth showing the user.
//
// The backend passes the device's own reason through, wrapped as
// "<Method> failed: [Precondition failed: ]<reason>[! <detail>]". We surface
// the human reason (e.g. "Output not calibrated") instead of a generic
// "Command failed", for any refusal — not just calibration.

function rawMessage(error: unknown): string {
    if (!error || typeof error !== 'object') return '';
    const e = error as {message?: unknown; data?: {message?: unknown}};
    if (typeof e.message === 'string') return e.message;
    if (e.data && typeof e.data.message === 'string') return e.data.message;
    return '';
}

/** Extract the human reason from the backend's wrapped device error. */
function extractReason(raw: string): string {
    let msg = raw;
    // Prefer the text after "Precondition failed:", else after "failed:".
    const precond = msg.indexOf('Precondition failed:');
    if (precond !== -1) {
        msg = msg.slice(precond + 'Precondition failed:'.length);
    } else {
        const failed = msg.lastIndexOf('failed:');
        if (failed !== -1) msg = msg.slice(failed + 'failed:'.length);
    }
    // The human sentence ends at the first "!" (detail after it is technical).
    return msg.split('!')[0].trim();
}

/** User-facing message for a failed card action. `context` names the action
 *  (e.g. "Brightness"); the reason comes from the device when available. */
export function deviceActionErrorMessage(
    error: unknown,
    context?: string
): string {
    const reason = extractReason(rawMessage(error));
    if (reason) return context ? `${context}: ${reason}` : reason;
    return context ? `${context} failed` : 'Command failed';
}
