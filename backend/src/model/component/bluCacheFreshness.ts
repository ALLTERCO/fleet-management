// A BLU device.list cache entry is fresh only while unexpired AND the bluetooth
// inventory version is unchanged — so a promote/demote/delete busts it at once,
// not after a blind TTL.
export interface BluCacheFreshness {
    expiresAt: number;
    version: number;
}

export function bluCacheEntryFresh(
    entry: BluCacheFreshness,
    now: number,
    version: number
): boolean {
    return entry.expiresAt > now && entry.version === version;
}
