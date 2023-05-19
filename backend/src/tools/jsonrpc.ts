export interface incoming_jsonrpc {
    jsonrpc?: "2.0",
    id: number,
    src: string,
    dst?: string | string[],
    method: string,
    params?: undefined | any | any[]
}

interface outgoing_jsonrpc_success {
    jsonrpc?: "2.0",
    id: number,
    src: string,
    dst: string,
    result: any
}

export const ERROR_CODES = {
    PARSE_ERROR: -32700,
    INVALID_REQUEST: -32600,
    METHOD_NOT_FOUND: -32601,
    INVALID_PARAMS: -32602,
    SERVER_ERROR: -32001,
}

interface outgoing_jsonrpc_error {
    jsonrpc?: "2.0",
    id: number | null,
    src: string,
    dst?: string | undefined,
    error: {
        code: number,
        message: string,
    }
}

export type outgoing_jsonrpc = outgoing_jsonrpc_success | outgoing_jsonrpc_error

export function parseIncomingJsonRpc(data: any): data is incoming_jsonrpc {
    return typeof data === 'object'
        && ((typeof data.jsonrpc === 'string' && data.jsonrpc === '2.0') || typeof data.jsonrpc === 'undefined')
        && typeof data.id === 'number'
        && typeof data.src === 'string'
        && typeof data.method === 'string'
        && (typeof data.dst === 'undefined' || typeof data.dst === 'string' || (typeof data.dst === 'object' && Array.isArray(data.dst)))
        && (typeof data.params === 'undefined' || typeof data.params === 'object')
}

export function buildOutgoingJsonRpc(id: number, dst: string, result: any): outgoing_jsonrpc {
    return {
        jsonrpc: '2.0',
        id,
        src: 'FLEET_MANAGER',
        dst,
        result
    }
}

export function buildOutgoingJsonRpcError(error_code: number, id: number | null, dst?: string, message: string | null = "") {
    let error: outgoing_jsonrpc_error = {
        jsonrpc: '2.0',
        id,
        src: 'FLEET_MANAGER',
        dst,
        error: {
            code: error_code,
            message: message ?? ""
        }
    }

    if (error.error.message == null || error.error.message.length == 0) {
        switch (error_code) {
            case ERROR_CODES.PARSE_ERROR:
                error.error.message = "Parse error";
                break;
            case ERROR_CODES.INVALID_REQUEST:
                error.error.message = "Invalid request";
                break;
            case ERROR_CODES.METHOD_NOT_FOUND:
                error.error.message = "Method not found";
                break;
            case ERROR_CODES.INVALID_PARAMS:
                error.error.message = "Invalid params";
                break;
            default:
                error.error.message = "Server error";
                break;
        }
    }

    return error;
}