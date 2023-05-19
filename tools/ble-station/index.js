"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_ble_1 = require("node-ble");
const Shelly = __importStar(require("./Shelly"));
const net_1 = require("net");
const blacklist = new Set();
const devices = new Map();
const { bluetooth, destroy } = (0, node_ble_1.createBluetooth)();
let connectedDevice;
let inUse = false;
function scan() {
    return __awaiter(this, void 0, void 0, function* () {
        devices.clear();
        const adapter = yield bluetooth.defaultAdapter();
        if (!(yield adapter.isDiscovering()))
            yield adapter.startDiscovery();
        // give one second discovery time
        yield new Promise(resolve => setTimeout(resolve, 1000));
        for (const mac of yield adapter.devices()) {
            if (blacklist.has(mac) || blacklist.has(mac.split(":").join("")))
                continue;
            try {
                const device = yield adapter.getDevice(mac);
                const name = yield device.getName();
                if (name.toLowerCase().startsWith("shelly")) {
                    // console.debug("scanned shelly " + name + " " + mac)
                    devices.set(name, mac);
                }
                else {
                    blacklist.add(mac);
                }
            }
            catch (error) {
                continue;
            }
        }
        console.log(devices);
        yield adapter.stopDiscovery();
        return Object.fromEntries(devices);
    });
}
function sendMessage(shellyID, method, params) {
    return __awaiter(this, void 0, void 0, function* () {
        if (devices.size == 0)
            return Promise.resolve({ error: "No devices scanned" });
        const mac = devices.get(shellyID);
        if (mac == undefined)
            return Promise.reject({ error: "Device not found" });
        console.log('conencting to ', shellyID, mac);
        const adapter = yield bluetooth.defaultAdapter();
        const device = yield adapter.getDevice(mac);
        const shelly = yield Shelly.connect(device, shellyID);
        return new Promise((resolve, reject) => {
            shelly.on('open', () => {
                connectedDevice = shelly;
                console.log('opene event');
                shelly.send(method, params);
                shelly.on('close', () => {
                    connectedDevice = undefined;
                    console.log('close event');
                });
                shelly.on('message', (message) => {
                    console.log('message event', message);
                    shelly.disconnect();
                    resolve(message);
                });
                shelly.on('read_error', (error, buffer) => {
                    console.log('read error', error, buffer);
                    reject({ error: "I/O Error" });
                });
            });
        });
    });
}
let shuttingdown = false;
function shutdown() {
    return __awaiter(this, void 0, void 0, function* () {
        if (shuttingdown)
            return;
        shuttingdown = true;
        setTimeout(() => {
            console.log("force shutdown");
            process.exit(1);
        }, 500);
        console.log("shutdown");
        server.close();
        if (connectedDevice && typeof connectedDevice.disconnect === 'function') {
            console.log('disconnecting connected device');
            yield connectedDevice.disconnect();
        }
        console.log('destroying adapter');
        destroy();
    });
}
const server = (0, net_1.createServer)();
server.listen(7012, () => {
    console.log("tcp server started on 7012");
});
server.on('connection', (socket) => {
    if (inUse) {
        socket.write(JSON.stringify({ error: "in_use" }));
        socket.destroy();
        return;
    }
    inUse = true;
    socket.on('close', () => {
        inUse = false;
    });
    function send(id, result, error) {
        if (socket.readyState === 'open') {
            socket.write(JSON.stringify({ id, result, error }));
            if (error) {
                socket.destroy();
            }
        }
    }
    socket.on('data', (rawData) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const data = JSON.parse(rawData.toString());
            if (typeof data.method !== 'string' || typeof data.id !== 'number') {
                throw new Error("Bad format");
            }
            const { method, params, id } = data;
            switch (method.toLowerCase()) {
                case 'scan':
                    const scan_result = yield scan();
                    send(id, scan_result);
                    break;
                case 'forward':
                    const { shellyID, params: call_params, method: call_method } = params;
                    const forward_result = yield sendMessage(shellyID, call_method, call_params);
                    send(id, forward_result);
                    break;
                default:
                    throw new Error("Method not found");
            }
        }
        catch (error) {
            const id = typeof (error === null || error === void 0 ? void 0 : error.id) === 'number' ? error.id : null;
            const error_msg = typeof (error === null || error === void 0 ? void 0 : error.message) === 'string' ? error.error : String(error);
            send(id, null, error_msg);
        }
    }));
});
process.on('SIGINT', shutdown);
process.on('exit', shutdown);
// scan().then(() => {
//     sendMessage('ShellyPlusPlugS-B48A0A1BC66C', 'sys.getconfig').then(console.log)
// });
