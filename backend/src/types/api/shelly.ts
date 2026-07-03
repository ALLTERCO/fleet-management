// Shelly.* — device admin / identity / lifecycle methods (Gen2+).

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';

const SHELLY_ID = SHELLY_ID_SCHEMA;
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};
const PERM_EXECUTE = {component: 'devices', operation: 'execute' as const};

const RESP_NULL: JsonSchema = {
    type: 'null',
    description: 'Returns null on success'
};
const RESP_OPAQUE: JsonSchema = {
    type: 'object',
    description: 'Device-defined response — shape not publicly fixed by Shelly'
};

const P_SHELLY_ONLY: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

// ── Lifecycle (relocated from device ns) ─────────────────────────────

export interface ShellyRebootParams {
    shellyID: string;
}
export const SHELLY_REBOOT_PARAMS_SCHEMA = P_SHELLY_ONLY;

export interface ShellyFactoryResetParams {
    shellyID: string;
}
export const SHELLY_FACTORY_RESET_PARAMS_SCHEMA = P_SHELLY_ONLY;

export interface ShellyCheckForUpdateParams {
    shellyID: string;
}
export const SHELLY_CHECK_FOR_UPDATE_PARAMS_SCHEMA = P_SHELLY_ONLY;

// Shelly.Update — at least one of stage|url; "not both" is a handler guard.
export interface ShellyUpdateParams {
    shellyID: string;
    stage?: string;
    url?: string;
}
export const SHELLY_UPDATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        stage: {type: 'string'},
        url: {type: 'string'}
    },
    anyOf: [{required: ['stage']}, {required: ['url']}]
};

export interface ShellySetProfileParams {
    shellyID: string;
    name: string;
}
export const SHELLY_SET_PROFILE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'name'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        name: {type: 'string'}
    }
};

export interface ShellyListProfilesParams {
    shellyID: string;
}
export const SHELLY_LIST_PROFILES_PARAMS_SCHEMA = P_SHELLY_ONLY;

// ── Identity / diagnostics (new) ─────────────────────────────────────

export interface ShellyGetDeviceInfoParams {
    shellyID: string;
    ident?: boolean;
}
export const SHELLY_GET_DEVICE_INFO_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        ident: {type: 'boolean'}
    }
};

export interface ShellyGetStatusParams {
    shellyID: string;
}
export const SHELLY_GET_STATUS_PARAMS_SCHEMA = P_SHELLY_ONLY;

export interface ShellyGetConfigParams {
    shellyID: string;
}
export const SHELLY_GET_CONFIG_PARAMS_SCHEMA = P_SHELLY_ONLY;

// Shelly.GetComponents — paginated, opt-in extras via include[].
export interface ShellyGetComponentsParams {
    shellyID: string;
    offset?: number;
    include?: string[];
    dynamic_only?: boolean;
    keys?: string[];
}
export const SHELLY_GET_COMPONENTS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        offset: {type: 'integer'},
        include: {type: 'array', items: {type: 'string'}},
        dynamic_only: {type: 'boolean'},
        keys: {type: 'array', items: {type: 'string'}}
    }
};

export interface ShellyListMethodsParams {
    shellyID: string;
}
export const SHELLY_LIST_METHODS_PARAMS_SCHEMA = P_SHELLY_ONLY;

export interface ShellyDetectLocationParams {
    shellyID: string;
}
export const SHELLY_DETECT_LOCATION_PARAMS_SCHEMA = P_SHELLY_ONLY;

export interface ShellyListTimezonesParams {
    shellyID: string;
}
export const SHELLY_LIST_TIMEZONES_PARAMS_SCHEMA = P_SHELLY_ONLY;

export interface ShellyResetWiFiConfigParams {
    shellyID: string;
}
export const SHELLY_RESET_WIFI_CONFIG_PARAMS_SCHEMA = P_SHELLY_ONLY;

// Shelly.SetAuth - change device password. Use ha1=null to disable auth; the
// device still requires user and realm.
export interface ShellySetAuthParams {
    shellyID: string;
    user: string | null;
    realm: string | null;
    ha1: string | null;
}
export const SHELLY_SET_AUTH_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'user', 'realm', 'ha1'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        user: {type: ['string', 'null']},
        realm: {type: ['string', 'null']},
        ha1: {type: ['string', 'null']}
    }
};

