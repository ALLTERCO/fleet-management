import {sendRPC} from '@/tools/websocket';

const FM = 'FLEET_MANAGER';

// Origin tag — where the asset was first uploaded. Default 'general'.
export type AssetContext =
    | 'device'
    | 'group'
    | 'component'
    | 'general'
    | string;

export interface VisualAsset {
    id: string;
    url: string;
    sha256: string;
    contentType: string;
    sizeBytes: number;
    label: string | null;
    uploadedBy: string | null;
    context: AssetContext;
    created: string;
}

export interface AssetListResult {
    items: VisualAsset[];
    nextCursor: string | null;
}

export interface ListAssetsOptions {
    limit?: number;
    cursor?: string;
    search?: string;
    context?: string;
}

export interface AssetUploadTicket {
    uploadTicket: string;
    resourceKind: 'virtual-device' | 'bluetooth-device' | 'group';
    resourceId: string;
}

export function listAssets(
    opts: ListAssetsOptions = {}
): Promise<AssetListResult> {
    return sendRPC(FM, 'asset.List', opts);
}

export function renameAsset(
    id: string,
    label: string | null
): Promise<VisualAsset> {
    return sendRPC(FM, 'asset.SetLabel', {id, label});
}

export function deleteAsset(id: string): Promise<{deleted: true; id: string}> {
    return sendRPC(FM, 'asset.Delete', {id});
}

// Structured upload error so callers can branch on status (413, 400, 500).
export class AssetUploadError extends Error {
    constructor(
        public status: number,
        public detail: string
    ) {
        super(`asset upload failed (${status}): ${detail}`);
        this.name = 'AssetUploadError';
    }
}

async function parseErrorBody(response: Response): Promise<string> {
    try {
        const raw = await response.text();
        try {
            const json = JSON.parse(raw) as {error?: unknown};
            if (typeof json.error === 'string') return json.error;
        } catch {
            // body wasn't JSON — fall through to raw text
        }
        return raw || response.statusText;
    } catch {
        return response.statusText;
    }
}

// HTTP multipart upload — RPCs can't carry binary efficiently.
export async function uploadAsset(
    file: File,
    label: string | null,
    context?: string,
    ticket?: AssetUploadTicket | null
): Promise<VisualAsset> {
    const form = new FormData();
    form.append('file', file);
    if (label) form.append('label', label);
    if (context) form.append('context', context);
    if (ticket) {
        form.append('ticket', ticket.uploadTicket);
        form.append('resourceKind', ticket.resourceKind);
        form.append('resourceId', ticket.resourceId);
    }
    const response = await fetch('/api/uploads/asset', {
        method: 'POST',
        body: form,
        credentials: 'include'
    });
    if (!response.ok) {
        throw new AssetUploadError(
            response.status,
            await parseErrorBody(response)
        );
    }
    return response.json();
}
