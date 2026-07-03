// One-shot: convert existing image-path columns into asset library UUIDs.
// Idempotent — rows already holding UUIDs are skipped.

import fs from 'node:fs/promises';
import path from 'node:path';
import log4js from 'log4js';
import * as postgres from '../PostgresProvider';
import {visualAssetUploadRoot} from '../virtualImageUpload';
import {createOrFindAsset} from './assetRepository';
import {saveAssetToLibrary} from './assetStorage';

const logger = log4js.getLogger('image-migration');

const UUID_RE =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml'
};

// Pre-feature files lived at either prefix; this migration is the only
// site that reads from them — runtime serves library files only.
const SOURCE_URL_PREFIXES = [
    '/uploads/visual-assets/',
    '/uploads/virtual-images/'
];

interface LegacyRow {
    organization_id: string;
    value: string;
    pk_a: string;
    pk_b?: string;
}

interface TableSpec {
    name: string;
    // Origin tag applied to assets registered from this table.
    context: string;
    selectSql: string;
    updateSql: (
        uuid: string,
        row: LegacyRow
    ) => {sql: string; params: unknown[]};
}

const TABLES: TableSpec[] = [
    {
        name: 'virtual_metadata',
        context: 'component',
        selectSql: `SELECT organization_id, host_shelly_id AS pk_a,
                           component_key AS pk_b, image_path AS value
                      FROM device.virtual_metadata
                     WHERE image_path IS NOT NULL`,
        updateSql: (uuid, row) => ({
            sql: `UPDATE device.virtual_metadata
                     SET image_path = $4
                   WHERE organization_id = $1
                     AND host_shelly_id = $2
                     AND component_key = $3`,
            params: [row.organization_id, row.pk_a, row.pk_b, uuid]
        })
    },
    {
        name: 'virtual_device',
        context: 'device',
        selectSql: `SELECT organization_id, external_id AS pk_a,
                           image_asset_id AS value
                      FROM device.virtual_device
                     WHERE image_asset_id IS NOT NULL`,
        updateSql: (uuid, row) => ({
            sql: `UPDATE device.virtual_device
                     SET image_asset_id = $3
                   WHERE organization_id = $1 AND external_id = $2`,
            params: [row.organization_id, row.pk_a, uuid]
        })
    },
    {
        name: 'blu_device',
        context: 'device',
        selectSql: `SELECT organization_id, external_id AS pk_a,
                           image_asset_id AS value
                      FROM device.blu_device
                     WHERE image_asset_id IS NOT NULL`,
        updateSql: (uuid, row) => ({
            sql: `UPDATE device.blu_device
                     SET image_asset_id = $3
                   WHERE organization_id = $1 AND external_id = $2`,
            params: [row.organization_id, row.pk_a, uuid]
        })
    },
    {
        name: 'groups',
        context: 'group',
        selectSql: `SELECT organization_id, id::text AS pk_a,
                           image_asset_id AS value
                      FROM organization.groups
                     WHERE image_asset_id IS NOT NULL`,
        updateSql: (uuid, row) => ({
            sql: `UPDATE organization.groups
                     SET image_asset_id = $3
                   WHERE organization_id = $1 AND id = $2::integer`,
            params: [row.organization_id, row.pk_a, uuid]
        })
    }
];

export interface ImageMigrationTableResult {
    table: string;
    scanned: number;
    alreadyUuid: number;
    migrated: number;
    fileMissing: number;
    failed: number;
}

export interface ImageMigrationResult {
    actor: string;
    startedAt: string;
    finishedAt: string;
    tables: ImageMigrationTableResult[];
}

// Source files live under /uploads/{visual-assets|virtual-images}/...
// Returns null on traversal or non-source paths.
function resolveSourceDiskPath(filePath: string): string | null {
    if (!SOURCE_URL_PREFIXES.some((p) => filePath.startsWith(p))) return null;
    const root = path.resolve(visualAssetUploadRoot(), '..');
    const absolute = path.resolve(root, filePath.slice('/uploads/'.length));
    if (absolute === root || !absolute.startsWith(`${root}${path.sep}`)) {
        return null;
    }
    return absolute;
}

function inferContentType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    return CONTENT_TYPE_BY_EXT[ext] ?? 'application/octet-stream';
}

type Bucket = keyof Omit<ImageMigrationTableResult, 'table' | 'scanned'>;

interface MigrationOutcome {
    bucket: Bucket;
    uuid?: string;
}

// (org, url) cached so multi-row references to the same legacy file resolve
// from cache after the first migration unlinks the file.
async function ensureAssetFor(
    organizationId: string,
    legacyUrl: string,
    context: string,
    actor: string,
    cache: Map<string, string>
): Promise<MigrationOutcome> {
    const cacheKey = `${organizationId}::${legacyUrl}`;
    const cached = cache.get(cacheKey);
    if (cached) return {bucket: 'migrated', uuid: cached};
    const sourcePath = resolveSourceDiskPath(legacyUrl);
    if (!sourcePath) return {bucket: 'failed'};
    let bytes: Buffer;
    try {
        bytes = await fs.readFile(sourcePath);
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return {bucket: 'fileMissing'};
        logger.warn('source file read failed path=%s err=%s', sourcePath, err);
        return {bucket: 'failed'};
    }
    const saved = await saveAssetToLibrary({
        organizationId,
        contentType: inferContentType(legacyUrl),
        bytes
    });
    const asset = await createOrFindAsset({
        organizationId,
        filePath: saved.filePath,
        sha256: saved.sha256,
        contentType: saved.contentType,
        sizeBytes: saved.sizeBytes,
        label: null,
        uploadedBy: `migration:${actor}`,
        context
    });
    cache.set(cacheKey, asset.id);
    await fs.unlink(sourcePath).catch(() => {
        // File SoT is now the library entry.
    });
    return {bucket: 'migrated', uuid: asset.id};
}

async function migrateTable(
    spec: TableSpec,
    actor: string,
    cache: Map<string, string>
): Promise<ImageMigrationTableResult> {
    const result: ImageMigrationTableResult = {
        table: spec.name,
        scanned: 0,
        alreadyUuid: 0,
        migrated: 0,
        fileMissing: 0,
        failed: 0
    };
    const rows = await postgres.queryRows<LegacyRow>(spec.selectSql);
    for (const row of rows) {
        result.scanned++;
        if (UUID_RE.test(row.value)) {
            result.alreadyUuid++;
            continue;
        }
        try {
            const outcome = await ensureAssetFor(
                row.organization_id,
                row.value,
                spec.context,
                actor,
                cache
            );
            if (outcome.bucket !== 'migrated' || !outcome.uuid) {
                result[outcome.bucket]++;
                continue;
            }
            const {sql, params} = spec.updateSql(outcome.uuid, row);
            await postgres.queryRows(sql, params);
            result.migrated++;
        } catch (err) {
            logger.warn(
                'migration row failed table=%s org=%s value=%s err=%s',
                spec.name,
                row.organization_id,
                row.value,
                err
            );
            result.failed++;
        }
    }
    return result;
}

export async function runImageMigration(
    actor: string
): Promise<ImageMigrationResult> {
    const startedAt = new Date().toISOString();
    // Shared across tables so one read+unlink covers all references.
    const cache = new Map<string, string>();
    const tables: ImageMigrationTableResult[] = [];
    for (const spec of TABLES) {
        tables.push(await migrateTable(spec, actor, cache));
    }
    return {
        actor,
        startedAt,
        finishedAt: new Date().toISOString(),
        tables
    };
}
