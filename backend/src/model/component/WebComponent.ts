import assert from 'node:assert';
import Component from './Component';

export interface WebComponentConfig {
    host?: string;
    port: number;
    port_ssl: number;
    https_crt: string;
    https_key: string;
}

function isValidConfig(config: any): config is WebComponentConfig {
    return (
        config &&
        typeof config === 'object' &&
        typeof config.port === 'number' &&
        typeof config.port_ssl === 'number' &&
        typeof config.https_crt === 'string' &&
        typeof config.https_key === 'string' &&
        typeof config.jwt_token === 'string'
    );
}

export default class WebComponent extends Component<WebComponentConfig> {
    constructor() {
        super('web');
    }

    override async setConfig(
        config: WebComponentConfig,
        init: boolean
    ): Promise<any> {
        // run only on startup
        if (init) {
            // check config and apply
            if (!isValidConfig(config)) {
                this.logger.warn(
                    'config is INVALID, fallback to default config'
                );
                config = this.getDefaultConfig();
            }
            return;
        }

        assert(isValidConfig(config), 'Config is invalid');
        assert(
            config.port > -1 || config.port_ssl > -1,
            'At least one HTTP/HTTPS port must be specified'
        );
        if (config.port_ssl > -1) {
            assert(config.https_crt.length > 0, 'https_crt not set');
            assert(config.https_key.length > 0, 'https_key not set');
        }

        await this._persistConfig();
    }

    protected override getDefaultConfig() {
        return {
            port: 7011,
            port_ssl: -1,
            https_crt: '/path/to/cert.crt',
            https_key: '/path/to/cert.key',
            jwt_token: 'shelly-secret-token'
        };
    }
}
