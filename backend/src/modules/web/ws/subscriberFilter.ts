// Per-subscriber whitelist (IOTN Client:DeviceWhiteList pattern).
// Pure predicate + a registry keyed by socket for per-connection state.

export interface FilterableEvent {
    eventType?: string;
    deviceId?: string;
}

export interface SubscriberFilter {
    /** When set, only events with eventType in this set deliver. */
    eventTypes?: ReadonlySet<string>;
    /** When set, only events with deviceId in this set deliver. */
    deviceIds?: ReadonlySet<string>;
}

// Fail-closed: a set dimension whose event field is missing blocks delivery.
export function shouldDeliver(
    filter: SubscriberFilter | undefined,
    event: FilterableEvent
): boolean {
    if (!filter) return true;
    if (filter.eventTypes) {
        if (event.eventType === undefined) return false;
        if (!filter.eventTypes.has(event.eventType)) return false;
    }
    if (filter.deviceIds) {
        if (event.deviceId === undefined) return false;
        if (!filter.deviceIds.has(event.deviceId)) return false;
    }
    return true;
}

// Bounded WeakMap keeps GC honest — entry vanishes when the socket
// reference is no longer reachable.
export class SubscriberFilterRegistry<TSocket extends object> {
    readonly #filters = new WeakMap<TSocket, SubscriberFilter>();

    set(socket: TSocket, filter: SubscriberFilter): void {
        this.#filters.set(socket, filter);
    }

    clear(socket: TSocket): void {
        this.#filters.delete(socket);
    }

    get(socket: TSocket): SubscriberFilter | undefined {
        return this.#filters.get(socket);
    }
}
