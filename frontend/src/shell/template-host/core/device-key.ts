// One owner for "which string identifies this device in a list, a map or a
// key prop". Templates hand-wrote this expression well over a hundred times,
// and the copies disagreed about the operator.

import type {HostDevice} from './types';

/** Enough of a device to be identified: `id` is always there, `shellyID` is
 * the routing identifier and can be missing on a partially mapped row. */
export type DeviceKeyInput = Pick<HostDevice, 'id'> &
    Partial<Pick<HostDevice, 'shellyID'>>;

/**
 * The stable string key for a device.
 *
 * Coalesces with `??`, never `||`: `||` also falls through on an empty
 * `shellyID`, which silently swaps a device's key for its numeric id and
 * remounts every row that had one.
 */
export function deviceKey(device: DeviceKeyInput): string {
    return String(device.shellyID ?? device.id);
}
