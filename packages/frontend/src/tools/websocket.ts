import { useEventStore } from '@/stores/events';
import { useDevicesStore } from '@/stores/devices';
import ShellyDevice from '@/ShellyDevice';
import { useToast } from '@/stores/toast';

let connected = false;
let client = undefined as WebSocket | undefined;
const FLEET_SERVER_CLIENT_WS = process.env['VUE_APP_FLEET_WS'] || `ws://${window.location.host}/client`;

export function connect() {
    if (connected) return;

    const dataStore = useEventStore();
    const devicesStore = useDevicesStore();
    const toastStore = useToast();

    client = new WebSocket(FLEET_SERVER_CLIENT_WS);
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
    }
    client.onmessage = (e) => {
        try {
            const parsed = JSON.parse(e.data);
            const { shellyID, message } = parsed;
            if (shellyID != undefined) {
                const event = parsed.event;
                if (event == undefined) {
                    console.error('undefined event', parsed);
                    return;
                }
                switch (event) {
                    case 'Shelly:Connect':
                        devicesStore.addDevice(parsed as ShellyDevice);
                        toastStore.addToast(`${shellyID} connected.`, 'success');
                        break;
                    case 'Shelly:Disconnect':
                        devicesStore.disconnected(shellyID);
                        toastStore.addToast(`${shellyID} disconnected.`, 'danger');
                        break;
                    case 'Shelly:Message':
                        dataStore.addData(Object.assign({ timestamp: Date.now(), method: message.method }, parsed))
                        break;
                    case 'Field:Changed':
                        const { field, name, value } = parsed;
                        devicesStore.fieldChanged(shellyID, name, field, value);
                        break;
                    default:
                        console.error("Unknown event", parsed);
                        break;
                }
            } else {
                console.error("skipping ws message");
            }
        } catch (error) {
            console.error(error);
        }
    }
    connected = true;
}

export function close() {
    if (client != undefined) {
        client.close();
    }
}