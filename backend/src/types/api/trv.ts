import {
    DescribeBuilder,
    type DescribeOutput,
    type MetricDescriptor
} from './_describe';
import {sensor} from './_metricBuilders';
import type {JsonSchema} from './_schema';
import {
    DEVICE_CONFIG_PATCH_SCHEMA,
    RESTART_REQUIRED_RESPONSE_SCHEMA,
    SHELLY_ID_SCHEMA
} from './_shared';

const SHELLY_ID = SHELLY_ID_SCHEMA;
const COMPONENT_ID: JsonSchema = {
    type: 'integer',
    minimum: 0,
    description: 'BluTrv component index on the gateway'
};
const P_SHELLY_ID: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, id: COMPONENT_ID}
};

export interface TrvShellyIdParams {
    shellyID: string;
    id: number;
}
export const TRV_GET_CONFIG_PARAMS_SCHEMA: JsonSchema = P_SHELLY_ID;
export const TRV_GET_STATUS_PARAMS_SCHEMA: JsonSchema = P_SHELLY_ID;
export const TRV_GET_REMOTE_DEVICE_INFO_PARAMS_SCHEMA: JsonSchema = P_SHELLY_ID;

export interface TrvUpdateFirmwareParams {
    shellyID: string;
    id: number;
    bootloader?: boolean;
    url?: string;
}
export const TRV_UPDATE_FIRMWARE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        bootloader: {type: 'boolean'},
        url: {type: 'string', minLength: 1}
    }
};
const RESP_NULL: JsonSchema = {
    type: 'null',
    description: 'Returns null on success'
};
const RESP_OPAQUE: JsonSchema = {
    type: 'object',
    description: 'Device-defined response'
};
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};
const PERM_EXECUTE = {component: 'devices', operation: 'execute' as const};
const PERM_DELETE = {component: 'devices', operation: 'delete' as const};

const b = new DescribeBuilder('trv', {
    kind: 'device',
    description:
        'Control BLU TRV valves and schedules via the BluTrv gateway component.'
});

b.registerMethod('GetConfig', {
    params: TRV_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'BluTrv.GetConfig.'
});
b.registerMethod('GetStatus', {
    params: TRV_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'BluTrv.GetStatus.'
});
b.registerMethod('GetRemoteConfig', {
    params: P_SHELLY_ID,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'BluTrv.GetRemoteConfig.'
});
b.registerMethod('GetRemoteStatus', {
    params: P_SHELLY_ID,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'BluTrv.GetRemoteStatus.'
});
b.registerMethod('GetRemoteDeviceInfo', {
    params: TRV_GET_REMOTE_DEVICE_INFO_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'BluTrv.GetRemoteDeviceInfo.'
});
export interface TrvSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}
export const TRV_SET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'config'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        config: DEVICE_CONFIG_PATCH_SCHEMA
    }
};

export interface TrvCallParams {
    shellyID: string;
    id: number;
    method: string;
    params?: Record<string, unknown>;
}
export const TRV_CALL_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'method'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        method: {type: 'string', minLength: 1},
        params: {type: 'object'}
    }
};

b.registerMethod('SetConfig', {
    params: TRV_SET_CONFIG_PARAMS_SCHEMA,
    response: RESTART_REQUIRED_RESPONSE_SCHEMA,
    permission: PERM_UPDATE,
    description: 'BluTrv.SetConfig.'
});
b.registerMethod('CheckForUpdates', {
    params: P_SHELLY_ID,
    response: {type: 'object', properties: {fw_id: {type: 'string'}}},
    permission: PERM_READ,
    description: 'BluTrv.CheckForUpdates.'
});
b.registerMethod('UpdateFirmware', {
    params: TRV_UPDATE_FIRMWARE_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_EXECUTE,
    description: 'BluTrv.UpdateFirmware.'
});
b.registerMethod('Delete', {
    params: P_SHELLY_ID,
    response: RESP_NULL,
    permission: PERM_DELETE,
    description: 'BluTrv.Delete.'
});
b.registerMethod('Call', {
    params: TRV_CALL_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'BluTrv.Call — tunneled RPC to TRV.'
});

export interface TrvScheduleAddParams {
    shellyID: string;
    id: number;
    thermostatId?: number;
    hour: number;
    minute: number;
    days?: number[];
    target_C: number;
    enable?: boolean;
}
export const TRV_SCHEDULE_ADD_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'hour', 'minute', 'target_C'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        thermostatId: {type: 'integer'},
        hour: {type: 'integer', minimum: 0, maximum: 23},
        minute: {type: 'integer', minimum: 0, maximum: 59},
        days: {
            type: 'array',
            items: {type: 'integer', minimum: 0, maximum: 6},
            minItems: 1,
            maxItems: 7
        },
        target_C: {type: 'number'},
        enable: {type: 'boolean'}
    }
};

