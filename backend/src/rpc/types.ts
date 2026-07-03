export type JsonRpcId = number | string | null;

export interface JsonRpcIncoming {
    jsonrpc?: '2.0';
    id: JsonRpcId;
    src: string;
    dst?: string | string[];
    method: string;
    params?: undefined | any | any[];
}

export interface JsonRpcOutgoingSuccess {
    jsonrpc?: '2.0';
    id: JsonRpcId;
    src: string;
    dst: string;
    result: any;
}

export interface JsonRpcOutgoingError {
    jsonrpc?: '2.0';
    id: JsonRpcId;
    src: string;
    dst?: string | undefined;
    error: {
        code: number;
        message: string;
        data?: NonNullable<any>;
    };
}

export interface JsonRpcOutgoingEvent {
    src: string;
    dst: string;
    method: 'NotifyEvent';
    params: {
        ts: number;
        events: {
            component: string;
            event: string;
        }[];
    };
}

export interface JsonRpcOutgoingStatus {
    src: string;
    dst: string;
    method: 'NotifyStatus';
    params: {
        ts: number;
        [component: string]: any;
    };
}

export type JsonRpcOutgoing = JsonRpcOutgoingSuccess | JsonRpcOutgoingError;

function isJsonRpcId(value: unknown): value is JsonRpcId {
    return (
        typeof value === 'number' || typeof value === 'string' || value === null
    );
}

export function parseIncomingJsonRpc(data: any): data is JsonRpcIncoming {
    return (
        data !== null &&
        typeof data === 'object' &&
        ((typeof data.jsonrpc === 'string' && data.jsonrpc === '2.0') ||
            typeof data.jsonrpc === 'undefined') &&
        isJsonRpcId(data.id) &&
        typeof data.src === 'string' &&
        typeof data.method === 'string' &&
        (typeof data.dst === 'undefined' ||
            typeof data.dst === 'string' ||
            (typeof data.dst === 'object' && Array.isArray(data.dst))) &&
        (typeof data.params === 'undefined' || typeof data.params === 'object')
    );
}
