// BEGIN: TYPES
interface define_component_t {
    name: string,
    methods: Map<string, (params: any, sender: any) => Promise<any>>
}

declare function call(method: string, params?: any): Promise<any>
declare function defineComponent(component: define_component_t): void;

// END: TYPES

import { Socket } from 'net';

let socket: Socket;
let id = 0;
let waiting: Map<number, Function> = new Map()

function send(method: string, params?: any, cb?: Function) {
    socket.write(JSON.stringify({ id, method, params }));
    if(cb){
        waiting.set(id, cb)
    }
    id++;
}

export async function load() {
    console.log("[BLE] Plugin loaded");

    socket = new Socket();
    socket.connect(7012, "127.0.0.1", () => {
        console.log("[BLE] connected to station")

        socket.on('data', (rawData) => {
            try {
                const message = JSON.parse(rawData.toString())
                if(typeof message.id === 'number' && waiting.has(message.id)){
                    waiting.get(message.id)!(message);
                }
            } catch (error) {
                // ignore
            }
        })
    })
}

export function unload() {
    if(socket && socket.readyState === 'open'){
        socket.destroy();
    }
    console.log("[BLE] Plugin unloaded")
}

async function scan(params: any) {
    return new Promise((resolve, reject) => {
        send('scan', {}, (message: any) => {
            if(message.result){
                resolve(message.result)
            } else {
                reject(message.error || message)
            }
        })
    })
}

async function forward(params: any){
    return new Promise((resolve, reject) => {
        send('forward', params, (message: any) => {
            if(message.result){
                resolve(message.result)
            } else {
                reject(message.error || message)
            }
        })
    })
}

defineComponent({
    name: 'ble',
    methods: new Map([
        ['scan', scan],
        ['forward', forward],
    ])
})

