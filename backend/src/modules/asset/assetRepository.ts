// Single source of truth for visual_asset table CRUD.

import {randomUUID} from 'node:crypto';
import RpcError from '../../rpc/RpcError';
import * as postgres from '../PostgresProvider';

export interface VisualAssetRow {
    id: string;
    organization_id: string;
    file_path: string;
    sha256: string;
    content_type: string;
    size_bytes: number;
    label: string | null;
    uploaded_by: string | null;
    context: string;
    created: string;
}

export interface VisualAssetDto {
    id: string;
    url: string;
    sha256: string;
    contentType: string;
    sizeBytes: number;
    label: string | null;
    uploadedBy: string | null;
    context: string;
    created: string;
}

const ASSET_URL_PREFIX = '/api/assets';

export function rowToDto(row: VisualAssetRow): VisualAssetDto {
    return {
        id: row.id,
        url: `${ASSET_URL_PREFIX}/${row.id}`,
        sha256: row.sha256,
        contentType: row.content_type,
        sizeBytes: row.size_bytes,
        label: row.label,
        uploadedBy: row.uploaded_by,
        context: row.context,
        created: row.created
    };
}

export interface CreateAssetInput {
    organizationId: string;
    filePath: string;
    sha256: string;
    contentType: string;
    sizeBytes: number;
    label?: string | null;
    uploadedBy?: string | null;
    context?: string;
}

// Insert-or-return: ON CONFLICT (org, sha256) keeps the first row's
// label / uploaded_by / context so dedup never loses provenance.
export async function createOrFindAsset(
    input: CreateAssetInput
): Promise<VisualAssetRow> {
    const id = randomUUID();
    const rows = await postgres.queryRows<VisualAssetRow>(
        `INSERT INTO device.visual_asset
            (id, organization_id, file_path, sha256, content_type,
             size_bytes, label, uploaded_by, context)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (organization_id, sha256) DO UPDATE
            SET label = COALESCE(device.visual_asset.label, EXCLUDED.label),
                uploaded_by = COALESCE(
                    device.visual_asset.uploaded_by, EXCLUDED.uploaded_by
                )
         RETURNING *`,
        [
            id,
            input.organizationId,
            input.filePath,
            input.sha256,
            input.contentType,
            input.sizeBytes,
            input.label ?? null,
            input.uploadedBy ?? null,
            input.context ?? 'general'
        ]
    );
    return rows[0];
}

export async function getAssetById(
    organizationId: string,
    assetId: string
): Promise<VisualAssetRow | null> {
    const rows = await postgres.queryRows<VisualAssetRow>(
        `SELECT * FROM device.visual_asset
          WHERE id = $1 AND organization_id = $2`,
        [assetId, organizationId]
    );
    return rows[0] ?? null;
}

// Cross-org isolation gate for every resource write that sets
// image_asset_id. The DB FK only checks existence; this also enforces
// "the asset must belong to the same org".
export async function assertAssetBelongsToOrg(
    organizationId: string,
    assetId: string | null | undefined
): Promise<void> {
    if (!assetId) return;
    const row = await getAssetById(organizationId, assetId);
    if (!row) {
        throw RpcError.Domain('ResourceNotFound', {
            details: {resourceType: 'visual_asset', identifier: assetId}
        });
    }
}

export interface ListAssetsInput {
    organizationId: string;
    limit?: number;
    cursor?: string;
    search?: string;
    context?: string;
}

export interface ListAssetsResult {
    items: VisualAssetDto[];
    nextCursor: string | null;
}

const LIST_DEFAULT_LIMIT = 50;
const LIST_MAX_LIMIT = 200;

export async function listAssets(
    input: ListAssetsInput
): Promise<ListAssetsResult> {
    const limit = Math.min(
        LIST_MAX_LIMIT,
        Math.max(1, input.limit ?? LIST_DEFAULT_LIMIT)
    );
    const search = input.search?.trim() ?? '';
    const params: unknown[] = [input.organizationId, limit + 1];
    let where = 'organization_id = $1';
    if (input.cursor) {
        params.push(input.cursor);
        where += ` AND created < $${params.length}::timestamptz`;
    }
    if (search.length > 0) {
        params.push(`%${search}%`);
        where += ` AND label ILIKE $${params.length}`;
    }
    if (input.context) {
        params.push(input.context);
        where += ` AND context = $${params.length}`;
    }
    const rows = await postgres.queryRows<VisualAssetRow>(
        `SELECT * FROM device.visual_asset
          WHERE ${where}
          ORDER BY created DESC
          LIMIT $2`,
        params
    );
    const overflow = rows.length > limit;
    const items = (overflow ? rows.slice(0, limit) : rows).map(rowToDto);
    const nextCursor = overflow ? rows[limit - 1].created : null;
    return {items, nextCursor};
}

