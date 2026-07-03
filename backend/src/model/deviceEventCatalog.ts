// Per-device event catalog from Webhook.ListAllSupported. Pure data.

export interface EventAttribute {
    name: string;
    type: 'boolean' | 'number' | 'string';
    desc: string;
}

export interface EventDescriptor {
    component: string;
    event: string;
    attrs: ReadonlyArray<EventAttribute>;
}

export interface DeviceEventCatalog {
    byEventName: ReadonlyMap<string, ReadonlyArray<EventDescriptor>>;
    all: ReadonlyArray<EventDescriptor>;
    advertisedTotal: number;
    complete: boolean;
    fetchedAtMs: number;
    fwIdAtFetch?: string;
}

interface RawTypeEntry {
    [key: string]: {attrs?: ReadonlyArray<EventAttribute>} | undefined;
}

interface RawListAllSupported {
    types?: ReadonlyArray<RawTypeEntry>;
    total?: number;
}

export interface BuildCatalogInput {
    pages: ReadonlyArray<RawListAllSupported>;
    nowMs: number;
    fwId?: string;
}

export function buildEventCatalog(
    input: BuildCatalogInput
): DeviceEventCatalog {
    const all: EventDescriptor[] = [];
    const byEventName = new Map<string, EventDescriptor[]>();
    for (const page of input.pages) {
        if (!Array.isArray(page.types)) continue;
        for (const entry of page.types) {
            const descriptor = descriptorFromEntry(entry);
            if (!descriptor) continue;
            all.push(descriptor);
            appendByEventName(byEventName, descriptor);
        }
    }
    const advertisedTotal = input.pages.reduce(
        (n, p) => Math.max(n, p.total ?? 0),
        0
    );
    return {
        byEventName,
        all,
        advertisedTotal,
        complete: all.length >= advertisedTotal,
        fetchedAtMs: input.nowMs,
        ...(input.fwId ? {fwIdAtFetch: input.fwId} : {})
    };
}

function descriptorFromEntry(entry: RawTypeEntry): EventDescriptor | undefined {
    const keys = Object.keys(entry);
    if (keys.length !== 1) return undefined;
    const composite = keys[0];
    const dotAt = composite.indexOf('.');
    if (dotAt === -1) return undefined;
    const attrs = entry[composite]?.attrs ?? [];
    return {
        component: composite.slice(0, dotAt),
        event: composite.slice(dotAt + 1),
        attrs
    };
}

function appendByEventName(
    map: Map<string, EventDescriptor[]>,
    descriptor: EventDescriptor
): void {
    const existing = map.get(descriptor.event);
    if (existing) existing.push(descriptor);
    else map.set(descriptor.event, [descriptor]);
}

export function findDescriptor(
    catalog: DeviceEventCatalog,
    componentKey: string,
    eventName: string
): EventDescriptor | undefined {
    const componentType = stripInstance(componentKey);
    const candidates = catalog.byEventName.get(eventName);
    if (!candidates) return undefined;
    return candidates.find((d) => d.component === componentType);
}

function stripInstance(componentKey: string): string {
    const colon = componentKey.indexOf(':');
    return colon === -1 ? componentKey : componentKey.slice(0, colon);
}
