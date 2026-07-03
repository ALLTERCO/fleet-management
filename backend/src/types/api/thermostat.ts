import {
    DescribeBuilder,
    type DescribeOutput,
    type MetricDescriptor
} from './_describe';
import {sensor} from './_metricBuilders';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';

const SHELLY_ID = SHELLY_ID_SCHEMA;
const COMPONENT_ID: JsonSchema = {
    type: 'integer',
    minimum: 0,
    description: 'Thermostat component index'
};
const P_SHELLY_ID: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, id: COMPONENT_ID}
};
const RESP_OPAQUE: JsonSchema = {
    type: 'object',
    description: 'Device-defined response'
};
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};
const PERM_EXECUTE = {component: 'devices', operation: 'execute' as const};

export interface ThermostatShellyIdParams {
    shellyID: string;
    id: number;
}
export const THERMOSTAT_SHELLY_ID_PARAMS_SCHEMA: JsonSchema = P_SHELLY_ID;

export interface ThermostatStepTargetParams {
    shellyID: string;
    id: number;
    delta?: number;
}
export const THERMOSTAT_STEP_TARGET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        delta: {type: 'number', minimum: 0}
    }
};

const b = new DescribeBuilder('thermostat', {
    kind: 'device',
    description:
        'Control thermostat targets and schedule profiles on the device.'
});

b.registerMethod('GetConfig', {
    params: THERMOSTAT_SHELLY_ID_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Thermostat.GetConfig.'
});

b.registerMethod('GetStatus', {
    params: THERMOSTAT_SHELLY_ID_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Thermostat.GetStatus.'
});

b.registerMethod('IncreaseTargetTemperature', {
    params: THERMOSTAT_STEP_TARGET_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'Thermostat.IncreaseTargetTemperature — defaults to one step.'
});

b.registerMethod('DecreaseTargetTemperature', {
    params: THERMOSTAT_STEP_TARGET_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'Thermostat.DecreaseTargetTemperature — defaults to one step.'
});

b.registerMethod('Create', {
    params: {
        type: 'object',
        required: ['shellyID'],
        additionalProperties: false,
        properties: {shellyID: SHELLY_ID, config: {type: 'object'}}
    },
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Thermostat.Create.'
});
b.registerMethod('Delete', {
    params: P_SHELLY_ID,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Thermostat.Delete.'
});
b.registerMethod('SetConfig', {
    params: {
        type: 'object',
        required: ['shellyID', 'id', 'config'],
        additionalProperties: false,
        properties: {
            shellyID: SHELLY_ID,
            id: COMPONENT_ID,
            config: {type: 'object'}
        }
    },
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Thermostat.SetConfig.'
});
b.registerMethod('Schedule.SetConfig', {
    params: {
        type: 'object',
        required: ['shellyID', 'id', 'enable'],
        additionalProperties: false,
        properties: {
            shellyID: SHELLY_ID,
            id: COMPONENT_ID,
            enable: {type: 'boolean'}
        }
    },
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Thermostat.Schedule.SetConfig.'
});
b.registerMethod('Schedule.ListProfiles', {
    params: P_SHELLY_ID,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Thermostat.Schedule.ListProfiles.'
});
b.registerMethod('Schedule.AddProfile', {
    params: {
        type: 'object',
        required: ['shellyID', 'id', 'name'],
        additionalProperties: false,
        properties: {
            shellyID: SHELLY_ID,
            id: COMPONENT_ID,
            name: {type: 'string', minLength: 1}
        }
    },
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Thermostat.Schedule.AddProfile.'
});
b.registerMethod('Schedule.ListRules', {
    params: {
        type: 'object',
        required: ['shellyID', 'id', 'profile_id'],
        additionalProperties: false,
        properties: {
            shellyID: SHELLY_ID,
            id: COMPONENT_ID,
            profile_id: {type: 'integer'}
        }
    },
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Thermostat.Schedule.ListRules.'
});
b.registerMethod('Schedule.AddRule', {
    params: {
        type: 'object',
        required: ['shellyID', 'id', 'profile_id'],
        additionalProperties: true,
        properties: {
            shellyID: SHELLY_ID,
            id: COMPONENT_ID,
            profile_id: {type: 'integer'}
        }
    },
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Thermostat.Schedule.AddRule.'
});
b.registerMethod('Schedule.DeleteRule', {
    params: {
        type: 'object',
        required: ['shellyID', 'id', 'ruleId'],
        additionalProperties: false,
        properties: {
            shellyID: SHELLY_ID,
            id: COMPONENT_ID,
            ruleId: {type: 'integer'}
        }
    },
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Thermostat.Schedule.DeleteRule.'
});

// Schedule advanced — Wall Display V2 firmware.
export interface ThermostatScheduleProfileIdParams {
    shellyID: string;
    id: number;
    profile_id: number;
}
export const THERMOSTAT_SCHEDULE_PROFILE_ID_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'profile_id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        profile_id: {type: 'integer', minimum: 0}
    }
};

export interface ThermostatCreateParams {
    shellyID: string;
    config?: Record<string, unknown>;
}
export const THERMOSTAT_CREATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        config: {type: 'object'}
    }
};

export interface ThermostatSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}
export const THERMOSTAT_SET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'config'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        config: {type: 'object'}
    }
};

export interface ThermostatScheduleSetConfigParams {
    shellyID: string;
    id: number;
    enable: boolean;
}
export const THERMOSTAT_SCHEDULE_SET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'enable'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        enable: {type: 'boolean'}
    }
};

