interface ShellyDeviceExternal {
    shellyID: string,
    source: string,
    info: any,
    status: any,
    settings: any,
    groups: Record<string, string>
}

interface ShellyMessageData {
    jsonrpc: '2.0',
    id: number,
    src: string,
    method: string,
    params?: any
}

interface ShellyMessage {
    data_sent: ShellyMessageData,
    cb?: (result?: ShellyMessageIncoming, err?: any) => void,
}

interface ShellyMessageIncoming {
    id?: number,
    src: string,
    dst: string,
    method: string,
    result?: any,
    params?: any,
    error?: any
}

type ShellyResponseCallback = (resp: ShellyMessageIncoming, req?: ShellyMessageData) => void;

interface ShellyMessageUnsafe {
    method: string,
    id: number,
    src: string,
    params?: object
}

interface message_handler_t {
    resolve: (value: unknown) => void,
    reject: (reason?: any) => void,
    method: string
}

interface json_rpc_event {
    method: string,
    params: Record<string, any>
}

interface user_t {
    username: string,
    password: string,
    permissions: string[],
    group: string,
    enabled: boolean
}

interface PluginInfo {
    name: string,
    version: string,
    description: string,
    config?: Record<string, any> 
}

interface PluginData {
    location: string,
    info: PluginInfo,
}

interface FleetManagerPlugin extends ReturnType<typeof require> {
    load?(properties?: any): void,
    on?(event: json_rpc_event, eventData?: event_data_t): void,
    unload?(): void
}

namespace FleetManagerEvent {
    interface Config extends json_rpc_event {
        method: "FleetManager.Config",
        params: {
            name: 'main' | 'groups',
            config: any
        }
    }
}

namespace ShellyEvent {
    interface Basic extends json_rpc_event {
        method: string,
        params: {
            shellyID: string
        }
    }   
    interface Connect extends Basic {
        method: "Shelly.Connect"
        params: {
            shellyID: string
            device: ShellyDeviceExternal
        }
    }
    interface Disconnect extends Basic {
        method: "Shelly.Disconnect"
        params: { 
            shellyID: string
        }
    }
    interface Info extends Basic {
        method: "Shelly.Info",
        params: {
            shellyID: string,
            info: any
        }
    }
    interface Status extends Basic {
        method: "Shelly.Status"
        params: {
            shellyID: string
            status: any
        }
    }
    interface Settings extends Basic {
        method: "Shelly.Settings"
        params: {
            shellyID: string
            settings: any
        }
    }
    interface Message extends Basic {
        method: "Shelly.Message"
        params: {
            shellyID: string
            message: ShellyMessageIncoming,
            req: ShellyMessageData | undefined
        }
    }
    interface Group extends Basic {
        method: "Shelly.Group"
        params: {
            shellyID: string,
            groups: Record<string, string>
        }
    }
}

declare namespace Express {
    export interface Request {
        token?: string,
        user: user_t | undefined
    }
}