import type {DescribeOutput} from '../../rpc/describe';
import {WEB_DESCRIBE} from '../../types/api/web';
import Component from './Component';
import {
    assertMergedWebConfigValid,
    WEB_DEFAULT_HTTPS_CRT,
    WEB_DEFAULT_HTTPS_KEY,
    WEB_DEFAULT_PORT,
    WEB_DEFAULT_PORT_SSL,
    WEB_FIELD_TYPES,
    type WebComponentConfig
} from './webConfigValidation';

export type {WebComponentConfig} from './webConfigValidation';

export default class WebComponent extends Component<WebComponentConfig> {
    constructor() {
        super('web');
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return WEB_DESCRIBE;
    }

    protected override checkConfigKey(key: string, value: unknown): boolean {
        const expected = WEB_FIELD_TYPES[key as keyof WebComponentConfig];
        if (expected === 'string') return typeof value === 'string';
        if (expected === 'number') return typeof value === 'number';
        return false;
    }

    override async setConfig(
        config: Partial<WebComponentConfig>,
        init = false
    ): Promise<void> {
        // Init: applying the persisted config from disk. If it's missing
        // required fields (first boot, hand-edited JSON) fall back to
        // generated defaults so the listener still comes up.
        if (init) {
            const merged = {...this.config, ...config};
            try {
                assertMergedWebConfigValid(merged);
            } catch {
                this.logger.warn(
                    'persisted web config invalid; falling back to defaults'
                );
                Object.assign(this.config, this.getDefaultConfig());
            }
            return;
        }

        // Runtime patch: merge → validate cross-field invariants → commit.
        const merged: WebComponentConfig = {...this.config, ...config};
        assertMergedWebConfigValid(merged);
        await super.setConfig(config, init);
    }

    protected override getDefaultConfig(): WebComponentConfig {
        return {
            port: WEB_DEFAULT_PORT,
            port_ssl: WEB_DEFAULT_PORT_SSL,
            https_crt: WEB_DEFAULT_HTTPS_CRT,
            https_key: WEB_DEFAULT_HTTPS_KEY,
            jwt_token: require('node:crypto').randomBytes(32).toString('hex')
        };
    }
}
