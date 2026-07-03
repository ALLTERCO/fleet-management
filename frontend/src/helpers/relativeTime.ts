/** Relative-time formatter for the focus card — handles zero-timestamp sentinel. */

import {formatRelative} from './format';

/** Returns a human-readable relative time string for a wall-clock millisecond timestamp.
 *  When ts is 0 the timestamp is unknown and "—" is returned. */
export function formatRelativeTime(ts: number): string {
    if (ts === 0) return '—';
    return formatRelative(ts);
}
