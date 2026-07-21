export interface entity {
    name: string;
    id: string;
    type: string;
    source: string;
    properties: {
        id: number;
        errors?: string[];
        deviceProfile?: string;
        embeddedIn?: string;
        /** BTHome sensor object name (e.g. 'temperature', 'humidity') */
        objName?: string;
        /** Measurement unit (e.g. '°C', '%', 'lux') */
        unit?: string;
        /** BTHome sensor type identifier */
        sensorType?: string;
        /** Input component type (button, analog, switch, count) */
        type?: string;
    } & object;
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
    properties: entity['properties'] & {
        sensorSource?: 'addon';
    };
}

export interface temperature_entity extends entity {
    type: 'temperature';
    properties: entity['properties'] & {
        extSensorId?: string;
        sensorSource?: 'blu' | 'addon';
        embeddedIn?: string;
        deviceProfile?: string;
    };
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
        objName?: string;
        addr?: string;
        bleProductName?: string;
        bleModelId?: string;
        bleDisplayName?: string;
        parentDeviceKey?: string;
    };
}

export interface bthomedevice_entity extends entity {
    type: 'bthomedevice';
    properties: entity['properties'] & {
        addr: string;
        productName: string;
        modelId: string;
        paired: boolean;
        /** Backend-normalised controls. Render using `kind` and `label` —
         *  do not hardcode objId→kind mapping on the frontend. */
        controls: Array<{
            objId: number;
            idx: number;
            kind: 'button' | 'dimmer';
            label: string;
        }>;
        childSensorIds: string[];
        /** BTHome obj_ids that are device-level events — not addable as sensors */
        eventObjIds: number[];
        /** Errors from BTHomeDevice status (e.g. key_missing_or_bad) */
        errors?: string[];
    };
}

export interface bthomecontrol_entity extends entity {
    type: 'bthomecontrol';
    properties: entity['properties'] & {
        addr?: string;
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
        // Optional: composed virtual device roles may not carry these.
        unit?: string;
        min?: number;
        max?: number;
        step?: number;
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
        // Optional: composed virtual device roles may not carry options.
        options?: Record<string, string>;
    };
}

export interface virtual_button_entity extends entity {
    type: 'button' | string;
    properties: entity['properties'] & {
        view: string;
    };
}

export interface virtual_group_entity extends entity {
    type: 'group';
    properties: entity['properties'] & {
        members: string[];
    };
}

export type virtual_component_t =
    | virtual_boolean_entity
    | virtual_number_entity
    | virtual_text_entity
    | virtual_enum_entity
    | virtual_button_entity
    | virtual_group_entity;

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
    properties: entity['properties'] & {
        extSensorId?: string;
        sensorSource?: 'blu' | 'addon';
    };
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

export interface rgb_entity extends entity {
    type: 'rgb';
}

export interface rgbw_entity extends entity {
    type: 'rgbw';
}

export interface flood_entity extends entity {
    type: 'flood';
    properties: entity['properties'] & {
        alarm_mode: string;
        mute: boolean;
    };
}

export interface smoke_entity extends entity {
    type: 'smoke';
}

export interface devicepower_entity extends entity {
    type: 'devicepower';
    properties: entity['properties'] & {
        extSensorId?: string;
        sensorSource?: 'blu' | 'addon';
    };
}

// Wall Display entity types
export interface illuminance_entity extends entity {
    type: 'illuminance';
}

export interface thermostat_entity extends entity {
    type: 'thermostat';
}

export interface media_entity extends entity {
    type: 'media';
}

export interface ui_entity extends entity {
    type: 'ui';
}

export interface matter_entity extends entity {
    type: 'matter';
}

export interface camera_entity extends entity {
    type: 'camera';
}

export interface schedule_entity extends entity {
    type: 'schedule';
}

export interface presence_entity extends entity {
    type: 'presence';
}

export interface presencezone_entity extends entity {
    type: 'presencezone';
}

export interface camerazone_entity extends entity {
    type: 'camerazone';
}

export interface service_entity extends entity {
    type: 'service';
    properties: entity['properties'] & {
        /** Service type from jwt.xt1.svc0.type (e.g. "linkedgo-st-802-hvac") */
        serviceType: string;
        /** Backend-resolved card category — frontends must not regex serviceType */
        category: 'hvac' | 'valve' | 'ev_charger' | 'irrigation' | 'generic';
        /** Service component key (e.g. "service:0") */
        serviceKey: string;
        /** Product name from jwt.n (e.g. "Youth Smart Thermostat ST802") */
        productName: string;
        /** Resource role → full component key (e.g. "enable" → "boolean:201") */
        components: Record<string, string>;
    };
}

export interface blutrv_entity extends entity {
    type: 'blutrv';
    properties: entity['properties'] & {
        addr: string;
        /** Shelly ID of the gateway this TRV is attached to */
        gatewayId: string;
        /** BLE link state (device status.connected) */
        connected: boolean;
        /** Target temperature in °C (device status.target_C) */
        target_C: number | null;
        /** Measured room temperature in °C (device status.current_C) */
        current_C: number | null;
        /** Valve position 0-100 (device status.pos). Heating = pos > 0. */
        pos: number | null;
        /** Battery level 0-100 (device status.battery) */
        battery: number | null;
        /** BLE signal strength dBm (device status.rssi) */
        rssi: number | null;
        /** Unix timestamp of last broadcast (device status.last_updated_ts) */
        lastUpdatedTs: number | null;
    };
}

export type entity_t =
    | input_entity
    | switch_entity
    | temperature_entity
    | em1_entity
    | em_entity
    | light_entity
    | bthomesensor_entity
    | bthomedevice_entity
    | bthomecontrol_entity
    | virtual_component_t
    | rgb_entity
    | rgbw_entity
    | cover_entity
    | pm1_entity
    | cury_entity
    | humidity_entity
    | voltmeter_entity
    | cct_entity
    | rgbcct_entity
    | flood_entity
    | smoke_entity
    | devicepower_entity
    | illuminance_entity
    | thermostat_entity
    | media_entity
    | ui_entity
    | matter_entity
    | camera_entity
    | schedule_entity
    | presence_entity
    | presencezone_entity
    | camerazone_entity
    | service_entity
    | blutrv_entity;
