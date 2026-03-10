import RpcError from '../../rpc/RpcError';
import CommandSender from '../CommandSender';
import type {ComponentName} from '../permissions';
import Component from './Component';

export default class PluginGeneratedComponent extends Component {
    private readonly pluginId: string;

    constructor(
        name: string,
        methods: Map<
            string,
            (params: any, sender: CommandSender) => Promise<any>
        >,
        pluginId?: string
    ) {
        super(name, {
            set_config_methods: false,
            auto_apply_config: false
        });
        this.pluginId = pluginId ?? name.toLowerCase();
        // appends methods
        for (const [name, exec] of methods.entries()) {
            console.warn('Nill problem! ', name);
            this.addMethod(name.toLowerCase(), exec);
        }
    }

    /**
     * Map plugin components to the 'plugins' permission.
     * Read methods (Get, List) require plugins.read,
     * write methods (Set, Create) require plugins.update/create, etc.
     */
    protected override getComponentName(): ComponentName | null {
        return 'plugins';
    }

    /**
     * Use the plugin name as the item ID for scoped permission checks.
     * This allows per-plugin access control via plugins.scope = 'SELECTED'.
     */
    protected override extractItemId(
        _params?: any
    ): string | number | undefined {
        return this.pluginId;
    }

    override async getConfig(params?: any) {
        if (this.methods.has('getconfig')) {
            return this.call(CommandSender.INTERNAL, 'getconfig');
        }
        return {};
    }

    override async getStatus(params?: any) {
        if (this.methods.has('getstatus')) {
            return this.call(CommandSender.INTERNAL, 'getstatus');
        }
        return {};
    }

    override async setConfig(config: Record<string, any>) {
        if (!this.methods.has('setconfig')) {
            throw RpcError.MethodNotFound();
        }
        return this.call(CommandSender.INTERNAL, 'setconfig', config);
    }

    protected override getDefaultConfig(): Record<string, any> {
        return {};
    }
}
