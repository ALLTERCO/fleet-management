// asset.* RPCs — read/rename/delete the org's visual asset library.

import {
    deleteAssetIfUnreferenced,
    listAssets,
    rowToDto,
    setAssetLabel
} from '../../modules/asset/assetRepository';
import {deleteAssetFromDisk} from '../../modules/asset/assetStorage';
import {
    type ImageMigrationResult,
    runImageMigration
} from '../../modules/asset/imageMigration';
import {canUseTenantAdmin} from '../../modules/authz/evaluator';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import type {DescribeOutput} from '../../types/api/_describe';
import {
    ASSET_DELETE_PARAMS_SCHEMA,
    ASSET_DESCRIBE,
    ASSET_LIST_PARAMS_SCHEMA,
    ASSET_MIGRATE_IMAGES_PARAMS_SCHEMA,
    ASSET_SET_LABEL_PARAMS_SCHEMA,
    type AssetDeleteParams,
    type AssetDeleteResult,
    type AssetListParams,
    type AssetListResult,
    type AssetMigrateImagesParams,
    type AssetSetLabelParams,
    type VisualAssetDto
} from '../../types/api/asset';
import type CommandSender from '../CommandSender';
import Component from './Component';

interface Config {
    viewer_visible: boolean;
}

export default class AssetComponent extends Component<Config> {
    constructor() {
        super('asset', {viewer_visible: false});
    }

    protected override getDefaultConfig(): Config {
        return {viewer_visible: false};
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return ASSET_DESCRIBE;
    }

    @Component.Expose('List')
    @Component.CrudPermission('devices', 'read')
    async list(
        params: unknown,
        sender: CommandSender
    ): Promise<AssetListResult> {
        const p = validateOrThrow<AssetListParams>(
            params ?? {},
            ASSET_LIST_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender, p);
        return listAssets({
            organizationId,
            limit: p.limit,
            cursor: p.cursor,
            search: p.search,
            context: p.context
        });
    }

    @Component.Expose('SetLabel')
    @Component.CrudPermission('devices', 'update')
    async setLabel(
        params: unknown,
        sender: CommandSender
    ): Promise<VisualAssetDto> {
        const p = validateOrThrow<AssetSetLabelParams>(
            params,
            ASSET_SET_LABEL_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender, p);
        const row = await setAssetLabel(organizationId, p.id, p.label);
        if (!row) throw RpcError.Domain('ResourceNotFound');
        return rowToDto(row);
    }

    @Component.Expose('Delete')
    @Component.CrudPermission('devices', 'delete')
    async delete(
        params: unknown,
        sender: CommandSender
    ): Promise<AssetDeleteResult> {
        const p = validateOrThrow<AssetDeleteParams>(
            params,
            ASSET_DELETE_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender, p);
        const outcome = await deleteAssetIfUnreferenced(organizationId, p.id);
        if (outcome.kind === 'not_found') {
            throw RpcError.Domain('ResourceNotFound');
        }
        if (outcome.kind === 'in_use') {
            throw RpcError.Domain('ResourceConflict', {
                details: {references: outcome.references}
            });
        }
        await deleteAssetFromDisk(outcome.row.file_path);
        return {deleted: true, id: outcome.row.id};
    }

    @Component.Expose('MigrateImages')
    @Component.CheckPermissions(canUseTenantAdmin)
    async migrateImages(
        params: unknown,
        sender: CommandSender
    ): Promise<ImageMigrationResult> {
        validateOrThrow<AssetMigrateImagesParams>(
            params ?? {},
            ASSET_MIGRATE_IMAGES_PARAMS_SCHEMA
        );
        const actor = sender.getUser()?.username ?? 'unknown';
        return runImageMigration(actor);
    }
}
