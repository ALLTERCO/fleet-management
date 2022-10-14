import { history_t, event_t } from "@/interfaces";

let FLEET_SERVER_HTTP = process.env['VUE_APP_BACKEND_URI'] || '';
let FLEET_SERVER_PASSWORD = process.env['FLEET_SERVER_PASSWORD'] || 'SHELLY';

export async function fetchServer(uri: string, method = "GET", body = {}){
    return fetch(uri, {
        method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Basic ' + FLEET_SERVER_PASSWORD
        },
        body: method == 'GET' ? undefined : JSON.stringify(body)
    }).then(res => res.json())
}

export function getDiscovered() {
    return fetchServer(FLEET_SERVER_HTTP + "/discovered"); 
}

export function getDevices() {
    return fetchServer(FLEET_SERVER_HTTP + "/device/list");
}

export function getStatus(mac: string) {
    return fetch(FLEET_SERVER_HTTP + "/ows/status/" + mac).then(res => res.json())
}

export function addDiscovered(node_name: string, device: string) {
    return fetchServer(FLEET_SERVER_HTTP + "/discovered/add", 'PUT', { node_name, device })
}

export async function sendRPC(deviceMac: string, method: string, params?: any) {
    return fetchServer(`${FLEET_SERVER_HTTP}/device/${deviceMac}/rpc`, 'POST', { method, params })

}

export async function getHistory(device_mac?: string): Promise<history_t[]> {
    try {
        const res = await fetchServer(`${FLEET_SERVER_HTTP}/history${device_mac ? '/' + device_mac : ''}`);

        for (const entry of res) {
            if(entry.request.params){
                entry.request.rowData = Object.entries(entry.request.params)
            }
            delete entry.request.params;
            entry.response = JSON.stringify(entry.response);
        }
        return res;
    } catch (error) {
        console.error(error);
        return [];
    }
}

export async function getConsumption(device_mac: string, channel: number, type: string, start_date: number, end_date?: number) {
    try {
        return fetchServer(`${FLEET_SERVER_HTTP}/consumption`, 'POST', { device_mac, channel, start_date, end_date, type })
    } catch (error) {
        console.error(error);
        return [];
    }
}

export async function countEvents(): Promise<{events: event_t[], count: number}> {
    try {
        return fetchServer(`${FLEET_SERVER_HTTP}/events`)
    } catch (error) {
        console.error(error)
        return Promise.resolve({events: [], count: 0});
    }
}

export async function getEvents({ shellyID, method, page, perPage }: { shellyID?: string, method?: string, page?: number, perPage?: number }): Promise<{count:number, events: event_t[]}> {
    try {
        let res = await fetchServer(`${FLEET_SERVER_HTTP}/events`, 'POST', { shellyID, method, page, perPage })
        
        res.events = res.events.map((e:any) => {
            e.data = e.msg;
            delete e.msg;
            return e;
        });
        return res;
    } catch (error) {
        console.error(error)
        return {count: 0, events: []}
    }
}

export async function saveRpc(name: string, method: string, rowData: [string, string][]) {
    return fetchServer(`${FLEET_SERVER_HTTP}/rpc`, 'PUT', { name, method, params: Object.fromEntries(rowData) })
}

export async function getSavedTemplates() {
    try {
        const templates = await fetchServer(FLEET_SERVER_HTTP + '/rpc');
        let build = {} as { [key: string]: any };
        for (const key in templates) {
            build[key] = templates[key].map((res: any) => {
                res.rowData = Object.entries(res.params || {});
                delete res.params;
                return res;
            })
        }
        return build;
    } catch (error) {
        return [];
    }
}

export async function applyConfig(device_mac: string, config: any) {
    return sendRPC(device_mac, 'Custom.ApplyConfig', config);
}

export async function provision(mac: string, wsServer: string, wifi?: {ssid: string, pass: string}){
    return fetchServer(FLEET_SERVER_HTTP + `/device/${mac}/provision`, 'POST', { wifi, wsServer })
}

export async function healthCheck(){
    return fetchServer(FLEET_SERVER_HTTP + '/health');
}