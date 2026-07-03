import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';

const SHELLY_ID = SHELLY_ID_SCHEMA;

const COMPONENT_ID: JsonSchema = {
    type: 'integer',
    minimum: 0,
    description: 'Component index on the device (0-based)'
};

const P_SHELLY_ONLY: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

const P_SHELLY_ID: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, id: COMPONENT_ID}
};

const RESP_SUCCESS: JsonSchema = {
    type: 'object',
    required: ['success'],
    properties: {success: {type: 'boolean', const: true}}
};

const RESP_OPAQUE: JsonSchema = {
    type: 'object',
    description: 'Device-defined response'
};

const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};
const PERM_EXECUTE = {component: 'devices', operation: 'execute' as const};
const PERM_DELETE = {component: 'devices', operation: 'delete' as const};

// ── Named param schemas + interfaces for FM-orchestrated BTHome methods ──

export type BthomeListGatewaysParams = Record<string, never>;
export const BTHOME_LIST_GATEWAYS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};

export interface BthomeStartDiscoveryParams {
    shellyID: string;
    duration?: number;
}
export const BTHOME_START_DISCOVERY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        duration: {type: 'integer', minimum: 1}
    }
};

export interface BthomeDeviceAddManualParams {
    shellyID: string;
    mac: string;
    name?: string;
    productName?: string;
    modelId?: string;
}
export const BTHOME_DEVICE_ADD_MANUAL_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'mac'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        mac: {type: 'string'},
        name: {type: 'string'},
        productName: {type: 'string'},
        modelId: {type: 'string'}
    }
};

export interface BthomeDeviceRemoveParams {
    shellyID: string;
    id: number;
}
export const BTHOME_DEVICE_REMOVE_PARAMS_SCHEMA: JsonSchema = P_SHELLY_ID;

export interface BthomeDeviceRenameParams {
    shellyID: string;
    id: number;
    name: string | null;
}
export const BTHOME_DEVICE_RENAME_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'name'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        name: {type: ['string', 'null']}
    }
};

export interface BthomeDeviceGetKnownObjectsParams {
    shellyID: string;
    id: number;
}
export const BTHOME_DEVICE_GET_KNOWN_OBJECTS_PARAMS_SCHEMA: JsonSchema =
    P_SHELLY_ID;

export interface BthomeDeviceSetKeyParams {
    shellyID: string;
    id: number;
    key: string | null;
}
export const BTHOME_DEVICE_SET_KEY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'key'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        key: {type: ['string', 'null']}
    }
};

export interface BthomeObjectListInfosParams {
    shellyID: string;
    objIds?: number[];
}
export const BTHOME_OBJECT_LIST_INFOS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        objIds: {type: 'array', items: {type: 'integer'}}
    }
};

export interface BthomeSensorPairParams {
    shellyID: string;
    mac: string;
    productName?: string;
    modelId?: string;
}
export const BTHOME_SENSOR_PAIR_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'mac'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        mac: {type: 'string'},
        productName: {type: 'string'},
        modelId: {type: 'string'}
    }
};

export interface BthomeSensorAddParams {
    shellyID: string;
    id: number;
    addr: string;
    obj_id: number;
    idx: number;
    name?: string;
    meta?: Record<string, unknown>;
}
export const BTHOME_SENSOR_ADD_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'addr', 'obj_id', 'idx'],
    additionalProperties: true,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        addr: {type: 'string'},
        obj_id: {type: 'integer'},
        idx: {type: 'integer'},
        name: {type: 'string'},
        meta: {type: 'object'}
    }
};

export interface BthomeSensorRenameParams {
    shellyID: string;
    id: number;
    name: string | null;
}
export const BTHOME_SENSOR_RENAME_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'name'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        name: {type: ['string', 'null']}
    }
};

export interface BthomeSensorDeleteParams {
    shellyID: string;
    id: number;
}
export const BTHOME_SENSOR_DELETE_PARAMS_SCHEMA: JsonSchema = P_SHELLY_ID;

export interface BthomeControlStartLearningParams {
    shellyID: string;
    inputId: number;
}
export const BTHOME_CONTROL_START_LEARNING_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'inputId'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        inputId: COMPONENT_ID
    }
};

export interface BthomeControlStopLearningParams {
    shellyID: string;
}
export const BTHOME_CONTROL_STOP_LEARNING_PARAMS_SCHEMA: JsonSchema =
    P_SHELLY_ONLY;

