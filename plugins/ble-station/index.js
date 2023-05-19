"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.unload = exports.load = void 0;
// END: TYPES
const net_1 = require("net");
let socket;
let id = 0;
let waiting = new Map();
function send(method, params, cb) {
    socket.write(JSON.stringify({ id, method, params }));
    if (cb) {
        console.log("setting", id);
        waiting.set(id, cb);
    }
    id++;
}
async function load() {
    console.log("[BLE] Plugin loaded");
    socket = new net_1.Socket();
    socket.connect(7012, "127.0.0.1", () => {
        console.log("[BLE] connected to station");
        socket.on('data', (rawData) => {
            const message = JSON.parse(rawData.toString());
            console.log("resolved", message.id, waiting.has(message.id));
            if (typeof message.id === 'number' && waiting.has(message.id)) {
                console.log("calling", message.id);
                waiting.get(message.id)(message);
            }
        });
    });
}
exports.load = load;
function unload() {
    if (socket && socket.readyState === 'open') {
        socket.destroy();
    }
    console.log("[BLE] Plugin unloaded");
}
exports.unload = unload;
async function scan(params) {
    return new Promise((resolve, reject) => {
        send('scan', {}, (message) => {
            if (message.result) {
                resolve(message.result);
            }
            else {
                reject(message.error || message);
            }
        });
    });
}
async function forward(params) {
    return new Promise((resolve, reject) => {
        send('scan', params, (message) => {
            if (message.result) {
                resolve(message.result);
            }
            else {
                reject(message.error || message);
            }
        });
    });
}
defineComponent({
    name: 'ble',
    methods: new Map([
        ['scan', scan],
        ['forward', forward],
    ])
});
