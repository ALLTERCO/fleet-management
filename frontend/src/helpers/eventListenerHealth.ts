// EventDistributor registers one callback per subscribed event name. Browser
// clients subscribe to the full event surface, so the raw callback count grows
// with healthy client fan-out and is not itself a leak signal.

export interface EventListenerLoad {
    eventsListeners: number;
    eventsTypes: number;
    wsClients: number;
}

function nonNegativeFinite(value: number): number {
    return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Callbacks beyond the normal browser-client × registered-event fan-out.
 *
 * With no browser clients this deliberately reduces to the raw listener
 * count, preserving the existing leak threshold for backend-only listeners.
 */
export function eventListenerExcess(load: EventListenerLoad): number {
    const listeners = nonNegativeFinite(load.eventsListeners);
    const clients = nonNegativeFinite(load.wsClients);
    const eventTypes = nonNegativeFinite(load.eventsTypes);
    const expectedClientFanout = clients * eventTypes;
    return Math.max(0, listeners - expectedClientFanout);
}
