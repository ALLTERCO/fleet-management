import * as log4js from 'log4js';
import {loadRetiredExternalIds} from './PostgresProvider';

// In-memory set of retired (soft-deleted) device external ids. A retired device
// can stay in the device collector while it keeps reporting, so this set is the
// single chokepoint that hides retired devices from live fleet lists. Seeded
// once at boot and kept current by the retire/restore RPCs.

const logger = log4js.getLogger('retired-devices');
const retired = new Set<string>();

export function markRetired(externalId: string): void {
    retired.add(externalId);
}

export function markRestored(externalId: string): void {
    retired.delete(externalId);
}

export function isRetired(externalId: string): boolean {
    return retired.has(externalId);
}

// Drop retired devices from a list. The one place device lists hide them, so
// production and tests exercise the identical predicate.
export function excludeRetired<T extends {shellyID: string}>(
    devices: readonly T[]
): T[] {
    return devices.filter((d) => !retired.has(d.shellyID));
}

// Seed from the database so retired devices stay hidden across restarts.
export async function seedRetiredDevices(): Promise<void> {
    const ids = await loadRetiredExternalIds();
    retired.clear();
    for (const id of ids) retired.add(id);
    logger.info('retired-device set seeded: %d device(s)', retired.size);
}
