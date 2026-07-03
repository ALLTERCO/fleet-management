// Single upload pipeline: every resource's "upload an image" routes
// through the asset library. Returns the asset UUID — resolveAssetSrc
// turns it into /api/assets/{id} at render time.

import {type AssetUploadTicket, uploadAsset} from '@/api/assetRpc';
import {rpcErrorMessage} from '@/helpers/rpcError';

export interface UploadVisualAssetInput {
    file: File;
    label?: string | null;
    context?: string;
    ticket?: AssetUploadTicket | null;
    onError: (message: string) => void;
}

export async function uploadVisualAsset(
    input: UploadVisualAssetInput
): Promise<string | null> {
    try {
        const asset = await uploadAsset(
            input.file,
            input.label ?? null,
            input.context,
            input.ticket
        );
        return asset.id;
    } catch (err) {
        input.onError(rpcErrorMessage(err, 'Image upload failed'));
        return null;
    }
}
