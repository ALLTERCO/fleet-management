// Filesystem layout for the asset library: one file per (org, sha256).

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {sanitizeSvg} from '../svgSanitize';
import {visualAssetUploadRoot} from '../virtualImageUpload';

export const ALLOWED_MIME = new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/svg+xml'
]);

const MIME_EXT: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/svg+xml': 'svg'
};

const MAX_RASTER_DIM = 512;
const LIBRARY_SUBDIR = 'library';
const ASSET_URL_PREFIX = '/uploads/visual-assets';

function safeSegment(s: string): string {
    return s.replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function processBytes(
    contentType: string,
    bytes: Buffer
): Promise<{finalBytes: Buffer; ext: string}> {
    const ext = MIME_EXT[contentType];
    if (!ext) throw new Error(`unsupported content type: ${contentType}`);
    const isSvg = contentType === 'image/svg+xml';
    const finalBytes = isSvg
        ? sanitizeSvg(bytes)
        : await sharp(bytes)
              .rotate()
              .resize({
                  width: MAX_RASTER_DIM,
                  height: MAX_RASTER_DIM,
                  fit: 'inside',
                  withoutEnlargement: true
              })
              .toBuffer();
    return {finalBytes, ext};
}

export interface SaveAssetInput {
    organizationId: string;
    contentType: string;
    bytes: Buffer;
}

export interface SaveAssetResult {
    filePath: string;
    sha256: string;
    sizeBytes: number;
    contentType: string;
}

export async function saveAssetToLibrary(
    input: SaveAssetInput
): Promise<SaveAssetResult> {
    const {finalBytes, ext} = await processBytes(
        input.contentType,
        input.bytes
    );
    const sha256 = crypto.createHash('sha256').update(finalBytes).digest('hex');
    const filename = `${sha256}.${ext}`;
    const orgSeg = safeSegment(input.organizationId);
    const dir = path.join(visualAssetUploadRoot(), orgSeg, LIBRARY_SUBDIR);
    await fs.mkdir(dir, {recursive: true});
    await fs.writeFile(path.join(dir, filename), finalBytes);
    return {
        filePath: `${ASSET_URL_PREFIX}/${orgSeg}/${LIBRARY_SUBDIR}/${filename}`,
        sha256,
        sizeBytes: finalBytes.byteLength,
        contentType: input.contentType
    };
}

// Asset files live under /uploads/visual-assets/{org}/library/ only.
export function resolveAssetDiskPath(filePath: string): string | null {
    const prefix = `${ASSET_URL_PREFIX}/`;
    if (!filePath.startsWith(prefix)) return null;
    const relative = filePath.slice(prefix.length);
    const absolute = path.resolve(visualAssetUploadRoot(), relative);
    const root = path.resolve(visualAssetUploadRoot());
    if (absolute === root || !absolute.startsWith(`${root}${path.sep}`)) {
        return null;
    }
    return absolute;
}

export async function deleteAssetFromDisk(filePath: string): Promise<void> {
    const disk = resolveAssetDiskPath(filePath);
    if (!disk) return;
    await fs.unlink(disk).catch(() => {
        // Already gone — treat as success since the SoT is the DB row.
    });
}

export function assetUrlFor(assetId: string): string {
    return `/api/assets/${assetId}`;
}