export interface TrvScheduleListParams {
    shellyID: string;
    id: number;
    thermostatId?: number;
}
export const TRV_SCHEDULE_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        thermostatId: {type: 'integer'}
    }
};

export interface TrvScheduleUpdateParams {
    shellyID: string;
    id: number;
    ruleId: number;
    thermostatId?: number;
    hour?: number;
    minute?: number;
    days?: number[];
    target_C?: number;
    enable?: boolean;
}
export const TRV_SCHEDULE_UPDATE_PARAMS_SCHEMA: JsonSchema = {
    ...TRV_SCHEDULE_ADD_PARAMS_SCHEMA,
    required: ['shellyID', 'id', 'ruleId'],
    properties: {
        ...(TRV_SCHEDULE_ADD_PARAMS_SCHEMA.properties as Record<
            string,
            JsonSchema
        >),
        ruleId: {type: 'integer'}
    },
    anyOf: [
        {type: 'object', required: ['enable']},
        {type: 'object', required: ['target_C']},
        {type: 'object', required: ['hour', 'minute']}
    ]
};

export interface TrvScheduleRemoveParams {
    shellyID: string;
    id: number;
    ruleId: number;
    thermostatId?: number;
}
export const TRV_SCHEDULE_REMOVE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'ruleId'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        thermostatId: {type: 'integer'},
        ruleId: {type: 'integer'}
    }
};

// Tunneled Trv.* — BLU TRV reached via BluTrv.Call; thermostatId = TRV-side id (default 0).
const TRV_FLAGS = [
    'floor_heating',
    'accel',
    'auto_calibrate',
    'anticlog',
    'power_save',
    'silent_mode'
] as const;

export interface TrvShellyIdWithThermostatParams {
    shellyID: string;
    id: number;
    thermostatId?: number;
}
export const TRV_SHELLY_ID_WITH_THERMOSTAT_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        thermostatId: {type: 'integer', minimum: 0}
    }
};

export interface TrvSetTargetParams {
    shellyID: string;
    id: number;
    thermostatId?: number;
    target_C: number;
}
export const TRV_SET_TARGET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'target_C'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        thermostatId: {type: 'integer', minimum: 0},
        target_C: {type: 'number'}
    }
};

export interface TrvSetBoostParams {
    shellyID: string;
    id: number;
    thermostatId?: number;
    duration?: number;
}
export const TRV_SET_BOOST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        thermostatId: {type: 'integer', minimum: 0},
        duration: {type: 'integer', minimum: 1}
    }
};

export interface TrvSetOverrideParams {
    shellyID: string;
    id: number;
    thermostatId?: number;
    target_C: number;
    duration: number;
}
export const TRV_SET_OVERRIDE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'target_C', 'duration'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        thermostatId: {type: 'integer', minimum: 0},
        target_C: {type: 'number'},
        duration: {type: 'integer', minimum: 1}
    }
};

export interface TrvSetExternalTemperatureParams {
    shellyID: string;
    id: number;
    thermostatId?: number;
    t_C?: number;
}
export const TRV_SET_EXTERNAL_TEMPERATURE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        thermostatId: {type: 'integer', minimum: 0},
        t_C: {type: 'number'}
    }
};

export interface TrvSetPositionParams {
    shellyID: string;
    id: number;
    thermostatId?: number;
    pos: number;
}
export const TRV_SET_POSITION_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'pos'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        thermostatId: {type: 'integer', minimum: 0},
        pos: {type: 'number', minimum: 0, maximum: 100}
    }
};

export interface TrvFlagParams {
    shellyID: string;
    id: number;
    thermostatId?: number;
    flag: (typeof TRV_FLAGS)[number];
}
export const TRV_FLAG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'flag'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        thermostatId: {type: 'integer', minimum: 0},
        flag: {type: 'string', enum: [...TRV_FLAGS]}
    }
};

export interface TrvShowMessageParams {
    shellyID: string;
    id: number;
    thermostatId?: number;
    message: string;
}
export const TRV_SHOW_MESSAGE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'message'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        thermostatId: {type: 'integer', minimum: 0},
        message: {type: 'string', minLength: 1, maxLength: 10}
    }
};

