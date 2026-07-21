import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';

const SHELLY_ID = SHELLY_ID_SCHEMA;
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};

// Shelly NimBLE GATT client supports 5 concurrent connections per device.
export const MAX_GATTC_CONNECTIONS = 5;

// addr format: "aa:bb:cc:dd:ee:ff" or "aa:bb:cc:dd:ee:ff,N" (with address-type).
const ADDR_PATTERN = '^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}(,[0-9])?$';
const ADDR_SCHEMA: JsonSchema = {type: 'string', pattern: ADDR_PATTERN};

// --- Scan -----------------------------------------------------------------

export interface BluAssistScanParams {
    shellyID: string;
    active?: boolean;
    duration_ms?: number;
    window_ms?: number;
    interval_ms?: number;
    rssi_thr?: number;
    shellyOnly?: boolean;
}

export interface BluAssistScanParsed {
    isShellyBlu: boolean;
    encrypted: boolean;
    localName?: string;
    modelId?: number;
    modelString?: string;
    productName?: string;
}

export interface BluAssistScanKnown {
    externalId: string;
    name: string;
    gatewayShellyId: string;
}

export interface BluAssistScanResult {
    addr: string;
    rssi: number;
    advData?: string;
    parsed?: BluAssistScanParsed;
    knownInFleet?: BluAssistScanKnown;
}

export interface BluAssistScanResponse {
    results: BluAssistScanResult[];
    scanned: number;
}

const P_SCAN: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        active: {type: 'boolean'},
        duration_ms: {type: 'integer', minimum: 1, maximum: 30000},
        window_ms: {type: 'number', minimum: 2.5, maximum: 10240},
        interval_ms: {type: 'number', minimum: 2.5, maximum: 10240},
        rssi_thr: {type: 'integer', minimum: -100, maximum: 0},
        shellyOnly: {type: 'boolean'}
    }
};

const RESP_PARSED: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['isShellyBlu', 'encrypted'],
    properties: {
        isShellyBlu: {type: 'boolean'},
        encrypted: {type: 'boolean'},
        localName: {type: 'string'},
        modelId: {type: 'integer', minimum: 0},
        modelString: {type: 'string'},
        productName: {type: 'string'}
    }
};

const RESP_KNOWN: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['externalId', 'name', 'gatewayShellyId'],
    properties: {
        externalId: {type: 'string'},
        name: {type: 'string'},
        gatewayShellyId: {type: 'string'}
    }
};

const RESP_RESULT: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['addr', 'rssi'],
    properties: {
        addr: {type: 'string'},
        rssi: {type: 'integer'},
        advData: {type: 'string'},
        parsed: RESP_PARSED,
        knownInFleet: RESP_KNOWN
    }
};

const RESP_SCAN: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['results', 'scanned'],
    properties: {
        results: {type: 'array', items: RESP_RESULT},
        scanned: {type: 'integer'}
    }
};

// --- Connect / Disconnect -------------------------------------------------

export interface BluAssistConnectParams {
    shellyID: string;
    addr: string;
    timeout_ms?: number;
}

export interface BluAssistConnectResponse {
    conn_id: number;
    addr: string;
    mtu?: number;
}

const P_CONNECT: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'addr'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        addr: ADDR_SCHEMA,
        timeout_ms: {type: 'integer', minimum: 1000, maximum: 60000}
    }
};

const RESP_CONNECT: JsonSchema = {
    type: 'object',
    additionalProperties: true,
    required: ['conn_id'],
    properties: {
        conn_id: {type: 'integer'},
        addr: {type: 'string'},
        mtu: {type: 'integer'}
    }
};

export interface BluAssistDisconnectParams {
    shellyID: string;
    conn_id?: number;
    addr?: string;
}

const P_DISCONNECT: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        conn_id: {type: 'integer'},
        addr: ADDR_SCHEMA
    }
};

const RESP_EMPTY: JsonSchema = {
    type: 'object',
    additionalProperties: true,
    properties: {}
};

// --- Discover -------------------------------------------------------------

export interface BluAssistDiscoverParams {
    shellyID: string;
    conn_id?: number;
    addr?: string;
}

const P_DISCOVER: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        conn_id: {type: 'integer'},
        addr: ADDR_SCHEMA
    }
};

