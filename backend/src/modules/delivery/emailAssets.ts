// Data access + env-backed limits for binary email attachments stored
// in notifications.email_assets. Lives here (not in a component) so the
// HTTP upload route and the SMTP adapter both consume the same wrapper.

import {envCsv, envInt} from '../../config/envReader';
import * as PostgresProvider from '../PostgresProvider';

export const ORG_QUOTA_BYTES = envInt(
    'FM_EMAIL_ASSETS_ORG_QUOTA_BYTES',
    50 * 1024 * 1024,
    1024
);

const DEFAULT_CONTENT_TYPES = [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/svg+xml',
    'image/webp'
] as const;

export const ALLOWED_CONTENT_TYPES = envCsv(
    'FM_EMAIL_ASSETS_CONTENT_TYPES',
    DEFAULT_CONTENT_TYPES
);

export function isAllowedContentType(mime: string): boolean {
    return ALLOWED_CONTENT_TYPES.includes(mime.toLowerCase());
}

export interface EmailAssetMetadata {
    id: number;
    filename: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
    createdAt: string;
}

export interface InsertResult extends EmailAssetMetadata {
    deduped: boolean;
}

interface InsertRow {
    id: number;
    deduped: boolean;
    filename: string;
    content_type: string;
    size_bytes: number;
    sha256: string;
    created_at: Date | string;
}

interface ListRow extends Omit<InsertRow, 'deduped'> {
    total: string | number;
}

interface MetadataRow extends Omit<InsertRow, 'deduped'> {}

interface BytesRow {
    filename: string;
    content_type: string;
    bytes: Buffer;
}

function toIso(v: Date | string): string {
    return typeof v === 'string' ? v : v.toISOString();
}

function rowToMetadata(
    row: MetadataRow | Omit<ListRow, 'total'>
): EmailAssetMetadata {
    return {
        id: row.id,
        filename: row.filename,
        contentType: row.content_type,
        sizeBytes: row.size_bytes,
        sha256: row.sha256,
        createdAt: toIso(row.created_at)
    };
}

export async function insertAsset(params: {
    organizationId: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
    bytes: Buffer;
}): Promise<InsertResult> {
    const res = await PostgresProvider.callMethod(
        'notifications.fn_email_asset_insert',
        {
            p_organization_id: params.organizationId,
            p_filename: params.filename,
            p_content_type: params.contentType,
            p_size_bytes: params.sizeBytes,
            p_sha256: params.sha256,
            p_bytes: params.bytes,
            p_org_quota_bytes: ORG_QUOTA_BYTES
        }
    );
    const row = res?.rows?.[0] as InsertRow | undefined;
    if (!row) throw new Error('fn_email_asset_insert returned no row');
    return {...rowToMetadata(row), deduped: row.deduped};
}

export async function listAssets(
    organizationId: string,
    limit = 200,
    offset = 0
): Promise<{items: EmailAssetMetadata[]; total: number}> {
    const res = await PostgresProvider.callMethod(
        'notifications.fn_email_asset_list',
        {p_organization_id: organizationId, p_limit: limit, p_offset: offset}
    );
    const rows = (res?.rows ?? []) as ListRow[];
    const total = Number(rows[0]?.total ?? 0);
    return {items: rows.map(rowToMetadata), total};
}

export async function getAssetMetadata(
    organizationId: string,
    id: number
): Promise<EmailAssetMetadata | undefined> {
    const res = await PostgresProvider.callMethod(
        'notifications.fn_email_asset_get_metadata',
        {p_organization_id: organizationId, p_id: id}
    );
    const row = res?.rows?.[0] as MetadataRow | undefined;
    return row ? rowToMetadata(row) : undefined;
}

export async function getAssetBytes(
    organizationId: string,
    id: number
): Promise<{filename: string; contentType: string; bytes: Buffer} | undefined> {
    const res = await PostgresProvider.callMethod(
        'notifications.fn_email_asset_get_bytes',
        {p_organization_id: organizationId, p_id: id}
    );
    const row = res?.rows?.[0] as BytesRow | undefined;
    if (!row) return undefined;
    return {
        filename: row.filename,
        contentType: row.content_type,
        bytes: row.bytes
    };
}

export async function deleteAsset(
    organizationId: string,
    id: number
): Promise<boolean> {
    const res = await PostgresProvider.callMethod(
        'notifications.fn_email_asset_delete',
        {p_organization_id: organizationId, p_id: id}
    );
    const count = Number(res?.rows?.[0]?.fn_email_asset_delete ?? 0);
    return count > 0;
}
