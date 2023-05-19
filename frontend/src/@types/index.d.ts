interface ShellyDeviceExternal {
    shellyID: string,
    source: string,
    info: any,
    status: any,
    _statusTs: number | undefined,
    settings: any,
    _settingsTs: number | undefined,
    selected: boolean
    groups: Record<string, string>
}

interface json_rpc_event {
    method: string,
    params: Record<string, any>
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
    interface Disonnect extends Basic {
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
            message: ShellyMessageIncomming,
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