// services/characteristics shape is firmware-defined and complex; pass through.
const RESP_DISCOVER: JsonSchema = {
    type: 'object',
    additionalProperties: true,
    properties: {
        services: {
            type: 'array',
            items: {type: 'object', additionalProperties: true}
        }
    }
};

// --- Read / Write ---------------------------------------------------------

export interface BluAssistReadParams {
    shellyID: string;
    conn_id: number;
    handle?: number;
    svc?: string;
    chr?: string;
}

const P_READ: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'conn_id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        conn_id: {type: 'integer'},
        handle: {type: 'integer'},
        svc: {type: 'string'},
        chr: {type: 'string'}
    }
};

const RESP_READ: JsonSchema = {
    type: 'object',
    additionalProperties: true,
    properties: {data: {type: 'string'}}
};

export interface BluAssistWriteParams {
    shellyID: string;
    conn_id: number;
    data: string;
    handle?: number;
    svc?: string;
    chr?: string;
    response?: boolean;
}

const P_WRITE: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'conn_id', 'data'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        conn_id: {type: 'integer'},
        data: {type: 'string', pattern: '^([0-9a-fA-F]{2})*$'},
        handle: {type: 'integer'},
        svc: {type: 'string'},
        chr: {type: 'string'},
        response: {type: 'boolean'}
    }
};

// --- SetNotify -----------------------------------------------------------

export interface BluAssistSetNotifyParams {
    shellyID: string;
    conn_id: number;
    mode: 'none' | 'notify' | 'indicate';
    handle?: number;
    svc?: string;
    chr?: string;
}

const P_SET_NOTIFY: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'conn_id', 'mode'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        conn_id: {type: 'integer'},
        mode: {type: 'string', enum: ['none', 'notify', 'indicate']},
        handle: {type: 'integer'},
        svc: {type: 'string'},
        chr: {type: 'string'}
    }
};

// --- Call (high-level wrapper) -------------------------------------------

export interface BluAssistCallParams {
    shellyID: string;
    addr: string;
    method: string;
    params?: Record<string, unknown>;
}

const P_CALL: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'addr', 'method'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        addr: ADDR_SCHEMA,
        method: {type: 'string', minLength: 1, maxLength: 64},
        params: {type: 'object', additionalProperties: true}
    }
};

// --- Bonding -------------------------------------------------------------

export interface BluAssistBondEnParams {
    shellyID: string;
    enable: boolean;
}

const P_BOND_EN: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'enable'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, enable: {type: 'boolean'}}
};

export interface BluAssistAddrParams {
    shellyID: string;
    addr: string;
}

const P_ADDR: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'addr'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, addr: ADDR_SCHEMA}
};

const RESP_HAVE_BOND: JsonSchema = {
    type: 'object',
    additionalProperties: true,
    properties: {have_bond: {type: 'boolean'}}
};

// --- Connection.List (FM-side tracker) -----------------------------------

export interface BluAssistConnectionListParams {
    shellyID: string;
}

const P_CONN_LIST: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

export interface BluAssistConnectionEntry {
    conn_id: number;
    addr: string;
    openedAt: string;
    discoveredAt?: string;
    mtu?: number;
}

export interface BluAssistConnectionListResponse {
    slots: BluAssistConnectionEntry[];
    capacity: number;
    inUse: number;
}

const RESP_CONN_LIST: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['slots', 'capacity', 'inUse'],
    properties: {
        slots: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['conn_id', 'addr', 'openedAt'],
                properties: {
                    conn_id: {type: 'integer'},
                    addr: {type: 'string'},
                    openedAt: {type: 'string'},
                    discoveredAt: {type: 'string'},
                    mtu: {type: 'integer'}
                }
            }
        },
        capacity: {type: 'integer'},
        inUse: {type: 'integer'}
    }
};

// --- Exports + Describe --------------------------------------------------

export const BLU_ASSIST_SCAN_PARAMS_SCHEMA = P_SCAN;
export const BLU_ASSIST_CONNECT_PARAMS_SCHEMA = P_CONNECT;
export const BLU_ASSIST_DISCONNECT_PARAMS_SCHEMA = P_DISCONNECT;
export const BLU_ASSIST_DISCOVER_PARAMS_SCHEMA = P_DISCOVER;
export const BLU_ASSIST_READ_PARAMS_SCHEMA = P_READ;
export const BLU_ASSIST_WRITE_PARAMS_SCHEMA = P_WRITE;
export const BLU_ASSIST_SET_NOTIFY_PARAMS_SCHEMA = P_SET_NOTIFY;
export const BLU_ASSIST_CALL_PARAMS_SCHEMA = P_CALL;
export const BLU_ASSIST_BOND_EN_PARAMS_SCHEMA = P_BOND_EN;
export const BLU_ASSIST_ADDR_PARAMS_SCHEMA = P_ADDR;
export const BLU_ASSIST_CONNECTION_LIST_PARAMS_SCHEMA = P_CONN_LIST;

