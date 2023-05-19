import { ERROR_CODES } from "../tools/jsonrpc";
import DeviceComponent from "./component/DeviceComponent";
import FleetManagerComponent from "./component/FleetManagerComponent";
import { WebSocket } from "ws";
import log4js from 'log4js';
import MdnsComponent from "./component/MdnsComponent";
import GroupsComponent from "./component/GroupsComponent";
import UserComponent from "./component/UserComponent";
import DebugComponent from "./component/DebugComponent";
import Component from "./component/Component";
const logger = log4js.getLogger();

export interface command_sender_t {
    permissions: string[],
    group: string,
    additional?: {
        socket?: WebSocket
    }
}

const COMMAND_SENDER_INTERNAL:command_sender_t =  {
    permissions: ["*"],
    group: "admin"
}

export default class Commander {
    static #instance: Commander;
    #components: Map<string, Component>;
    readonly FleetManager: FleetManagerComponent;
    readonly Device: DeviceComponent;
    readonly Mdns: MdnsComponent;
    readonly Groups: GroupsComponent;
    readonly User: UserComponent;
    readonly Debug: DebugComponent;

    private constructor() {
        this.#components = new Map();
        this.registerComponent(this.FleetManager = new FleetManagerComponent());
        this.registerComponent(this.Device = new DeviceComponent());
        this.registerComponent(this.Mdns = new MdnsComponent());
        this.registerComponent(this.Groups = new GroupsComponent());
        this.registerComponent(this.User = new UserComponent());
        this.registerComponent(this.Debug = new DebugComponent());
    }

    public static getInstance(): Commander {
        if (!Commander.#instance) {
            Commander.#instance = new Commander();
        }

        return Commander.#instance;
    }

    public async exec(sender: command_sender_t, method: string, params?: any): Promise<any> {
        method = method.toLowerCase();

        if (!method.includes('.')) {
            return Promise.reject({ error_code: ERROR_CODES.INVALID_REQUEST });
        }

        const [componentName, submethod] = method.split('.', 2);

        if (!this.#components.has(componentName)) {
            return Promise.reject({ error_code: ERROR_CODES.METHOD_NOT_FOUND });
        }

        const component = this.#components.get(componentName);

        if (component == undefined) {
            return Promise.reject({ error_code: ERROR_CODES.METHOD_NOT_FOUND });
        }

        if (!component.checkParams(method, submethod)) {
            return Promise.reject({ error_code: ERROR_CODES.INVALID_PARAMS });
        }

        return component.call(sender, submethod, params);
    }

    public registerComponent<T extends Component>(component: T, allowOverride = false) {
        if (this.#components.has(component.name)) {
            if (!allowOverride) return;
            logger.warn('Overriding component %s', component.name)
        }
        logger.info("Registering component '%s' with methods:[%s]", component.name, String(component.methodNames))
        this.#components.set(component.name, component)
    }

    public registerComponentFromPlugin(name: string, methods: Map<string, (params: any, sender: command_sender_t) => Promise<any>>){
        this.registerComponent(new PluginGeneratedComponent(name, methods))
    }

    public deleteComponent(name: string) {
        this.#components.delete(name)
    }

    public getComponent(name: string){
        return this.#components.get(name)
    }

    public getComponents(){
        return this.#components;
    }

    public listCommands(){
        return Array.from(this.#components.keys())
    }

    public async getConfig(name: string) {
        const component = this.getComponent(name);
        if(component == undefined){
            return {}
        }
        return component.getConfig();
    }

    public async getStatus(name: string){
        const component = this.getComponent(name);
        if(component == undefined){
            return {}
        }
        return component.getStatus();
    }
}

class PluginGeneratedComponent extends Component {
    constructor(name: string, methods: Map<string, (params: any, sender: command_sender_t) => Promise<any>>){
        super(name, { set_config_methods: false, auto_apply_config: false });
        this.methods = methods;
    }

    override async getConfig(params?: any) {
        if(this.methodNames.includes('getconfig')){
            return this.call(COMMAND_SENDER_INTERNAL, 'getconfig');
        }
        return {};
    }

    override async getStatus(params?: any) {
        if(this.methodNames.includes('getstatus')){
            return this.call(COMMAND_SENDER_INTERNAL, 'getstatus');
        }
        return {};
    }

    public override checkParams(method: string, params?: any): boolean {
        return true;
    }

    override async setConfig(config: Record<string, any>) {
        if(!this.methodNames.includes('setconfig')){
            return Promise.reject({ error_code: ERROR_CODES.METHOD_NOT_FOUND });
        }
        return this.call(COMMAND_SENDER_INTERNAL, 'setconfig', config);
    }
    
}