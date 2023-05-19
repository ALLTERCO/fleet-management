import Component from "./Component";
import log4js from 'log4js';
const logger = log4js.getLogger('FleetManagerComponent');
import * as EventManager from "../../EventManager";
import Commander, { command_sender_t } from "../Commander";
import { DEFAULT_RPC } from "../../config";
import { listPlugins } from "../../config/plugins";

function subscribe(params: any, sender: command_sender_t) {
    const events: string[] = params.events;
    let event_ids: number[] = [];

    const socket = sender.additional?.socket;
    if (socket == undefined) {
        return Promise.reject({ error: "bad sender" })
    }
    for (const event of events) {
        logger.mark("adding event event_name:[%s]", event)
        const event_id = EventManager.addEventListener(event, (event: json_rpc_event) => {
            if (socket && socket.readyState === 1) { // WebSocket.OPEN = 1
                socket.send(JSON.stringify(event))
            }
        })
        event_ids.push(event_id);
    }

    socket.on('close', () => {
        event_ids.forEach((id) => EventManager.removeEventListener(id))
    })

    return Promise.resolve(event_ids)
}

export default class FleetManagerComponent extends Component {
    constructor() {
        super('fleetmanager');
        this.methods.set('subscribe', subscribe);
        this.methods.set('listrpc', () => DEFAULT_RPC)
        this.methods.set('listcommands', () => Commander.getInstance().listCommands())
        this.methods.set('listplugins', () => {
            let plugins: Record<string, PluginData & { config?: any}> = listPlugins();
            for(const plugin in plugins){
                const config = (<Component> Commander.getInstance().getComponent(`plugin:${plugin}`))?.getConfig();
                plugins[plugin].config = config;
            }
            
            return plugins;
        });
        this.methods.delete('setconfig')
    }

    public override checkParams(method: string, params?: any): boolean {
        switch (method) {
            case 'subscribe':
                return typeof params.events === 'object'
                    && Array.isArray(params.events)
                    && params.events.every((event: any) => typeof event === 'string')
            default:
                return super.checkParams(method, params);
        }
    }

    override async getStatus() {
        let status: Record<string, any> = {};
        for (const [name, component] of Commander.getInstance().getComponents().entries()) {
            if (component == this) {
                continue;
            }
            const compStatus = await Commander.getInstance().getStatus(name);
            if (Object.keys(compStatus).length > 0) {
                status[name] = compStatus;
            }
        }
        return status;
    }

    override async getConfig() {
        let config: Record<string, any> = {};
        for (const [name, component] of Commander.getInstance().getComponents().entries()) {
            if(name == this.name){
                continue;
            }
            const compConfig = await Commander.getInstance().getConfig(name);
            if (Object.keys(compConfig).length > 0) {
                config[name] = compConfig;
            }
        }
        return config;
    }

}