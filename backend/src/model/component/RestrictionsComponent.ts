import {canUsePlatformAdmin} from '../../modules/authz/evaluator';
import {zitadelService} from '../../modules/zitadel/ZitadelService';
import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    RESTRICTIONS_DESCRIBE,
    RESTRICTIONS_GET_SCHEMA,
    RESTRICTIONS_SET_SCHEMA,
    type RestrictionsGetParams,
    type RestrictionsSetParams
} from '../../types/api/restrictions';
import Component from './Component';

export default class RestrictionsComponent extends Component {
    constructor() {
        super('restrictions', {
            set_config_methods: false,
            auto_apply_config: false
        });
    }

    protected override getDefaultConfig(): Record<string, never> {
        return {};
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return RESTRICTIONS_DESCRIBE;
    }

    @Component.Expose('Get')
    @Component.CheckPermissions(canUsePlatformAdmin)
    async get(params: unknown) {
        validateOrThrow<RestrictionsGetParams>(params, RESTRICTIONS_GET_SCHEMA);
        return (await zitadelService.getRestrictions()) ?? {};
    }

    @Component.Expose('Set')
    @Component.CheckPermissions(canUsePlatformAdmin)
    async set(params: unknown) {
        const v = validateOrThrow<RestrictionsSetParams>(
            params,
            RESTRICTIONS_SET_SCHEMA
        );
        const body: {
            disallowPublicOrgRegistration?: boolean;
            allowedLanguages?: {list: string[]};
        } = {};
        if (typeof v.disallowPublicOrgRegistration === 'boolean') {
            body.disallowPublicOrgRegistration =
                v.disallowPublicOrgRegistration;
        }
        if (Array.isArray(v.allowedLanguages)) {
            body.allowedLanguages = {list: v.allowedLanguages};
        }
        await zitadelService.setRestrictions(body);
        return {ok: true};
    }
}