export interface BthomeControlListParams {
    shellyID: string;
}
export const BTHOME_CONTROL_LIST_PARAMS_SCHEMA: JsonSchema = P_SHELLY_ONLY;

export interface BthomeControlGetLearningStateParams {
    shellyID: string;
}
export const BTHOME_CONTROL_GET_LEARNING_STATE_PARAMS_SCHEMA: JsonSchema =
    P_SHELLY_ONLY;

export interface BthomeControlDeleteParams {
    shellyID: string;
    id?: number;
}
export const BTHOME_CONTROL_DELETE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID
    }
};

const b = new DescribeBuilder('bthome', {
    kind: 'device',
    description:
        'Pair, configure, and control BTHome gateways, sensors, and BLU controls.'
});

b.registerMethod('ListGateways', {
    params: BTHOME_LIST_GATEWAYS_PARAMS_SCHEMA,
    response: {
        type: 'object',
        required: ['items'],
        properties: {
            items: {
                type: 'array',
                items: {
                    type: 'object',
                    required: ['shellyID', 'name'],
                    properties: {
                        shellyID: SHELLY_ID,
                        name: {type: 'string'}
                    }
                }
            }
        }
    },
    permission: PERM_READ,
    description: 'List devices that can bridge BLE/BTHome peripherals.'
});

b.registerMethod('StartDiscovery', {
    params: BTHOME_START_DISCOVERY_PARAMS_SCHEMA,
    response: {
        type: 'object',
        required: ['success', 'duration'],
        properties: {
            success: {type: 'boolean', const: true},
            duration: {type: 'integer'}
        }
    },
    permission: PERM_EXECUTE,
    description: 'Start BTHome device discovery on a gateway.'
});

b.registerMethod('Device.AddManual', {
    params: BTHOME_DEVICE_ADD_MANUAL_PARAMS_SCHEMA,
    response: {
        type: 'object',
        required: ['success', 'alreadyPaired'],
        properties: {
            success: {type: 'boolean', const: true},
            alreadyPaired: {type: 'boolean'}
        }
    },
    permission: PERM_EXECUTE,
    description: 'Manually pair a BTHome device by MAC address.'
});

b.registerMethod('Device.Remove', {
    params: BTHOME_DEVICE_REMOVE_PARAMS_SCHEMA,
    response: RESP_SUCCESS,
    permission: PERM_DELETE,
    description: 'Remove a paired BTHome device and its sensors.'
});

b.registerMethod('Device.Rename', {
    params: BTHOME_DEVICE_RENAME_PARAMS_SCHEMA,
    response: RESP_SUCCESS,
    permission: PERM_UPDATE,
    description: 'Rename a paired BTHome device.'
});

b.registerMethod('Device.GetKnownObjects', {
    params: BTHOME_DEVICE_GET_KNOWN_OBJECTS_PARAMS_SCHEMA,
    response: {
        type: 'object',
        properties: {
            id: {type: 'integer'},
            objects: {type: 'array'},
            knownObjects: {type: 'array'}
        },
        description: 'Known object list enriched by backend BTHome registry.'
    },
    permission: PERM_READ,
    description: 'List known objects for a paired BTHome device.'
});

b.registerMethod('Device.SetKey', {
    params: BTHOME_DEVICE_SET_KEY_PARAMS_SCHEMA,
    response: RESP_SUCCESS,
    permission: PERM_UPDATE,
    description: 'Set or clear the AES-128 key for a paired BTHome device.'
});

b.registerMethod('Object.ListInfos', {
    params: BTHOME_OBJECT_LIST_INFOS_PARAMS_SCHEMA,
    response: {
        type: 'object',
        required: ['objects', 'offset', 'count', 'total'],
        properties: {
            objects: {type: 'array'},
            offset: {type: 'integer'},
            count: {type: 'integer'},
            total: {type: 'integer'}
        }
    },
    permission: PERM_READ,
    description: 'Read BTHome object metadata from the gateway.'
});

b.registerMethod('Sensor.Pair', {
    params: BTHOME_SENSOR_PAIR_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Backend-orchestrated BTHome pair workflow.'
});

b.registerMethod('Sensor.Add', {
    params: BTHOME_SENSOR_ADD_PARAMS_SCHEMA,
    response: RESP_SUCCESS,
    permission: PERM_EXECUTE,
    description: 'Create a BTHome sensor component from a known object.'
});

