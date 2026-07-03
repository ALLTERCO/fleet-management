export interface ShellyMessageIncoming {
    id?: number;
    src: string;
    dst: string;
    method: string;
    result?: any;
    params?: any;
    error?: any;
}

export interface ShellyMessageData {
    jsonrpc: '2.0';
    id: number;
    src: string;
    method: string;
    params?: any;
}

export interface json_rpc_event {
    method: string;
    params: Record<string, any>;
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
