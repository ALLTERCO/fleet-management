// FM-side decoration store for virtual components on a Shelly host.

import {assertAssetBelongsToOrg} from '../../modules/asset/assetRepository';
import * as postgres from '../../modules/PostgresProvider';
import type {DescribeOutput} from '../../rpc/describe';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    VIRTUAL_META_CLEAR_PARAMS_SCHEMA,
    VIRTUAL_META_DELETE_PARAMS_SCHEMA,
    VIRTUAL_META_DESCRIBE,
    VIRTUAL_META_FETCH_PARAMS_SCHEMA,
    VIRTUAL_META_SET_PARAMS_SCHEMA,
    type VirtualMetaClearParams,
    type VirtualMetaDeleteParams,
    type VirtualMetaFetchParams,
    type VirtualMetaSetParams
} from '../../types/api/virtual_meta';
import type CommandSender from '../CommandSender';
import Component from './Component';

export default class VirtualMetaComponent extends Component<any> {
    constructor() {
        super('virtual_meta', {
            set_config_methods: false,
            auto_apply_config: false
        });
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return VIRTUAL_META_DESCRIBE;
    }

    @Component.Expose('Set')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSet(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<VirtualMetaSetParams>(
            params,
            VIRTUAL_META_SET_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender);
        await assertAssetBelongsToOrg(organizationId, v.imagePath);
        const promotedAt = v.promoted === true ? new Date() : null;
        return postgres.virtualMetaSet(
            {
                organizationId,
                hostShellyId: v.shellyID,
                componentKey: v.componentKey
            },
            {
                glyph: v.glyph,
                color: v.color,
                gradient: v.gradient,
                promotedAt,
                imagePath: v.imagePath,
                measurement: v.measurement
            }
        );
    }

    @Component.Expose('Clear')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcClear(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<VirtualMetaClearParams>(
            params,
            VIRTUAL_META_CLEAR_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender);
        return postgres.virtualMetaClear(
            {
                organizationId,
                hostShellyId: v.shellyID,
                componentKey: v.componentKey
            },
            {
                clearGlyph: v.clearGlyph,
                clearColor: v.clearColor,
                clearGradient: v.clearGradient,
                clearPromoted: v.clearPromoted,
                clearImage: v.clearImage,
                clearMeasurement: v.clearMeasurement
            }
        );
    }

    @Component.Expose('Delete')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcDelete(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<VirtualMetaDeleteParams>(
            params,
            VIRTUAL_META_DELETE_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender);
        await postgres.virtualMetaDelete({
            organizationId,
            hostShellyId: v.shellyID,
            componentKey: v.componentKey
        });
        return {};
    }

    @Component.Expose('Fetch')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcFetch(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<VirtualMetaFetchParams>(
            params,
            VIRTUAL_META_FETCH_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender);
        const rows = await postgres.virtualMetaFetch(
            organizationId,
            v.shellyID
        );
        return {items: rows};
    }

    protected override getDefaultConfig() {
        return {};
    }
}
