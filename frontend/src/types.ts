export type presence = 'online' | 'offline' | 'pending';

export interface shelly_device_t {
    id: number;
    shellyID: string;
    status: any;
    settings: any;
    info: any;
    online: boolean;
    loading: boolean;
    selected: boolean;
    entities: string[];
    meta: any;
}

interface ShellyMessageIncoming {
    id?: number;
    src: string;
    dst: string;
    method: string;
    result?: any;
    params?: any;
    error?: any;
}

interface ShellyMessageData {
    jsonrpc: '2.0';
    id: number;
    src: string;
    method: string;
    params?: any;
}

export interface ShellyDeviceExternal {
    id: number;
    presence: presence;
    shellyID: string;
    source: string;
    info: any;
    status: any;
    _statusTs: number | undefined;
    settings: any;
    _settingsTs: number | undefined;
    selected: boolean;
    kvs: Record<string, string>;
    entities: string[];
    meta: any;
}

export interface json_rpc_event {
    method: string;
    params: Record<string, any>;
}

export namespace FleetManagerEvent {
    export interface Config extends json_rpc_event {
        method: 'FleetManager.Config';
        params: {
            name: 'main';
            config: any;
        };
    }
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
        };
    }
    export interface Disconnect extends Basic {
        method: 'Shelly.Disconnect';
        params: {
            shellyID: string;
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

export interface shelly_device {
    mac: string;
    selected: boolean;
    status?: any;
    setting?: any;
}

export interface rpc_req_t {
    method: string;
    rowData: [string, string][];
}

export interface history_t {
    timestamp: number;
    device_mac: string;
    request: rpc_req_t;
    response: string;
}

export type notification_type_t = 'success' | 'info' | 'warning' | 'error';

export interface rpc_interface_group {
    name: string;
    method: string;
    rowData: [string, string][];
}

export interface rpc_template {
    [key: string]: rpc_interface_group[];
}

export interface response_t {
    mac: string;
    response: string;
}

export interface tag_t {
    [key: string]: {
        label: string;
        addon?: {label: string; color: string};
        click_cb?: () => void;
    };
}

interface entity {
    name: string;
    id: string;
    type: string;
    source: string;
    properties: {id: number} & object;
}

export interface input_entity extends entity {
    type: 'input';
    properties: entity['properties'] & {
        type: 'button' | 'analog' | 'switch' | 'count';
        unit?: string;
    };
}

export interface switch_entity extends entity {
    type: 'switch';
}

export interface temperature_entity extends entity {
    type: 'temperature';
}

export interface em1_entity extends entity {
    type: 'em1';
}

export interface em_entity extends entity {
    type: 'em';
}

export interface light_entity extends entity {
    type: 'light';
}

export interface bthomesensor_entity extends entity {
    type: 'bthomesensor';
    properties: entity['properties'] & {
        unit: string;
        sensorType?: string;
    };
}
export interface virtual_boolean_entity extends entity {
    type: 'boolean' | string;
    properties: entity['properties'] & {
        view: null | 'label' | 'toggle';
        labelTrue: string;
        labelFalse: string;
    };
}

export interface virtual_number_entity extends entity {
    type: 'number' | string;
    properties: entity['properties'] & {
        view: null | 'label' | 'field' | 'slider' | 'progressbar';
        unit: string;
        min: number;
        max: number;
        step: number;
    };
}

export interface virtual_text_entity extends entity {
    type: 'text' | string;
    properties: entity['properties'] & {
        view: null | 'label' | 'field' | 'image';
        maxLength: number;
    };
}

export interface virtual_enum_entity extends entity {
    type: 'enum' | string;
    properties: entity['properties'] & {
        view: null | 'label' | 'dropdown';
        options: Record<string, string>;
    };
}

export interface virtual_button_entity extends entity {
    type: 'button' | string;
    properties: entity['properties'] & {
        view: string;
    };
}

export type virtual_component_t =
    | virtual_boolean_entity
    | virtual_number_entity
    | virtual_text_entity
    | virtual_enum_entity
    | virtual_button_entity;

export interface cover_entity extends entity {
    type: 'cover';
    properties: entity['properties'] & {
        favorites: number[];
    };
}

export interface pm1_entity extends entity {
    type: 'pm1';
}

export interface cury_entity extends entity {
    type: 'cury';
    properties: entity['properties'] & {
        mode?: string;
        awayMode?: boolean;
    };
}

export interface humidity_entity extends entity {
    type: 'humidity';
}

export interface voltmeter_entity extends entity {
    type: 'voltmeter';
}

export interface cct_entity extends entity {
    type: 'cct';
}

export interface rgbcct_entity extends entity {
    type: 'rgbcct';
}

export type entity_t =
    | input_entity
    | switch_entity
    | temperature_entity
    | em1_entity
    | em_entity
    | light_entity
    | bthomesensor_entity
    | virtual_component_t
    | cover_entity
    | pm1_entity
    | cury_entity
    | humidity_entity
    | voltmeter_entity
    | cct_entity
    | rgbcct_entity;

export interface dashboard_t {
    name: string;
    id: number | string;
    items: any[];
}

export interface dashboard_entry_t {
    type: 'entity' | 'iframe' | 'group' | 'device';
    col_width: number;
    col_height: number;
    data: any;
}

export interface action_t {
    name: string;
    id: string;
    type: string;
    actions: any[];
}
