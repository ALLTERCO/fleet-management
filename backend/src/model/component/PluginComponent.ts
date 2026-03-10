import {PluginLoader} from '../../modules/plugins';
import Component from './Component';

interface PluginComponentConfig {
    name: string;
    enable: boolean;
}

export default class PluginComponent extends Component<PluginComponentConfig> {
    private pluginName: string;

    constructor(name: string) {
        super(`plugin:${name}`, {config_base: {name}});
        this.pluginName = name;
    }

    protected override checkConfigKey(key: string, value: any): boolean {
        switch (key) {
            case 'enable':
                return typeof value === 'boolean';
            case 'name':
                return false;
            default:
                return super.checkConfigKey(key, value);
        }
    }

    protected override async applyConfigKey(
        key: string,
        value: any,
        config: Record<string, any>,
        init: boolean
    ): Promise<void> {
        if (init) return;
        switch (key) {
            case 'enable': {
                const name = this.pluginName;
                // do not build frontend on boot
                if (value) {
                    await PluginLoader.enablePlugin(name);
                } else {
                    PluginLoader.disablePlugin(name);
                }
                super.applyConfigKey(key, value, config, init);

                break;
            }
            case 'name':
                // name cannot be changed
                break;
        }
    }

    protected override getDefaultConfig(): PluginComponentConfig {
        return {name: this.pluginName, enable: false};
    }
}
