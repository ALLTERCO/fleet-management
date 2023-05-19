import Component from "./Component";
import * as plugins from "../../config/plugins";

export default class PluginComponent extends Component {
    #name: string;

    constructor(name: string) {
        super(`plugin:${name}`);
        this.#name = name;
    }

    protected override checkConfigKey(key: string, value: any): boolean {
        switch (key) {
            case 'enable':
                return typeof value === 'boolean';
            default:
                return super.checkConfigKey(key, value);
        }
    }

    protected override applyConfigKey(key: string, value: any, config: Record<string, any>): void {
        switch (key) {
            case 'enable':
                const enable = Boolean(value);
                if(enable == config.enable){
                    // nothing has changed
                    break;
                }
                if(enable){
                    plugins.enablePlugin(this.#name);
                } else {
                    plugins.disablePlugin(this.#name);
                }
                break;
        }
        super.applyConfigKey(key, value, config);
    }

    protected override getDefaultConfig(): Record<string, any> {
        return { enable: false }
    }
}