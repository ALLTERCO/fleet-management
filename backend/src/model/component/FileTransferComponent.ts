import {
    canCrossOrganizationBoundary,
    canPerformComponentOperation,
    canPerformComponentOperationAsync,
    canUseAuthenticatedRead,
    canUseAuthenticatedWrite,
    isComponentPermissionAllowed
} from '../../modules/authz/evaluator';
import {
    beginFileTransfer,
    cancelFileTransfer,
    finalizeFileTransfer,
    getFileTransfer,
    getOwnedFileTransfer,
    readFileTransferChunk,
    writeFileTransferChunk
} from '../../modules/uploads/fileTransfer';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import type {DescribeOutput} from '../../types/api/_describe';
import {
    FILE_TRANSFER_BEGIN_PARAMS_SCHEMA,
    FILE_TRANSFER_DESCRIBE,
    FILE_TRANSFER_READ_CHUNK_PARAMS_SCHEMA,
    FILE_TRANSFER_UPLOAD_PARAMS_SCHEMA,
    FILE_TRANSFER_WRITE_CHUNK_PARAMS_SCHEMA,
    type FileTransferBeginParams,
    type FileTransferReadChunkParams,
    type FileTransferUploadParams,
    type FileTransferWriteChunkParams
} from '../../types/api/fileTransfer';
import type CommandSender from '../CommandSender';
import {
    canManageSharedMediaAssets,
    canViewAuditLog,
    canViewSharedMediaAssets
} from './authzPermissions';
import Component from './Component';

interface Config {
    viewer_visible: boolean;
}

function componentPermission(
    sender: CommandSender,
    component: 'devices' | 'groups' | 'locations' | 'notifications',
    operation: 'create' | 'read' | 'update',
    itemId?: string | number
): boolean {
    return isComponentPermissionAllowed(
        canPerformComponentOperation(sender, component, operation, itemId)
    );
}

async function canBeginTransfer(
    sender: CommandSender,
    rawParams: unknown
): Promise<boolean> {
    const params = validateOrThrow<FileTransferBeginParams>(
        rawParams,
        FILE_TRANSFER_BEGIN_PARAMS_SCHEMA
    );
    if (!canUseAuthenticatedWrite(sender)) return false;
    switch (params.kind) {
        case 'backup_import':
            return componentPermission(sender, 'devices', 'update');
        case 'firmware':
            return canCrossOrganizationBoundary(sender);
        case 'background':
        case 'report_image':
            return canManageSharedMediaAssets(sender);
        case 'profile_picture':
            return Boolean(
                params.target?.username &&
                    (params.target.username === sender.getUser()?.username ||
                        canCrossOrganizationBoundary(sender))
            );
        case 'email_asset':
            return (
                componentPermission(sender, 'notifications', 'create') ||
                componentPermission(sender, 'notifications', 'update')
            );
        case 'floor_plan':
            return Boolean(
                params.target?.locationId &&
                    isComponentPermissionAllowed(
                        await canPerformComponentOperationAsync(
                            sender,
                            'locations',
                            'update',
                            params.target.locationId
                        )
                    )
            );
        case 'visual_asset': {
            const resourceId = params.target?.resourceId;
            const resourceKind = params.target?.resourceKind;
            if (!resourceId || !resourceKind) return false;
            const component = resourceKind === 'group' ? 'groups' : 'devices';
            const itemId =
                resourceKind === 'group' && /^\d+$/.test(resourceId)
                    ? Number.parseInt(resourceId, 10)
                    : resourceId;
            return isComponentPermissionAllowed(
                await canPerformComponentOperationAsync(
                    sender,
                    component,
                    'update',
                    itemId
                )
            );
        }
    }
}

