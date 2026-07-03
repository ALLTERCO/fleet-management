// Two-level cache: device key -> componentKey -> value. A cached null stays
// distinct from "never looked up" via a sentinel, so callers skip repeat
// lookups for known-absent entries.

const NULL = Symbol('device-cache-null');

export class NullableDeviceCache<K, V> {
    protected byDevice = new Map<K, Map<string, V | typeof NULL>>();

    get(device: K, componentKey: string): V | null | undefined {
        const perDevice = this.byDevice.get(device);
        if (!perDevice) return undefined;
        const v = perDevice.get(componentKey);
        if (v === undefined) return undefined;
        return v === NULL ? null : v;
    }

    set(device: K, componentKey: string, value: V | null): void {
        let perDevice = this.byDevice.get(device);
        if (!perDevice) {
            perDevice = new Map();
            this.byDevice.set(device, perDevice);
        }
        perDevice.set(componentKey, value ?? NULL);
    }

    // Replace a device's entries wholesale (bulk load / refresh).
    protected seed(device: K, entries: Iterable<readonly [string, V]>): void {
        const perDevice = new Map<string, V | typeof NULL>();
        for (const [key, value] of entries) perDevice.set(key, value);
        this.byDevice.set(device, perDevice);
    }

    invalidateOne(device: K, componentKey: string): void {
        this.byDevice.get(device)?.delete(componentKey);
    }

    invalidateDevice(device: K): void {
        this.byDevice.delete(device);
    }

    invalidateAll(): void {
        this.byDevice.clear();
    }

    deviceCount(): number {
        return this.byDevice.size;
    }

    size(): number {
        let total = 0;
        for (const perDevice of this.byDevice.values()) total += perDevice.size;
        return total;
    }
}