export async function setAssetLabel(
    organizationId: string,
    assetId: string,
    label: string | null
): Promise<VisualAssetRow | null> {
    const rows = await postgres.queryRows<VisualAssetRow>(
        `UPDATE device.visual_asset
            SET label = $3
          WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [assetId, organizationId, label]
    );
    return rows[0] ?? null;
}

export interface AssetReferenceCount {
    virtualMetadata: number;
    virtualDevice: number;
    bluDevice: number;
    groups: number;
    physicalDevice: number;
}

// Every holder column stores the asset UUID. Match by UUID only.
export async function countAssetReferences(
    organizationId: string,
    assetId: string
): Promise<AssetReferenceCount> {
    const [vm, vd, blu, groups, list] = await Promise.all([
        postgres.queryRows<{n: string}>(
            `SELECT COUNT(*)::text AS n FROM device.virtual_metadata
              WHERE organization_id = $1 AND image_path = $2`,
            [organizationId, assetId]
        ),
        postgres.queryRows<{n: string}>(
            `SELECT COUNT(*)::text AS n FROM device.virtual_device
              WHERE organization_id = $1 AND image_asset_id = $2`,
            [organizationId, assetId]
        ),
        postgres.queryRows<{n: string}>(
            `SELECT COUNT(*)::text AS n FROM device.blu_device
              WHERE organization_id = $1 AND image_asset_id = $2`,
            [organizationId, assetId]
        ),
        postgres.queryRows<{n: string}>(
            `SELECT COUNT(*)::text AS n FROM organization.groups
              WHERE organization_id = $1 AND image_asset_id = $2`,
            [organizationId, assetId]
        ),
        postgres.queryRows<{n: string}>(
            `SELECT COUNT(*)::text AS n FROM device.list
              WHERE organization_id = $1 AND image_asset_id = $2::uuid`,
            [organizationId, assetId]
        )
    ]);
    return {
        virtualMetadata: Number(vm[0]?.n ?? 0),
        virtualDevice: Number(vd[0]?.n ?? 0),
        bluDevice: Number(blu[0]?.n ?? 0),
        groups: Number(groups[0]?.n ?? 0),
        physicalDevice: Number(list[0]?.n ?? 0)
    };
}

export async function deleteAsset(
    organizationId: string,
    assetId: string
): Promise<VisualAssetRow | null> {
    const rows = await postgres.queryRows<VisualAssetRow>(
        `DELETE FROM device.visual_asset
          WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [assetId, organizationId]
    );
    return rows[0] ?? null;
}

// Atomic ref-check + delete. FOR UPDATE locks the row so a concurrent
// decoration write that binds the asset cannot slip between count + DELETE.
export type DeleteAssetOutcome =
    | {kind: 'deleted'; row: VisualAssetRow}
    | {kind: 'not_found'}
    | {kind: 'in_use'; references: AssetReferenceCount};

export async function deleteAssetIfUnreferenced(
    organizationId: string,
    assetId: string
): Promise<DeleteAssetOutcome> {
    return postgres.withQueryTransaction(async (tx) => {
        const locked = await tx.query<VisualAssetRow>(
            `SELECT * FROM device.visual_asset
              WHERE id = $1 AND organization_id = $2
              FOR UPDATE`,
            [assetId, organizationId]
        );
        if (locked.length === 0) return {kind: 'not_found'} as const;
        const [vm, vd, blu, groups, list] = await Promise.all([
            tx.query<{n: string}>(
                `SELECT COUNT(*)::text AS n FROM device.virtual_metadata
                  WHERE organization_id = $1 AND image_path = $2`,
                [organizationId, assetId]
            ),
            tx.query<{n: string}>(
                `SELECT COUNT(*)::text AS n FROM device.virtual_device
                  WHERE organization_id = $1 AND image_asset_id = $2`,
                [organizationId, assetId]
            ),
            tx.query<{n: string}>(
                `SELECT COUNT(*)::text AS n FROM device.blu_device
                  WHERE organization_id = $1 AND image_asset_id = $2`,
                [organizationId, assetId]
            ),
            tx.query<{n: string}>(
                `SELECT COUNT(*)::text AS n FROM organization.groups
                  WHERE organization_id = $1 AND image_asset_id = $2`,
                [organizationId, assetId]
            ),
            tx.query<{n: string}>(
                `SELECT COUNT(*)::text AS n FROM device.list
                  WHERE organization_id = $1
                    AND image_asset_id = $2::uuid`,
                [organizationId, assetId]
            )
        ]);
        const references: AssetReferenceCount = {
            virtualMetadata: Number(vm[0]?.n ?? 0),
            virtualDevice: Number(vd[0]?.n ?? 0),
            bluDevice: Number(blu[0]?.n ?? 0),
            groups: Number(groups[0]?.n ?? 0),
            physicalDevice: Number(list[0]?.n ?? 0)
        };
        const total =
            references.virtualMetadata +
            references.virtualDevice +
            references.bluDevice +
            references.groups +
            references.physicalDevice;
        if (total > 0) return {kind: 'in_use', references} as const;
        const deleted = await tx.query<VisualAssetRow>(
            `DELETE FROM device.visual_asset
              WHERE id = $1 AND organization_id = $2
             RETURNING *`,
            [assetId, organizationId]
        );
        if (deleted.length === 0) return {kind: 'not_found'} as const;
        return {kind: 'deleted', row: deleted[0]} as const;
    });
}
