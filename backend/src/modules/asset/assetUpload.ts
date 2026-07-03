// Upload orchestrator: write file to disk, register or dedup the row.

import RpcError from '../../rpc/RpcError';
import {
    createOrFindAsset,
    rowToDto,
    type VisualAssetDto
} from './assetRepository';
import {
    ALLOWED_MIME,
    type SaveAssetResult,
    saveAssetToLibrary
} from './assetStorage';

export {ALLOWED_MIME};

export interface UploadAssetInput {
    organizationId: string;
    uploadedBy: string;
    contentType: string;
    bytes: Buffer;
    label?: string | null;
    context?: string;
}

export async function uploadAsset(
    input: UploadAssetInput
): Promise<VisualAssetDto> {
    if (!ALLOWED_MIME.has(input.contentType)) {
        throw RpcError.InvalidParams(
            `unsupported content type "${input.contentType}"`
        );
    }
    const saved: SaveAssetResult = await saveAssetToLibrary({
        organizationId: input.organizationId,
        contentType: input.contentType,
        bytes: input.bytes
    });
    const row = await createOrFindAsset({
        organizationId: input.organizationId,
        filePath: saved.filePath,
        sha256: saved.sha256,
        contentType: saved.contentType,
        sizeBytes: saved.sizeBytes,
        label: input.label ?? null,
        uploadedBy: input.uploadedBy,
        context: input.context
    });
    return rowToDto(row);
}
