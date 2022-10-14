import * as NodeBle from 'node-ble';
import ShellyBLE from './ShellyBLE';
import { queue } from "./index";
import { EventEmitter } from 'stream';
import log4js from 'log4js';
const logger = log4js.getLogger('Bluetooth');

interface device_t {
    name: string,
    deviceInfo?: any,
    wifi?: any,
}

const devices: Record<string, device_t> = {};

let bluetooth: NodeBle.Bluetooth;
export let destroy: () => void;
let adapter: NodeBle.Adapter;
const blacklist: Set<string> = new Set();

const eventEmitter = new EventEmitter();
export function on(topic: 'device-info', listener: (shellyID: string, mac:string, data: any) => any){
    eventEmitter.on(topic, listener);
}

export function getDevices() {
    return devices;
}

export async function provision(mac: string, wsServer: string, wifi: any) {
    logger.debug("provision started for", mac, wsServer, wifi)
    const shelly = await getShellyBle(mac);
    logger.debug("provision started for", shelly.name)
    if (shelly == undefined) return Promise.reject("shelly not found")
    await shelly.connect();
    const wifiResp = await shelly.changeWifi(wifi.ssid, wifi.pass, 10_000);
    const wsResp = await shelly.changeWs(wsServer);
    const reboot = await shelly.sendAndWait(JSON.stringify({
        method: 'Shelly.Reboot',
    }), 5000)

    return { wifiResp, wsResp, reboot };
}

export async function init(){
    const bleObj = NodeBle.createBluetooth();
    bluetooth = bleObj.bluetooth;
    destroy = bleObj.destroy;
    await new Promise(done => setTimeout(done, 100));
    adapter = await bluetooth.defaultAdapter();
    logger.info('Starting BLE discovery');
    await adapter.startDiscovery();
    await new Promise(done => setTimeout(done, 500));
}

async function getAdapterDevices() {
    return (await adapter.devices()).filter(dev => !blacklist.has(dev));
}

export async function scan() {
    for (const mac of await getAdapterDevices()) {
        if (blacklist.has(mac)) continue;
        try {
            const device = await adapter.getDevice(mac);
            const name = await device.getName();
            logger.debug("scanned " + name + " " + mac)

            if (name.toLowerCase().startsWith("shelly") && devices[mac] == undefined) {
                devices[mac] = { name };
            } else {
                blacklist.add(mac);
            }

            // return devices;
        } catch (error) {
            continue;
        }
    }
    await new Promise(resolve => setTimeout(resolve, 150));
}

async function getShellyBle(mac: string) {
    return new ShellyBLE(await adapter.getDevice(mac), devices[mac].name);
}

export async function shellyRPC(mac: string, rpc: string) {
    try {
        const device = devices[mac];
        if (device == undefined) return Promise.reject("device not connected");

        const shelly = await getShellyBle(mac);
        await shelly.connect();
        const resp = await shelly.sendAndWait(rpc, 10_000);
        await shelly.disconnect();
        return resp;
    } catch (error) {
        return undefined;
    }
}

async function deviceInfo(mac: string) {
    const device = devices[mac];
    if (device.deviceInfo != undefined) return;
    try {

        const shelly = await getShellyBle(mac);
        await shelly.connect();
        const deviceInfo = await shelly.getDeviceInfo();
        if (deviceInfo) {
            devices[mac].deviceInfo = JSON.parse(deviceInfo);
            eventEmitter.emit('device-info', devices[mac].deviceInfo.src, mac, devices[mac].deviceInfo.result);
        }
        await shelly.disconnect();
        return deviceInfo;
    } catch (error) {
        console.error(device.name, error.text);
        return undefined;
    }
}

export function scanDeviceInfo() {
    for (const mac of Object.keys(devices)) {
        queue.enqueue(deviceInfo(mac), {
            timeout: 15_000
        });
    }
}