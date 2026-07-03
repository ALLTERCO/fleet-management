import {DEV_MODE} from '../../config';
import {canUsePlatformAdmin} from '../../modules/authz/evaluator';
import {requireSaasMode} from '../../modules/saasMode';
import type {DescribeOutput} from '../../rpc/describe';
import RpcError from '../../rpc/RpcError';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    ALEXA_DESCRIBE,
    ALEXA_DISABLE_PARAMS_SCHEMA,
    ALEXA_ENABLE_PARAMS_SCHEMA,
    type AlexaDisableResponse,
    type AlexaEnableParams,
    type AlexaEnableResponse
} from '../../types/api/alexa';
import Component from './Component';

interface AlexaConfig {
    enable: boolean;
    access_token?: string;
    refresh_token?: string;
    entities?: string[];
}

export default class AlexaComponent extends Component<AlexaConfig> {
    constructor() {
        super('alexa', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.Expose('Disable')
    @Component.CheckPermissions(canUsePlatformAdmin)
    disable(params: unknown): AlexaDisableResponse {
        requireSaasMode('alexa');
        validateOrThrow<Record<string, never>>(
            params ?? {},
            ALEXA_DISABLE_PARAMS_SCHEMA
        );
        if (!this.config.enable) {
            throw RpcError.InvalidRequest();
        }
        return {cmd: 'disable'};
    }

    @Component.Expose('Enable')
    @Component.CheckPermissions(canUsePlatformAdmin)
    enable(params: unknown): AlexaEnableResponse {
        requireSaasMode('alexa');
        const validated = validateOrThrow<AlexaEnableParams>(
            params,
            ALEXA_ENABLE_PARAMS_SCHEMA
        );
        if (this.config.enable) {
            throw RpcError.InvalidRequest();
        }
        this.setConfig({...validated, enable: true});
        return {cmd: 'enable', params: validated};
    }

    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return ALEXA_DESCRIBE;
    }

    override getConfig(): Partial<AlexaConfig> {
        // Hide Alexa tokens in production
        if (!DEV_MODE) {
            return {};
        }
        return super.getConfig();
    }

    protected override getDefaultConfig(): AlexaConfig {
        return {
            enable: false
        };
    }
}