b.registerMethod('Sensor.Rename', {
    params: BTHOME_SENSOR_RENAME_PARAMS_SCHEMA,
    response: RESP_SUCCESS,
    permission: PERM_UPDATE,
    description: 'Rename a BTHome sensor.'
});

b.registerMethod('Sensor.Delete', {
    params: BTHOME_SENSOR_DELETE_PARAMS_SCHEMA,
    response: RESP_SUCCESS,
    permission: PERM_DELETE,
    description: 'Delete a BTHome sensor.'
});

b.registerMethod('Control.StartLearning', {
    params: BTHOME_CONTROL_START_LEARNING_PARAMS_SCHEMA,
    response: RESP_SUCCESS,
    permission: PERM_EXECUTE,
    description: 'Start backend-orchestrated BTHome control learning.'
});

b.registerMethod('Control.StopLearning', {
    params: BTHOME_CONTROL_STOP_LEARNING_PARAMS_SCHEMA,
    response: RESP_SUCCESS,
    permission: PERM_EXECUTE,
    description: 'Stop BTHome control learning.'
});

b.registerMethod('Control.List', {
    params: BTHOME_CONTROL_LIST_PARAMS_SCHEMA,
    response: {
        type: 'object',
        required: ['bindings'],
        properties: {bindings: {type: 'array'}}
    },
    permission: PERM_READ,
    description: 'List learned BTHome control bindings.'
});

b.registerMethod('Control.GetLearningState', {
    params: BTHOME_CONTROL_GET_LEARNING_STATE_PARAMS_SCHEMA,
    response: {
        type: 'object',
        properties: {state: {type: ['object', 'null']}}
    },
    permission: PERM_READ,
    description: 'Read backend BTHome control learning state.'
});

b.registerMethod('Control.Delete', {
    params: BTHOME_CONTROL_DELETE_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_DELETE,
    description: 'Delete one BTHome control binding, or all when id is omitted.'
});

// ── Top-level BTHome.* component-interface methods (per docs) ─────────────

export interface BthomeGetConfigParams {
    shellyID: string;
}
export const BTHOME_GET_CONFIG_PARAMS_SCHEMA = P_SHELLY_ONLY;

export interface BthomeGetStatusParams {
    shellyID: string;
}
export const BTHOME_GET_STATUS_PARAMS_SCHEMA = P_SHELLY_ONLY;

export interface BthomeSetConfigParams {
    shellyID: string;
    config: Record<string, unknown>;
}
export const BTHOME_SET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'config'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        config: {type: 'object'}
    }
};

export interface BthomeResetEncryptionCounterParams {
    shellyID: string;
}
export const BTHOME_RESET_ENCRYPTION_COUNTER_PARAMS_SCHEMA = P_SHELLY_ONLY;

b.registerMethod('GetConfig', {
    params: BTHOME_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'BTHome.GetConfig (top-level — empty per spec).'
});
b.registerMethod('GetStatus', {
    params: BTHOME_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'BTHome.GetStatus — {discovery?, errors[]}.'
});
b.registerMethod('SetConfig', {
    params: BTHOME_SET_CONFIG_PARAMS_SCHEMA,
    response: {type: 'null'},
    permission: PERM_UPDATE,
    description: 'BTHome.SetConfig (top-level — currently no fields per spec).'
});
b.registerMethod('ResetEncryptionCounter', {
    params: BTHOME_RESET_ENCRYPTION_COUNTER_PARAMS_SCHEMA,
    response: {type: 'null'},
    permission: PERM_UPDATE,
    description: 'BTHome.ResetEncryptionCounter — reset BLU encryption counter.'
});

// ── BTHomeDevice / BTHomeSensor / BTHomeControl per-component reads ──────
// FM ns prefix: Device.* / Sensor.* / Control.* matches existing umbrella
// naming. Per-method schemas all share {shellyID, id}.

export interface BthomeDeviceGetConfigParams {
    shellyID: string;
    id: number;
}
export const BTHOME_DEVICE_GET_CONFIG_PARAMS_SCHEMA = P_SHELLY_ID;

export interface BthomeDeviceGetStatusParams {
    shellyID: string;
    id: number;
}
export const BTHOME_DEVICE_GET_STATUS_PARAMS_SCHEMA = P_SHELLY_ID;

export interface BthomeDeviceSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}
export const BTHOME_DEVICE_SET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'config'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        config: {type: 'object'}
    }
};

