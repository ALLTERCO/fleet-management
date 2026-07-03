import {incrementLabeledCounter} from '../../modules/Observability';
import {
    getServesLink,
    listServesLinks,
    setServesLinks,
    unsetServesLinks
} from '../../modules/servesRepository';
import type {DescribeOutput} from '../../rpc/describe';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    SERVES_DESCRIBE,
    SERVES_GET_PARAMS_SCHEMA,
    SERVES_LIST_PARAMS_SCHEMA,
    SERVES_SET_PARAMS_SCHEMA,
    SERVES_UNSET_PARAMS_SCHEMA,
    type ServesGetParams,
    type ServesListParams,
    type ServesSetParams,
    type ServesUnsetParams
} from '../../types/api/serves';
import type CommandSender from '../CommandSender';
import Component from './Component';

export default class ServesComponent extends Component {
    constructor() {
        super('serves', {
            set_config_methods: false,
            auto_apply_config: false,
            viewer_visible: true
        });
    }

    protected override getDefaultConfig(): Record<string, never> {
        return {};
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return SERVES_DESCRIBE;
    }

    @Component.Expose('Set')
    @Component.CrudPermission('devices', 'update')
    async set(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<ServesSetParams>(
            params,
            SERVES_SET_PARAMS_SCHEMA
        );
        const links = await setServesLinks(
            requireOrganizationId(sender, {}),
            p
        );
        incrementLabeledCounter('serves_created', {
            relation: p.relation ?? 'serves:serves'
        });
        return {items: links};
    }

    @Component.Expose('Unset')
    @Component.CrudPermission('devices', 'update')
    async unset(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<ServesUnsetParams>(
            params,
            SERVES_UNSET_PARAMS_SCHEMA
        );
        return {
            deleted: await unsetServesLinks(
                requireOrganizationId(sender, {}),
                p
            )
        };
    }

    @Component.Expose('List')
    @Component.CrudPermission('devices', 'read')
    async list(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<ServesListParams>(
            params,
            SERVES_LIST_PARAMS_SCHEMA
        );
        return {
            items: await listServesLinks(requireOrganizationId(sender, {}), p)
        };
    }

    @Component.Expose('Get')
    @Component.CrudPermission('devices', 'read')
    async get(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<ServesGetParams>(
            params,
            SERVES_GET_PARAMS_SCHEMA
        );
        const link = await getServesLink(requireOrganizationId(sender, {}), p);
        if (!link) throw RpcError.NotFound('serves link', '');
        return link;
    }
}