// ── Describe ────────────────────────────────────────────────────────

const b = new DescribeBuilder('shelly', {
    kind: 'device',
    description:
        'Device admin, identity, and lifecycle methods on the target Shelly device.'
});

// Lifecycle
b.registerMethod('Reboot', {
    params: SHELLY_REBOOT_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'Shelly.Reboot — no documented response (device reboots).'
});
b.registerMethod('FactoryReset', {
    params: SHELLY_FACTORY_RESET_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_EXECUTE,
    description: 'Shelly.FactoryReset.'
});
b.registerMethod('CheckForUpdate', {
    params: SHELLY_CHECK_FOR_UPDATE_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description:
        'Shelly.CheckForUpdate — empty object when no update available.'
});
b.registerMethod('Update', {
    params: SHELLY_UPDATE_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_EXECUTE,
    description:
        'Shelly.Update — exactly one of stage or url. Stage names device-owned.'
});
b.registerMethod('SetProfile', {
    params: SHELLY_SET_PROFILE_PARAMS_SCHEMA,
    response: {
        type: 'object',
        required: ['profile_was'],
        properties: {profile_was: {type: 'string'}}
    },
    permission: PERM_UPDATE,
    description:
        'Shelly.SetProfile — names from Shelly.ListProfiles. Device reboots after.'
});
b.registerMethod('ListProfiles', {
    params: SHELLY_LIST_PROFILES_PARAMS_SCHEMA,
    response: {
        type: 'object',
        required: ['profiles'],
        properties: {profiles: {type: 'object'}}
    },
    permission: PERM_READ,
    description: 'Shelly.ListProfiles.'
});

// Identity / diagnostics
b.registerMethod('GetDeviceInfo', {
    params: SHELLY_GET_DEVICE_INFO_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'Shelly.GetDeviceInfo — device identity + fw version. ident:true for extended.'
});
b.registerMethod('GetStatus', {
    params: SHELLY_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Shelly.GetStatus — full live device status snapshot.'
});
b.registerMethod('GetConfig', {
    params: SHELLY_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Shelly.GetConfig — full live device config snapshot.'
});
b.registerMethod('GetComponents', {
    params: SHELLY_GET_COMPONENTS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'Shelly.GetComponents — paginated component list with optional config/status.'
});
b.registerMethod('ListMethods', {
    params: SHELLY_LIST_METHODS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'Shelly.ListMethods — RPC methods available on the device (ACL/auth filtered).'
});
b.registerMethod('DetectLocation', {
    params: SHELLY_DETECT_LOCATION_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Shelly.DetectLocation — auto-detect tz/location from IP.'
});
b.registerMethod('ListTimezones', {
    params: SHELLY_LIST_TIMEZONES_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Shelly.ListTimezones — TZ database the device knows about.'
});
b.registerMethod('ResetWiFiConfig', {
    params: SHELLY_RESET_WIFI_CONFIG_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_EXECUTE,
    description:
        'Shelly.ResetWiFiConfig — wipe Wi-Fi config; device drops back to AP mode.'
});
b.registerMethod('SetAuth', {
    params: SHELLY_SET_AUTH_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_UPDATE,
    description:
        'Shelly.SetAuth — change device password. Pass ha1=null with user and realm to disable auth.'
});

export interface ShellyResetAuthCodeParams {
    shellyID: string;
}
export const SHELLY_RESET_AUTH_CODE_PARAMS_SCHEMA: JsonSchema = P_SHELLY_ONLY;

b.registerMethod('ResetAuthCode', {
    params: SHELLY_RESET_AUTH_CODE_PARAMS_SCHEMA,
    response: {
        type: 'object',
        properties: {code_generated: {type: 'boolean'}}
    },
    permission: PERM_UPDATE,
    description:
        'Shelly.ResetAuthCode — regenerate the device pairing code (Wall Display).'
});

export const SHELLY_DESCRIBE: DescribeOutput = b.build();