export interface BthomeSensorGetConfigParams {
    shellyID: string;
    id: number;
}
export const BTHOME_SENSOR_GET_CONFIG_PARAMS_SCHEMA = P_SHELLY_ID;

export interface BthomeSensorGetStatusParams {
    shellyID: string;
    id: number;
}
export const BTHOME_SENSOR_GET_STATUS_PARAMS_SCHEMA = P_SHELLY_ID;

export interface BthomeSensorSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}
export const BTHOME_SENSOR_SET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'config'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        config: {type: 'object'}
    }
};

export interface BthomeControlGetConfigParams {
    shellyID: string;
    id: number;
}
export const BTHOME_CONTROL_GET_CONFIG_PARAMS_SCHEMA = P_SHELLY_ID;

export interface BthomeControlGetStatusParams {
    shellyID: string;
    id: number;
}
export const BTHOME_CONTROL_GET_STATUS_PARAMS_SCHEMA = P_SHELLY_ID;

export interface BthomeControlSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}
export const BTHOME_CONTROL_SET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'config'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        config: {type: 'object'}
    }
};

// BTHomeControl.Create — output (string), inputs (array of objects).
export interface BthomeControlCreateParams {
    shellyID: string;
    output: string;
    inputs: Array<Record<string, unknown>>;
}
export const BTHOME_CONTROL_CREATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'output', 'inputs'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        output: {type: 'string'},
        inputs: {type: 'array', items: {type: 'object'}}
    }
};

// BTHomeControl.Update — id + output + inputs.
export interface BthomeControlUpdateParams {
    shellyID: string;
    id: number;
    output: string;
    inputs: Array<Record<string, unknown>>;
}
export const BTHOME_CONTROL_UPDATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'output', 'inputs'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        output: {type: 'string'},
        inputs: {type: 'array', items: {type: 'object'}}
    }
};

export interface BthomeControlEnumerateParams {
    shellyID: string;
}
export const BTHOME_CONTROL_ENUMERATE_PARAMS_SCHEMA = P_SHELLY_ONLY;

b.registerMethod('Device.GetConfig', {
    params: BTHOME_DEVICE_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'BTHomeDevice.GetConfig — per-device config + meta.'
});
b.registerMethod('Device.GetStatus', {
    params: BTHOME_DEVICE_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'BTHomeDevice.GetStatus — runtime: rssi/battery/last_updated_ts/paired/fw_ver/errors.'
});
b.registerMethod('Device.SetConfig', {
    params: BTHOME_DEVICE_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description:
        'BTHomeDevice.SetConfig — partial config patch (name, key, meta).'
});
b.registerMethod('Sensor.GetConfig', {
    params: BTHOME_SENSOR_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'BTHomeSensor.GetConfig — {id, addr, name, meta, obj_id, idx}.'
});
b.registerMethod('Sensor.GetStatus', {
    params: BTHOME_SENSOR_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'BTHomeSensor.GetStatus — latest reading {id, value, last_updated_ts}.'
});
b.registerMethod('Sensor.SetConfig', {
    params: BTHOME_SENSOR_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'BTHomeSensor.SetConfig — partial config patch.'
});
b.registerMethod('Control.GetConfig', {
    params: BTHOME_CONTROL_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'BTHomeControl.GetConfig — {id, blu_remote_cover_mode}.'
});
b.registerMethod('Control.GetStatus', {
    params: BTHOME_CONTROL_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'BTHomeControl.GetStatus — full state (different from GetLearningState).'
});
b.registerMethod('Control.SetConfig', {
    params: BTHOME_CONTROL_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description:
        'BTHomeControl.SetConfig — {blu_remote_cover_mode}. restart_required.'
});
b.registerMethod('Control.Create', {
    params: BTHOME_CONTROL_CREATE_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description:
        'BTHomeControl.Create — bind a BLU remote to an output component.'
});
b.registerMethod('Control.Update', {
    params: BTHOME_CONTROL_UPDATE_PARAMS_SCHEMA,
    response: {type: 'null'},
    permission: PERM_UPDATE,
    description:
        'BTHomeControl.Update — replace output/inputs of an existing binding.'
});
b.registerMethod('Control.Enumerate', {
    params: BTHOME_CONTROL_ENUMERATE_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'BTHomeControl.Enumerate — outputs that can be bound to BLU remotes.'
});

export const BTHOME_DESCRIBE: DescribeOutput = b.build();
