/** Every field any BLU surface has ever had to name a device from: a live
 *  sighting, a paired child, or a wizard candidate. All optional, because
 *  which ones arrive depends on what the device broadcast. */
export type BluNameable = {
    name?: string | null;
    productName?: string | null;
    modelId?: string | null;
    localName?: string | null;
    addr?: string | null;
};

const UNKNOWN = 'Unknown device';

function clean(value: string | null | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}

/** Most specific first: what a person named it, then what it says it is. */
export function bluDisplayName(device: BluNameable): string {
    return (
        clean(device.name) ??
        clean(device.productName) ??
        clean(device.modelId) ??
        clean(device.localName) ??
        clean(device.addr) ??
        UNKNOWN
    );
}

/** The identifying detail the title did not already carry, address last. */
export function bluDetailLine(device: BluNameable): string {
    const title = bluDisplayName(device).toLowerCase();
    const seen = new Set<string>([title]);
    const details: string[] = [];

    for (const value of [device.localName, device.modelId, device.addr]) {
        const detail = clean(value);
        if (!detail) continue;
        const key = detail.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        details.push(detail);
    }
    return details.join(' / ');
}
