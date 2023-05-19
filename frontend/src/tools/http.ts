import { useToastStore } from "@/stores/toast";

let FLEET_SERVER_HTTP = `http://${window.location.host}`;

export async function fetchServer(uri: string, method = "GET", body = {}) {
    const resp = await fetch(FLEET_SERVER_HTTP + uri, {
        method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + localStorage.getItem('fleet-management-token')
        },
        body: method == 'GET' ? undefined : JSON.stringify(body)
    })
    if (resp.ok) {
        if (resp.status == 204) return Promise.resolve({});
        return resp.json();
    }

    switch (resp.status) {
        case 403:
            useToastStore().addToast("You do not have permission to complete this action.", 'danger');
            break;

        case 404:
            useToastStore().addToast("404 Resource not found.", 'danger');
            break;

        default:
            useToastStore().addToast("Something went wrong.", 'danger');
            break;
    }

    return resp.json();

}

async function sendRPC(shellyID: string, method: string, params?: any) {
    return fetchServer(`/device/${shellyID}/rpc`, 'POST', { method, params })

}

export async function applyConfig(device_mac: string, config: any) {
    return sendRPC(device_mac, 'Custom.ApplyConfig', config);
}

export async function healthCheck() {
    return fetchServer('/health');
}

export async function login(username: string, password: string) {
    return fetchServer('/auth/login', 'POST', { username, password });
}

export function requestMountAccess(shellyID: string){
    return fetchServer('/request-access/'+shellyID);
}

// ble

export async function getScanned() {
    return fetchServer('/ble/scanned');
}

export async function scanBle() {
    return fetchServer('/ble/scan');
}

export async function getInfoBle(mac: string) {
    return fetchServer('/ble/scan/single/' + mac);
}

export async function getInfoMultiple(macs: string[]) {
    return fetchServer('/ble/multiple', 'POST', { macs })
}

export async function provisionMultiple(macs: string[], wifiName: string, wifiPass: string, wsServer: string) {
    return fetchServer('/ble/provision', 'POST', { macs, wifi: { ssid: wifiName, pass: wifiPass }, wsServer })
}

export async function provision(mac: string, wsServer: string, wifi?: { ssid: string, pass: string }) {
    return fetchServer(`/device/${mac}/provision`, 'POST', { wifi, wsServer })
}
