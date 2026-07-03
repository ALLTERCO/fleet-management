import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';

const SHELLY_ID = SHELLY_ID_SCHEMA;
const COMPONENT_ID: JsonSchema = {type: 'integer', minimum: 0};
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};

const SID_FIELD: JsonSchema = {
    type: 'integer',
    minimum: 1,
    maximum: 247,
    title: 'Slave id (sid)',
    description: 'Modbus slave address on the bus (1-247).'
};
const ADDR_FIELD: JsonSchema = {
    type: 'integer',
    minimum: 0,
    maximum: 65535,
    title: 'Start address (addr)',
    description: 'Register or coil offset (0-65535).'
};
const QTY_REG_FIELD: JsonSchema = {
    type: 'integer',
    minimum: 1,
    maximum: 123,
    title: 'Quantity (qty)',
    description: 'Number of 16-bit registers to read (1-123).',
    default: 1
};
const QTY_BIT_FIELD: JsonSchema = {
    type: 'integer',
    minimum: 1,
    maximum: 2000,
    title: 'Quantity (qty)',
    description: 'Number of bits to read (1-2000).',
    default: 1
};
const REG_VALUE_FIELD: JsonSchema = {
    type: 'integer',
    minimum: 0,
    maximum: 65535,
    title: 'Value',
    description: 'Single 16-bit unsigned integer.'
};
const REG_VALUES_FIELD: JsonSchema = {
    type: 'array',
    items: {type: 'integer', minimum: 0, maximum: 65535},
    minItems: 1,
    maxItems: 123,
    title: 'Values',
    description: '1-123 16-bit unsigned integers.'
};
const COIL_VALUES_FIELD: JsonSchema = {
    type: 'array',
    items: {type: 'boolean'},
    minItems: 1,
    maxItems: 2000,
    title: 'Coil values',
    description: '1-2000 booleans.'
};

const P_ID: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, id: COMPONENT_ID}
};
const P_ID_CONFIG: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'config'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        config: {type: 'object'}
    }
};

function readSchema(qtyField: JsonSchema): JsonSchema {
    return {
        type: 'object',
        required: ['shellyID', 'id', 'sid', 'addr', 'qty'],
        additionalProperties: false,
        properties: {
            shellyID: SHELLY_ID,
            id: COMPONENT_ID,
            sid: SID_FIELD,
            addr: ADDR_FIELD,
            qty: qtyField
        }
    };
}

const P_READ_REGS: JsonSchema = readSchema(QTY_REG_FIELD);
const P_READ_BITS: JsonSchema = readSchema(QTY_BIT_FIELD);
const P_WRITE_REGS: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'sid', 'addr', 'values'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        sid: SID_FIELD,
        addr: ADDR_FIELD,
        values: REG_VALUES_FIELD
    }
};
const P_WRITE_SINGLE: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'sid', 'addr', 'value'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        sid: SID_FIELD,
        addr: ADDR_FIELD,
        value: REG_VALUE_FIELD
    }
};
const P_WRITE_COILS: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'sid', 'addr', 'values'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        sid: SID_FIELD,
        addr: ADDR_FIELD,
        values: COIL_VALUES_FIELD
    }
};

const RESP_OPAQUE: JsonSchema = {
    type: 'object',
    description: 'Device-defined response.'
};
const RESP_RESTART_REQUIRED: JsonSchema = {
    type: 'object',
    required: ['restart_required'],
    properties: {restart_required: {type: 'boolean'}}
};

export interface MbRtuClientSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}
export const MBRTUCLIENT_SET_CONFIG_PARAMS_SCHEMA = P_ID_CONFIG;

export interface MbRtuClientGetConfigParams {
    shellyID: string;
    id: number;
}
export const MBRTUCLIENT_GET_CONFIG_PARAMS_SCHEMA = P_ID;

export interface MbRtuClientGetStatusParams {
    shellyID: string;
    id: number;
}
export const MBRTUCLIENT_GET_STATUS_PARAMS_SCHEMA = P_ID;

export interface MbRtuClientReadRegsParams {
    shellyID: string;
    id: number;
    sid: number;
    addr: number;
    qty: number;
}
export interface MbRtuClientReadBitsParams {
    shellyID: string;
    id: number;
    sid: number;
    addr: number;
    qty: number;
}
export const MBRTUCLIENT_READ_REGS_PARAMS_SCHEMA = P_READ_REGS;
export const MBRTUCLIENT_READ_BITS_PARAMS_SCHEMA = P_READ_BITS;

export interface MbRtuClientWriteRegistersParams {
    shellyID: string;
    id: number;
    sid: number;
    addr: number;
    values: number[];
}
export const MBRTUCLIENT_WRITE_REGS_PARAMS_SCHEMA = P_WRITE_REGS;

export interface MbRtuClientWriteSingleRegisterParams {
    shellyID: string;
    id: number;
    sid: number;
    addr: number;
    value: number;
}
export const MBRTUCLIENT_WRITE_SINGLE_PARAMS_SCHEMA = P_WRITE_SINGLE;

export interface MbRtuClientWriteCoilsParams {
    shellyID: string;
    id: number;
    sid: number;
    addr: number;
    values: boolean[];
}
export const MBRTUCLIENT_WRITE_COILS_PARAMS_SCHEMA = P_WRITE_COILS;

const b = new DescribeBuilder('mbrtuclient', {
    kind: 'device',
    description:
        'Relay Modbus RTU client config plus register/coil read-write calls to a Shelly device.'
});

b.registerMethod('SetConfig', {
    params: MBRTUCLIENT_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_RESTART_REQUIRED,
    permission: PERM_UPDATE,
    description:
        'MbRtuClient.SetConfig — Modbus RTU client config (currently no fields per spec).'
});
b.registerMethod('GetConfig', {
    params: MBRTUCLIENT_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'MbRtuClient.GetConfig.'
});
b.registerMethod('GetStatus', {
    params: MBRTUCLIENT_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'MbRtuClient.GetStatus.'
});
b.registerMethod('ReadHoldingRegisters', {
    params: MBRTUCLIENT_READ_REGS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'Read holding registers (FC 0x03). 16-bit values from slave memory.'
});
b.registerMethod('ReadInputRegisters', {
    params: MBRTUCLIENT_READ_REGS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'Read input registers (FC 0x04). 16-bit read-only values from slave.'
});
b.registerMethod('ReadDiscreteInputs', {
    params: MBRTUCLIENT_READ_BITS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Read discrete inputs (FC 0x02). Single-bit read-only flags.'
});
b.registerMethod('ReadCoils', {
    params: MBRTUCLIENT_READ_BITS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Read coils (FC 0x01). Single-bit read/write flags.'
});
b.registerMethod('WriteHoldingRegisters', {
    params: MBRTUCLIENT_WRITE_REGS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Write multiple holding registers (FC 0x10).'
});
b.registerMethod('WriteSingleRegister', {
    params: MBRTUCLIENT_WRITE_SINGLE_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Write a single holding register (FC 0x06).'
});
b.registerMethod('WriteCoils', {
    params: MBRTUCLIENT_WRITE_COILS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Write multiple coils (FC 0x0F).'
});

export const MBRTUCLIENT_DESCRIBE: DescribeOutput = b.build();
