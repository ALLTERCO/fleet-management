import type {presence, ShellyDeviceExternal} from './device';
import type {
    json_rpc_event,
    ShellyMessageData,
    ShellyMessageIncoming
} from './rpc';

export type build_t = 'discovered' | 'devices' | 'report';

export interface discovered_t {
    node_name: string;
    name: string;
    app: string;
    ver: string;
    gen: string;
}

export interface event_t {
    timestamp: number;
    shellyID: string;
    method: string;
    data: object;
}

export namespace ShellyEvent {
    export interface Basic extends json_rpc_event {
        method: string;
        params: {
            shellyID: string;
        };
    }
    export interface Connect extends Basic {
        method: 'Shelly.Connect';
        params: {
            shellyID: string;
            device: ShellyDeviceExternal;
            /** ms epoch — backend emit time. Used to compute end-to-end latency. */
            emittedAt?: number;
        };
    }
    export interface Disconnect extends Basic {
        method: 'Shelly.Disconnect';
        params: {
            shellyID: string;
            /** ms epoch — backend emit time. */
            emittedAt?: number;
        };
    }
    export interface Info extends Basic {
        method: 'Shelly.Info';
        params: {
            shellyID: string;
            info: any;
        };
    }
    export interface Status extends Basic {
        method: 'Shelly.Status';
        params: {
            shellyID: string;
            status: any;
        };
    }
    export interface Settings extends Basic {
        method: 'Shelly.Settings';
        params: {
            shellyID: string;
            settings: any;
        };
    }
    export interface Message extends Basic {
        method: 'Shelly.Message';
        params: {
            shellyID: string;
            message: ShellyMessageIncoming;
            req: ShellyMessageData | undefined;
        };
    }
    export interface KVS extends Basic {
        method: 'Shelly.KVS';
        params: {
            shellyID: string;
            kvs: Record<string, string>;
        };
    }

    export interface Presence extends Basic {
        method: 'Shelly.Presence';
        params: {
            shellyID: string;
            presence: presence;
        };
    }
    export interface PresenceTrack extends Basic {
        method: 'Shelly.PresenceTrack';
        params: {
            shellyID: string;
            objects: Array<{
                id: number;
                x: number;
                y: number;
                z: number;
                minz: number;
                maxz: number;
            }>;
            ts: number;
        };
    }
}

export namespace EntityEvent {
    export interface Basic extends json_rpc_event {
        method: string;
        params: {
            entityId: string;
        };
    }

    export interface Added extends Basic {
        method: 'Entity.Added';
        params: {
            entityId: string;
        };
    }

    export interface Removed extends Basic {
        method: 'Entity.Removed';
        params: {
            entityId: string;
        };
    }

    export interface StatusChange extends Basic {
        method: 'Entity.StatusChange';
        params: {
            entityId: string;
            status: any;
        };
    }
}