export interface ThermostatScheduleListRulesParams {
    shellyID: string;
    id: number;
    profile_id: number;
}
export const THERMOSTAT_SCHEDULE_LIST_RULES_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'profile_id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        profile_id: {type: 'integer', minimum: 0}
    }
};

export interface ThermostatScheduleDeleteRuleParams {
    shellyID: string;
    id: number;
    ruleId: number;
}
export const THERMOSTAT_SCHEDULE_DELETE_RULE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'ruleId'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        ruleId: {type: 'integer', minimum: 0}
    }
};

export interface ThermostatScheduleCreateProfileParams {
    shellyID: string;
    id: number;
    name: string;
}
export const THERMOSTAT_SCHEDULE_CREATE_PROFILE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'name'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        name: {type: 'string', minLength: 1}
    }
};

export interface ThermostatScheduleRenameProfileParams {
    shellyID: string;
    id: number;
    profile_id: number;
    name: string;
}
export const THERMOSTAT_SCHEDULE_RENAME_PROFILE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'profile_id', 'name'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        profile_id: {type: 'integer', minimum: 0},
        name: {type: 'string', minLength: 1}
    }
};

export interface ThermostatScheduleCreateRuleParams {
    shellyID: string;
    id: number;
    profile_id: number;
    hour: number;
    minute: number;
    target_C: number;
    enable?: boolean;
    days?: number[];
}
export const THERMOSTAT_SCHEDULE_CREATE_RULE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'profile_id', 'hour', 'minute', 'target_C'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        profile_id: {type: 'integer', minimum: 0},
        hour: {type: 'integer', minimum: 0, maximum: 23},
        minute: {type: 'integer', minimum: 0, maximum: 59},
        target_C: {type: 'number'},
        enable: {type: 'boolean'},
        days: {
            type: 'array',
            items: {type: 'integer', minimum: 0, maximum: 6},
            minItems: 1,
            maxItems: 7
        }
    }
};

export interface ThermostatScheduleUpdateRuleParams {
    shellyID: string;
    id: number;
    rule_id: number;
    hour?: number;
    minute?: number;
    target_C?: number;
    enable?: boolean;
    days?: number[];
}
export const THERMOSTAT_SCHEDULE_UPDATE_RULE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'rule_id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        rule_id: {type: 'integer', minimum: 0},
        hour: {type: 'integer', minimum: 0, maximum: 23},
        minute: {type: 'integer', minimum: 0, maximum: 59},
        target_C: {type: 'number'},
        enable: {type: 'boolean'},
        days: {
            type: 'array',
            items: {type: 'integer', minimum: 0, maximum: 6},
            minItems: 1,
            maxItems: 7
        }
    },
    anyOf: [
        {type: 'object', required: ['hour', 'minute']},
        {type: 'object', required: ['target_C']},
        {type: 'object', required: ['enable']},
        {type: 'object', required: ['days']}
    ]
};

export interface ThermostatScheduleRuleIdParams {
    shellyID: string;
    id: number;
    rule_id: number;
}
export const THERMOSTAT_SCHEDULE_RULE_ID_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'rule_id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        rule_id: {type: 'integer', minimum: 0}
    }
};

export interface ThermostatDebugSetSensorTemperatureParams {
    shellyID: string;
    id: number;
    t_C: number;
}
export const THERMOSTAT_DEBUG_SET_SENSOR_TEMPERATURE_PARAMS_SCHEMA: JsonSchema =
    {
        type: 'object',
        required: ['shellyID', 'id', 't_C'],
        additionalProperties: false,
        properties: {
            shellyID: SHELLY_ID,
            id: COMPONENT_ID,
            t_C: {type: 'number'}
        }
    };

b.registerMethod('Schedule.CreateProfile', {
    params: THERMOSTAT_SCHEDULE_CREATE_PROFILE_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Thermostat.Schedule.CreateProfile.'
});
b.registerMethod('Schedule.RenameProfile', {
    params: THERMOSTAT_SCHEDULE_RENAME_PROFILE_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Thermostat.Schedule.RenameProfile.'
});
b.registerMethod('Schedule.DeleteProfile', {
    params: THERMOSTAT_SCHEDULE_PROFILE_ID_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Thermostat.Schedule.DeleteProfile.'
});
b.registerMethod('Schedule.CreateRule', {
    params: THERMOSTAT_SCHEDULE_CREATE_RULE_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Thermostat.Schedule.CreateRule.'
});
b.registerMethod('Schedule.UpdateRule', {
    params: THERMOSTAT_SCHEDULE_UPDATE_RULE_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description:
        'Thermostat.Schedule.UpdateRule — patch any subset of timing/target/days/enable.'
});
b.registerMethod('Schedule.ChangeRule', {
    params: THERMOSTAT_SCHEDULE_UPDATE_RULE_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Thermostat.Schedule.ChangeRule.'
});
b.registerMethod('Schedule.DeleteAllRules', {
    params: THERMOSTAT_SCHEDULE_PROFILE_ID_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description:
        'Thermostat.Schedule.DeleteAllRules — clear every rule on a profile.'
});
b.registerMethod('Debug_SetSensorTemperature', {
    params: THERMOSTAT_DEBUG_SET_SENSOR_TEMPERATURE_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description:
        'Thermostat.Debug_SetSensorTemperature — debug override of measured temperature.'
});

// Thermostat status (Wall Display V2). Field names per FM types.ts.
const THERMOSTAT_METRICS: MetricDescriptor[] = [
    sensor('current_C', '°C', {optional: true}),
    sensor('target_C', '°C', {optional: true})
];

b.setMetrics(THERMOSTAT_METRICS);

export const THERMOSTAT_DESCRIBE: DescribeOutput = b.build();