async function canReadTransfer(
    sender: CommandSender,
    rawParams: unknown
): Promise<boolean> {
    const params = validateOrThrow<FileTransferReadChunkParams>(
        rawParams,
        FILE_TRANSFER_READ_CHUNK_PARAMS_SCHEMA
    );
    if (!canUseAuthenticatedRead(sender)) return false;
    switch (params.kind) {
        case 'backup':
        case 'visual_asset':
            return componentPermission(sender, 'devices', 'read');
        case 'firmware_library':
        case 'firmware_temporary':
            return componentPermission(sender, 'devices', 'update');
        case 'report_export':
            return true;
        case 'audit_export':
            return canViewAuditLog(sender);
        case 'email_asset':
            return componentPermission(sender, 'notifications', 'read');
        case 'background':
        case 'report_image':
            return canViewSharedMediaAssets(sender);
        case 'profile_picture':
            return (
                params.artifactId === sender.getUser()?.username ||
                canCrossOrganizationBoundary(sender)
            );
        case 'floor_plan': {
            const match = /^([1-9]\d*):/.exec(params.artifactId);
            return Boolean(
                match &&
                    isComponentPermissionAllowed(
                        await canPerformComponentOperationAsync(
                            sender,
                            'locations',
                            'read',
                            Number.parseInt(match[1], 10)
                        )
                    )
            );
        }
    }
}

async function canFinalizeTransfer(
    sender: CommandSender,
    rawParams: unknown
): Promise<boolean> {
    const params = validateOrThrow<FileTransferUploadParams>(
        rawParams,
        FILE_TRANSFER_UPLOAD_PARAMS_SCHEMA
    );
    const session = await getOwnedFileTransfer(params, sender);
    return canBeginTransfer(sender, {
        kind: session.kind,
        fileName: session.fileName,
        sizeBytes: session.sizeBytes,
        sha256: session.expectedSha256,
        contentType: session.contentType,
        target: session.target,
        options: session.options
    });
}

export default class FileTransferComponent extends Component<Config> {
    constructor() {
        super('fileTransfer', {viewer_visible: false});
    }

    protected override getDefaultConfig(): Config {
        return {viewer_visible: false};
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return FILE_TRANSFER_DESCRIBE;
    }

    @Component.Expose('Begin')
    @Component.CheckPermissions(canBeginTransfer)
    async begin(params: unknown, sender: CommandSender) {
        return beginFileTransfer(
            validateOrThrow<FileTransferBeginParams>(
                params,
                FILE_TRANSFER_BEGIN_PARAMS_SCHEMA
            ),
            sender
        );
    }

    @Component.Expose('WriteChunk')
    @Component.CheckPermissions(canUseAuthenticatedWrite)
    async writeChunk(params: unknown, sender: CommandSender) {
        return writeFileTransferChunk(
            validateOrThrow<FileTransferWriteChunkParams>(
                params,
                FILE_TRANSFER_WRITE_CHUNK_PARAMS_SCHEMA
            ),
            sender
        );
    }

    @Component.NoAudit
    @Component.Expose('Get')
    @Component.CheckPermissions(canUseAuthenticatedRead)
    async get(params: unknown, sender: CommandSender) {
        return getFileTransfer(
            validateOrThrow<FileTransferUploadParams>(
                params,
                FILE_TRANSFER_UPLOAD_PARAMS_SCHEMA
            ),
            sender
        );
    }

    @Component.Expose('Finalize')
    @Component.CheckPermissions(canFinalizeTransfer)
    async finalize(params: unknown, sender: CommandSender) {
        return finalizeFileTransfer(
            validateOrThrow<FileTransferUploadParams>(
                params,
                FILE_TRANSFER_UPLOAD_PARAMS_SCHEMA
            ),
            sender
        );
    }

    @Component.Expose('Cancel')
    @Component.CheckPermissions(canUseAuthenticatedWrite)
    async cancel(params: unknown, sender: CommandSender) {
        return cancelFileTransfer(
            validateOrThrow<FileTransferUploadParams>(
                params,
                FILE_TRANSFER_UPLOAD_PARAMS_SCHEMA
            ),
            sender
        );
    }

    @Component.NoAudit
    @Component.Expose('ReadChunk')
    @Component.CheckPermissions(canReadTransfer)
    async readChunk(params: unknown, sender: CommandSender) {
        return readFileTransferChunk(
            validateOrThrow<FileTransferReadChunkParams>(
                params,
                FILE_TRANSFER_READ_CHUNK_PARAMS_SCHEMA
            ),
            sender
        );
    }
}