export interface TrvPairingCompleteParams {
    shellyID: string;
    id: number;
    thermostatId?: number;
    success: boolean;
}
export const TRV_PAIRING_COMPLETE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'success'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        thermostatId: {type: 'integer', minimum: 0},
        success: {type: 'boolean'}
    }
};

b.registerMethod('GetRemoteTrvConfig', {
    params: TRV_SHELLY_ID_WITH_THERMOSTAT_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Trv.GetConfig via BluTrv.Call.'
});
b.registerMethod('GetRemoteTrvStatus', {
    params: TRV_SHELLY_ID_WITH_THERMOSTAT_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Trv.GetStatus via BluTrv.Call.'
});
b.registerMethod('SetTarget', {
    params: TRV_SET_TARGET_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_EXECUTE,
    description: 'Trv.SetTarget via BluTrv.Call — set target temperature.'
});
b.registerMethod('Calibrate', {
    params: TRV_SHELLY_ID_WITH_THERMOSTAT_SCHEMA,
    response: RESP_NULL,
    permission: PERM_EXECUTE,
    description: 'Trv.Calibrate via BluTrv.Call.'
});
b.registerMethod('SetBoost', {
    params: TRV_SET_BOOST_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_EXECUTE,
    description: 'Trv.SetBoost via BluTrv.Call — start boost mode.'
});
b.registerMethod('ClearBoost', {
    params: TRV_SHELLY_ID_WITH_THERMOSTAT_SCHEMA,
    response: RESP_NULL,
    permission: PERM_EXECUTE,
    description: 'Trv.ClearBoost via BluTrv.Call.'
});
b.registerMethod('SetOverride', {
    params: TRV_SET_OVERRIDE_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_EXECUTE,
    description:
        'Trv.SetOverride via BluTrv.Call — temporary target with duration.'
});
b.registerMethod('ClearOverride', {
    params: TRV_SHELLY_ID_WITH_THERMOSTAT_SCHEMA,
    response: RESP_NULL,
    permission: PERM_EXECUTE,
    description: 'Trv.ClearOverride via BluTrv.Call.'
});
b.registerMethod('SetExternalTemperature', {
    params: TRV_SET_EXTERNAL_TEMPERATURE_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_EXECUTE,
    description:
        'Trv.SetExternalTemperature via BluTrv.Call — omit t_C to revert to internal sensor.'
});
b.registerMethod('SetPosition', {
    params: TRV_SET_POSITION_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_EXECUTE,
    description:
        'Trv.SetPosition via BluTrv.Call — direct valve position 0-100%.'
});
b.registerMethod('SetFlag', {
    params: TRV_FLAG_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_EXECUTE,
    description: 'Trv.SetFlag via BluTrv.Call.'
});
b.registerMethod('ClearFlag', {
    params: TRV_FLAG_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_EXECUTE,
    description: 'Trv.ClearFlag via BluTrv.Call.'
});
b.registerMethod('ShowMessage', {
    params: TRV_SHOW_MESSAGE_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_EXECUTE,
    description: 'Trv.ShowMessage via BluTrv.Call — display ≤10 char message.'
});
b.registerMethod('PairingComplete', {
    params: TRV_PAIRING_COMPLETE_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_EXECUTE,
    description: 'Trv.PairingComplete via BluTrv.Call.'
});

b.registerMethod('Schedule.List', {
    params: TRV_SCHEDULE_LIST_PARAMS_SCHEMA,
    response: {
        type: 'object',
        required: ['rules'],
        properties: {rules: {type: 'array'}}
    },
    permission: PERM_READ,
    description: 'Trv.ListScheduleRules via BluTrv.Call.'
});
b.registerMethod('Schedule.Add', {
    params: TRV_SCHEDULE_ADD_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'Trv.AddScheduleRule via BluTrv.Call.'
});
b.registerMethod('Schedule.Update', {
    params: TRV_SCHEDULE_UPDATE_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Trv.UpdateScheduleRule via BluTrv.Call.'
});
b.registerMethod('Schedule.Remove', {
    params: TRV_SCHEDULE_REMOVE_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_DELETE,
    description: 'Trv.RemoveScheduleRule via BluTrv.Call.'
});

const TRV_METRICS: MetricDescriptor[] = [
    sensor('pos', '%'),
    sensor('current_C', '°C'),
    sensor('target_C', '°C')
];

b.setMetrics(TRV_METRICS);

export const TRV_DESCRIBE: DescribeOutput = b.build();
