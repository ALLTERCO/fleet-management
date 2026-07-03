// Per (rule, subject, component.field) state for stateful evaluators
// (anomaly_band window, change_event previous value), with rule-scoped
// eviction when a rule is edited or removed.

export function ruleFieldKey(
    ruleId: number,
    subjectId: string,
    component: string,
    field: string
): string {
    return `${ruleId} ${subjectId} ${component}.${field}`;
}

// Minimal shape shared by Map and BoundedMap — all these helpers need.
interface KeyedCache {
    keys(): IterableIterator<string>;
    delete(key: string): unknown;
}

export function clearRuleFieldCache(cache: KeyedCache, ruleId: number): void {
    const prefix = `${ruleId} `;
    for (const key of cache.keys()) {
        if (key.startsWith(prefix)) cache.delete(key);
    }
}

// Evict every rule's entries for one device (key = "<ruleId> <subjectId> ...").
// Called on device delete so a removed device leaves no permanent residue.
export function clearRuleFieldCacheForDevice(
    cache: KeyedCache,
    subjectId: string
): void {
    for (const key of cache.keys()) {
        if (key.split(' ')[1] === subjectId) cache.delete(key);
    }
}
