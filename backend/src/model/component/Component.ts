import * as components from "../../config/components";
import { command_sender_t } from "../Commander";
import { ERROR_CODES } from "../../tools/jsonrpc";

interface constructor_properties {
    auto_apply_config?: boolean,
    set_config_methods?: boolean
}

type method_cb = (params: any, sender: command_sender_t) => any | Promise<any> | PromiseLike<any>;

const DEFAULT_PROPERTIES:constructor_properties = {
    auto_apply_config: true,
    set_config_methods: true,
}

export default abstract class Component {
    readonly name: string;
    protected methods: Map<string, method_cb>;
    protected config: Record<string, any>;

    constructor(name: string, properties?: constructor_properties) {
        this.name = name;
        this.methods = new Map();
        const props = Object.assign(DEFAULT_PROPERTIES, properties);
        this.config = {};
        if(props.set_config_methods){
            // default methods
            this.methods.set('getstatus', (params) => this.getStatus(params));
            this.methods.set('getconfig', (params) => this.getConfig(params));
            this.methods.set('setconfig', (params) => this.setConfig(params.config));
        }

        if(props.auto_apply_config){
            this.setConfig(components.getConfigFor(name, this.getDefaultConfig()))
        }
    }

    public async call(sender: command_sender_t, method: string, params?: any) {
        if (!this.methods.has(method)) {
            return Promise.reject({ error_code: ERROR_CODES.METHOD_NOT_FOUND });
        }

        if (!this.checkPermissions(sender, method)) {
            return Promise.reject({ error: "Insufficient permissions" });
        }

        const methodHandler = this.methods.get(method);
        if (typeof methodHandler !== 'function') {
            return Promise.reject({ error_code: ERROR_CODES.METHOD_NOT_FOUND });
        }

        if (!this.checkParams(method, params)) {
            return Promise.reject({ error_code: ERROR_CODES.INVALID_PARAMS });
        }

        return methodHandler(params, sender)
    }

    protected checkPermissions(sender: command_sender_t, method: string) {
        return sender.group === 'admin'
            || sender.permissions.includes("*")
            || sender.permissions.includes(`${this.name}.${method}`.toLowerCase())
    }

    public checkParams(method: string, params?: any): boolean {
        switch (method) {
            case 'setconfig':
                return typeof params === 'object'
                    && typeof params.config === 'object'
                    && Object.keys(params.config).length > 0
            default:
                return true;
        }
    }

    // allow to be overridden
    protected checkConfigKey(key: string, value: any) {
        return false;
    }

    // allow to be overridden
    protected applyConfigKey(key: string, value: any, config: Record<string, any>) {
        this.config[key] = value;
    }

    protected configChanged() {
        // empty
    }

    protected getDefaultConfig(): Record<string, any> {
        return {};
    }

    // allow to be overridden
    getStatus(params?: any): Record<string, any> {
        return {};
    }

    getConfig(params?: any) {
        return Object.assign({}, this.config);
    }

    setConfig(config: Record<string, any>): any | Promise<any> {
        for (const key in config) {
            if (this.checkConfigKey(key, config[key])) {
                this.applyConfigKey(key, config[key], config);
            }
        }
        components.saveConfig(this.name, this.config);
        this.configChanged();
        // fire config changed event
        return {
            component: this.name,
            event: "config_changed",
        }
    }

    get methodNames() {
        return Array.from(this.methods.keys())
    }

}