const b = new DescribeBuilder('bluassist', {
    kind: 'device',
    description:
        'Drive the BLU Assistant GATT client — scan, connect, read, write, notify, and bond.'
});

b.registerMethod('Scan', {
    params: BLU_ASSIST_SCAN_PARAMS_SCHEMA,
    response: RESP_SCAN,
    permission: PERM_READ,
    description:
        'bluassist.Scan — proxies GATTC.Scan on a BLU Assistant and enriches results with BTHome parsing + fleet cross-reference.'
});
b.registerMethod('Connect', {
    params: BLU_ASSIST_CONNECT_PARAMS_SCHEMA,
    response: RESP_CONNECT,
    permission: PERM_UPDATE,
    description:
        'bluassist.Connect — open a GATT connection to the addr. Counts against the device 5-slot pool.'
});
b.registerMethod('Disconnect', {
    params: BLU_ASSIST_DISCONNECT_PARAMS_SCHEMA,
    response: RESP_EMPTY,
    permission: PERM_UPDATE,
    description:
        'bluassist.Disconnect — close a GATT connection by conn_id or addr.'
});
b.registerMethod('Discover', {
    params: BLU_ASSIST_DISCOVER_PARAMS_SCHEMA,
    response: RESP_DISCOVER,
    permission: PERM_READ,
    description:
        'bluassist.Discover — enumerate services and characteristics on a connected peripheral.'
});
b.registerMethod('Read', {
    params: BLU_ASSIST_READ_PARAMS_SCHEMA,
    response: RESP_READ,
    permission: PERM_READ,
    description:
        'bluassist.Read — read a characteristic by handle or svc+chr UUID.'
});
b.registerMethod('Write', {
    params: BLU_ASSIST_WRITE_PARAMS_SCHEMA,
    response: RESP_EMPTY,
    permission: PERM_UPDATE,
    description:
        'bluassist.Write — write a characteristic by handle or svc+chr UUID. data is hex.'
});
b.registerMethod('SetNotify', {
    params: BLU_ASSIST_SET_NOTIFY_PARAMS_SCHEMA,
    response: RESP_EMPTY,
    permission: PERM_UPDATE,
    description:
        'bluassist.SetNotify — subscribe (notify/indicate) or unsubscribe (none) to a characteristic.'
});
b.registerMethod('Call', {
    safety: {effectDependsOnInput: true},
    params: BLU_ASSIST_CALL_PARAMS_SCHEMA,
    response: {type: 'object', additionalProperties: true},
    permission: PERM_UPDATE,
    description:
        'bluassist.Call — high-level RPC over BLE (used by BLU TRV and similar protocols).'
});
b.registerMethod('Bond.Enable', {
    params: BLU_ASSIST_BOND_EN_PARAMS_SCHEMA,
    response: RESP_EMPTY,
    permission: PERM_UPDATE,
    description:
        'bluassist.Bond.Enable — globally allow/deny bonding on the device.'
});
b.registerMethod('Bond.Has', {
    params: BLU_ASSIST_ADDR_PARAMS_SCHEMA,
    response: RESP_HAVE_BOND,
    permission: PERM_READ,
    description:
        'bluassist.Bond.Has — check whether a bond record exists for the addr.'
});
b.registerMethod('Bond.Delete', {
    params: BLU_ASSIST_ADDR_PARAMS_SCHEMA,
    response: RESP_EMPTY,
    permission: PERM_UPDATE,
    description: 'bluassist.Bond.Delete — remove the bond record for the addr.'
});
b.registerMethod('Connection.List', {
    params: BLU_ASSIST_CONNECTION_LIST_PARAMS_SCHEMA,
    response: RESP_CONN_LIST,
    permission: PERM_READ,
    description:
        'bluassist.Connection.List — FM-tracked active GATT connections for the device. Capacity is the device pool (5).'
});

export const BLUASSIST_DESCRIBE: DescribeOutput = b.build();
