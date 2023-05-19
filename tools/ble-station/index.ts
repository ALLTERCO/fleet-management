import { createBluetooth } from "node-ble";
import * as Shelly from "./Shelly"
import { createServer } from "net";

const blacklist = new Set<string>();
const devices: Map<string, string> = new Map();

const { bluetooth, destroy } = createBluetooth();

let connectedDevice: any;
let inUse = false;

async function scan() {
    devices.clear()
    const adapter = await bluetooth.defaultAdapter()
    if (! await adapter.isDiscovering())
        await adapter.startDiscovery()

    // give one second discovery time
    await new Promise(resolve => setTimeout(resolve, 1000))

    for (const mac of await adapter.devices()) {
        if (blacklist.has(mac) || blacklist.has(mac.split(":").join(""))) continue;
        try {
            const device = await adapter.getDevice(mac);
            const name = await device.getName();

            if (name.toLowerCase().startsWith("shelly")) {
                // console.debug("scanned shelly " + name + " " + mac)

                devices.set(name, mac);
            } else {
                blacklist.add(mac);
            }
        } catch (error) {
            continue;
        }
    }

    console.log(devices)

    await adapter.stopDiscovery();
    return Object.fromEntries(devices);
}

async function sendMessage(shellyID: string, method: string, params?: any) {
    if (devices.size == 0) return Promise.resolve({ error: "No devices scanned" });
    const mac = devices.get(shellyID);
    if (mac == undefined) return Promise.reject({ error: "Device not found" });

    console.log('conencting to ', shellyID, mac)
    const adapter = await bluetooth.defaultAdapter()
    const device = await adapter.getDevice(mac);

    const shelly = await Shelly.connect(device, shellyID);

    return new Promise((resolve, reject) => {
        shelly.on('open', () => {
            connectedDevice = shelly;
            console.log('opene event');
            shelly.send(method, params);
            shelly.on('close', () => {
                connectedDevice = undefined;
                console.log('close event');
            });
            shelly.on('message', (message: string) => {
                console.log('message event', message);
                shelly.disconnect();
                resolve(message)
            })
            shelly.on('read_error', (error: any, buffer: any) => {
                console.log('read error', error, buffer);
                reject({ error: "I/O Error" });
            })
        });
    });
}

let shuttingdown = false;
async function shutdown() {
    if (shuttingdown) return;
    shuttingdown = true;
    setTimeout(() => {
        console.log("force shutdown")
        process.exit(1);
    }, 500);
    console.log("shutdown");
    server.close();
    if (connectedDevice && typeof connectedDevice.disconnect === 'function') {
        console.log('disconnecting connected device');
        await connectedDevice.disconnect();
    }
    console.log('destroying adapter');
    destroy();
}

const server = createServer();
server.listen(7012, () => {
    console.log("tcp server started on 7012");
});

server.on('connection', (socket) => {
    if (inUse) {
        socket.write(JSON.stringify({ error: "in_use" }))
        socket.destroy();
        return;
    }
    inUse = true;

    socket.on('close', () => {
        inUse = false;
    });

    function send(id: number | null, result: any, error?: string) {
        if (socket.readyState === 'open') {
            socket.write(JSON.stringify({ id, result, error }))
            if(error){
                socket.destroy();
            }
        }
    }

    socket.on('data', async (rawData) => {
        try {
            const data = JSON.parse(rawData.toString());
            if (typeof data.method !== 'string' || typeof data.id !== 'number') {
                throw new Error("Bad format")
            }

            const { method, params, id }: { method: string, params: any, id: number } = data;
            switch (method.toLowerCase()) {
                case 'scan':
                    const scan_result = await scan()
                    send(id, scan_result)
                    break;
                case 'forward':
                    const { shellyID, params: call_params, method: call_method } = params;
                    const forward_result = await sendMessage(shellyID, call_method, call_params);
                    send(id, forward_result);
                    break;
                default:
                    throw new Error("Method not found")
            }
        } catch (error: any) {
            const id = typeof error?.id === 'number' ? error.id : null;
            const error_msg = typeof error?.message === 'string' ? error.error : String(error)
            send(id, null, error_msg);
        }
    })
})

process.on('SIGINT', shutdown);
process.on('exit', shutdown);

// scan().then(() => {
//     sendMessage('ShellyPlusPlugS-B48A0A1BC66C', 'sys.getconfig').then(console.log)
// });