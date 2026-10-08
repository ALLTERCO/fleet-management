// The only seam between the SDK core and the host application.

/** A live Fleet event as delivered by the host connection. */
export type FleetEvent = {
    method: string;
    params: Record<string, unknown>;
};

/** What a consumer wants to hear about. `shellyIDs` narrows to devices. */
export type FleetSubscriptionRequest = {
    events: readonly string[];
    shellyIDs?: readonly string[];
};

export interface FleetRpcTransport {
    call<TResult>(method: string, params: object): Promise<TResult>;
}

export interface FleetEventTransport {
    /** Release is idempotent and must not disturb another consumer. */
    subscribe(
        request: FleetSubscriptionRequest,
        listener: (event: FleetEvent) => void
    ): Promise<() => void>;
}

export interface FleetTransport
    extends FleetRpcTransport,
        FleetEventTransport {}
