import { useDevicesStore } from '@/stores/devices';
import { useToastStore } from '@/stores/toast';
import * as http from "../tools/http";

let connected = false;
let client = undefined as WebSocket | undefined;
const FLEET_SERVER_CLIENT_WS = `ws://${window.location.host}`;

interface json_rpc_result {
    id: number,
    src: string,
    dst: string,
    error?: any,
    result?: any,
}

function is_rpc_response(data: any): data is json_rpc_result {
    return typeof data === 'object'
        && (typeof data.result === 'object' || typeof data.result === 'undefined')
        && (typeof data.error === 'object' || typeof data.error === 'undefined')
        && typeof data.id === 'number'
        && typeof data.src === 'string'
        && typeof data.dst === 'string'
}

function is_json_rpc_event(data: any): data is json_rpc_event {
    return typeof data === 'object'
        && typeof data.method === 'string'
        && typeof data.params === 'object'
}

let id = 2;
const waiting = new Map<number, { resolve: Function, reject: Function }>();

const sendQueue: any[] = [];

export function sendRPC(dst: string, method: string, params?: any): Promise<any> {
    if (client == undefined) {
        console.warn("websocket not connecting, fallback to http :(");
        return new Promise((resolve, reject) => {
            sendQueue.push({ dst, method, params, resolve, reject })
        });
    }

    client.send(JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        src: 'FLEET_MANAGER_UI',
        dst,
        params
    }))

    const response = new Promise((resolve, reject) => {
        waiting.set(id, { resolve, reject })
    });

    const timeout = new Promise((_, reject) => setTimeout(reject, 10_000));

    id = id + 1;
    return Promise.race([response, timeout]);
}

function handleRpcResponse(response: json_rpc_result) {
    const { id } = response;
    if (waiting.has(id)) {
        const { resolve, reject } = waiting.get(id)!;
        if (response.result) {
            resolve(response.result);
            return;
        }
        reject(response.error ?? response);
    }
}

function handleShellyEvents(event: json_rpc_event, devicesStore: ReturnType<typeof useDevicesStore>, toastStore: ReturnType<typeof useToastStore>) {
    const shellyID = event.params.shellyID;
    const method = event.method;
    if (typeof shellyID !== 'string') {
        console.error('bad event, no shellyID', method);
        return;
    }

    switch (method) {
        case 'Shelly.Connect':
            const connectEvent = event as ShellyEvent.Connect;
            devicesStore.deviceConnected(connectEvent.params.device);
            toastStore.addToast(`${shellyID} connected.`, 'success');
            break;
        case 'Shelly.Disconnect':
            devicesStore.deviceDisconnected(shellyID);
            toastStore.addToast(`${shellyID} disconnected.`, 'danger');
            break;
        case 'Shelly.Info':
            const infoEvent = event as ShellyEvent.Info;
            devicesStore.patchInfo(shellyID, infoEvent.params.info);
            break;
        case "Shelly.Status":
            const statusEvent = event as ShellyEvent.Status;
            devicesStore.patchStatus(shellyID, statusEvent.params.status);
            break;
        case "Shelly.Settings":
            const settingsEvent = event as ShellyEvent.Settings;
            devicesStore.patchSettings(shellyID, settingsEvent.params.settings);
            break;
        case "Shelly.Group":
            const groupEvent = event as ShellyEvent.Group;
            devicesStore.patchGroups(shellyID, groupEvent.params.groups);
            break
        case 'Ble:Status':
            const { status } = event.params;
            const device = Object.values(devicesStore.ble.devices).find(d => d.mac == shellyID);
            if (device) {
                device.status = status;
            }
            toastStore.addToast("Bluetooth " + shellyID + " : " + status)
            break;
        default:
            console.error("Unknown event", event);
            break;
    }
}

export function connect() {
    if (connected) return;

    const devicesStore = useDevicesStore();
    const toastStore = useToastStore();

    client = new WebSocket(FLEET_SERVER_CLIENT_WS, localStorage.getItem('fleet-management-token') || '');

    client.onclose = (e) => {
        console.log('ws closed');
        connected = false;
    }
    client.onerror = (e) => {
        console.error("ws error: ", e);
        connected = false;
    }
    client.onopen = (e) => {
        console.log('ws connected');
        connected = true;
        // send subscribe event
        client?.send(JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'FleetManager.Subscribe',
            src: 'FLEET_MANAGER_UI',
            dst: 'FLEET_MANAGER',
            params: {
                events: ['Shelly.Connect', 'Shelly.Disconnect', 'Shelly.Status', 'Shelly.Settings', 'Shelly.KVS', 'Shelly.Info']
            }
        }));

        sendQueue.forEach((item) => {
            const { dst, method, params, resolve, reject } = item;
            sendRPC(dst, method, params).then(resolve, reject);
        })
    }
    client.onmessage = (e) => {
        try {
            const parsed = JSON.parse(e.data);
            console.log("parsed", parsed)
            if (is_rpc_response(parsed)) {
                console.log("rpc resp")
                handleRpcResponse(parsed);
                return;
            }

            if (!is_json_rpc_event(parsed)) {
                return;
            }

            const { method, params } = parsed;

            if (method.startsWith("Shelly.")) {
                handleShellyEvents(parsed, devicesStore, toastStore);
            } else {
                console.error("skipping ws event", parsed);
            }
        } catch (error) {
            console.error("error in ws event", error);
        }
    }
}

export function close() {
    if (client != undefined) {
        client.close();
    }
}

export async function listDevices(): Promise<Record<string, any>> {
    return sendRPC('FLEET_MANAGER', 'device.list');
}


export async function enablePlugin(name: string, value: boolean) {
    return sendRPC('FLEET_MANAGER', `plugin:${name}.setconfig`, { config: { enable: value } });
}

export async function listPlugins() {
    return sendRPC('FLEET_MANAGER', 'fleetmanager.listplugins');
}

export async function getSavedTemplates() {
    const templates = await sendRPC('FLEET_MANAGER', 'fleetmanager.listrpc');
    let build = {} as { [key: string]: any };
    for (const key in templates) {
        build[key] = templates[key].map((res: any) => {
            res.rowData = Object.entries(res.params || {});
            delete res.params;
            return res;
        })
    }
    return build;
}

export async function listGroups() {
    return sendRPC('FLEET_MANAGER', 'groups.list');
}

export async function getServerConfig() {
    return sendRPC('FLEET_MANAGER', 'fleetmanager.getconfig');
}