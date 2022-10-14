export type build_t = "discovered" | "devices" | "report";

export interface discovered_t {
    node_name: string,
    name: string,
    app: string,
    ver: string,
    gen: string
}

export interface event_t {
    timestamp: number,
    shellyID: string,
    method: string,
    data: object
}

export interface shelly_device {
    mac: string,
    selected: boolean,
    status?: any,
    setting?: any
}

export interface rpc_req_t {
    method: string,
    rowData: [string, string][]
}

export interface history_t {
    timestamp: number,
    device_mac: string,
    request: rpc_req_t,
    response: string
}

export type toast_color = "success" | "warning" | "danger" | "dark";

export interface rpc_interface_group {
    name: string,
    method: string,
    rowData: [string, string][]
}

export interface rpc_template {
    [key: string]: rpc_interface_group[]
}

export interface response_t {
    mac: string,
    response: string
}

export interface tag_t {
    [key: string]: {
        label: string,
        addon?: { label: string, color: string }
        click_cb?: () => void
    }
}