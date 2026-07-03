// Pre-loads PluginComponent before Component; otherwise extends-TDZ.
import '../../modules/EventDistributor';

import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    ANALYTICS_DESCRIBE,
    ATTRIBUTE_WINDOW_PARAMS_SCHEMA,
    type AttributeWindowQuery,
    type AttributeWindowResult
} from '../../types/api/analytics';
import {
    type AttributeWindowRepo,
    handleAttributeWindow
} from '../analytics/attributeWindowHandler';
import type CommandSender from '../CommandSender';
import Component from './Component';

export default class AnalyticsComponent extends Component {
    readonly #repo: AttributeWindowRepo;

    constructor(repo: AttributeWindowRepo) {
        super('analytics', {
            set_config_methods: false,
            auto_apply_config: false
        });
        this.#repo = repo;
    }

    protected override getDefaultConfig(): Record<string, never> {
        return {};
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return ANALYTICS_DESCRIBE;
    }

    @Component.Expose('AttributeWindow')
    @Component.CrudPermission('analytics', 'read')
    @Component.RateLimit('expensive')
    async attributeWindow(
        rawParams: unknown,
        sender: CommandSender
    ): Promise<AttributeWindowResult> {
        const params = validateOrThrow<AttributeWindowQuery>(
            rawParams,
            ATTRIBUTE_WINDOW_PARAMS_SCHEMA
        );
        return handleAttributeWindow(params, sender, this.#repo);
    }
}
