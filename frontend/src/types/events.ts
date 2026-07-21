import type {ENTITY_EVENT, SHELLY_EVENT} from '@/tools/wsEvents';
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
        method: typeof SHELLY_EVENT.CONNECT;
        params: {
            shellyID: string;
            device: ShellyDeviceExternal;
            /** ms epoch — backend emit time. Used to compute end-to-end latency. */
            emittedAt?: number;
        };
    }
    export interface Disconnect extends Basic {
        method: typeof SHELLY_EVENT.DISCONNECT;
        params: {
            shellyID: string;
            /** ms epoch — backend emit time. */
            emittedAt?: number;
        };
    }
    export interface Info extends Basic {
        method: typeof SHELLY_EVENT.INFO;
        params: {
            shellyID: string;
            info: any;
        };
    }
    export interface Status extends Basic {
        method: typeof SHELLY_EVENT.STATUS;
        params: {
            shellyID: string;
            status: any;
            // Set on path-filtered (dashboard) pushes — the client merges,
            // doesn't reconcile-and-prune.
            partial?: boolean;
        };
    }
    export interface Settings extends Basic {
        method: typeof SHELLY_EVENT.SETTINGS;
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
        method: typeof SHELLY_EVENT.KVS;
        params: {
            shellyID: string;
            kvs: Record<string, string>;
        };
    }

    export interface Presence extends Basic {
        method: typeof SHELLY_EVENT.PRESENCE;
        params: {
            shellyID: string;
            presence: presence;
        };
    }
    export interface PresenceTrack extends Basic {
        method: typeof SHELLY_EVENT.PRESENCE_TRACK;
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
        method: typeof ENTITY_EVENT.ADDED;
        params: {
            entityId: string;
        };
    }

    export interface Removed extends Basic {
        method: typeof ENTITY_EVENT.REMOVED;
        params: {
            entityId: string;
        };
    }
}
