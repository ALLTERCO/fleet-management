// Floor plan upload helper: probe image dimensions, strip EXIF, hash bytes,
// save under uploads/floor-plans/<locationId>/<hash>.<ext>. Pure logic
// (no HTTP types) so it's testable in isolation.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {convertPdfToSvg, PDF_CONTENT_TYPE} from './floorPlanPdf';
import {sanitizeSvg} from './svgSanitize';

export const ALLOWED_MIME = new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/svg+xml',
    PDF_CONTENT_TYPE
]);

// PDF is converted before it is written, so it stores as .svg like any other
// vector plan — the extension describes the stored asset, not the upload.
const MIME_EXT: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    [PDF_CONTENT_TYPE]: 'svg'
};

const UPLOAD_ROOT = path.resolve(__dirname, '../../uploads/floor-plans');
const URL_PREFIX = '/uploads/floor-plans';

export interface SavedFloorPlan {
    url: string;
    widthPx: number;
    heightPx: number;
    sha256: string;
    sizeBytes: number;
    /** MIME of the *stored* asset, which is not always what was uploaded —
     *  a PDF is stored as SVG. Callers describe the file on disk. */
    contentType: string;
}

export async function saveFloorPlan(opts: {
    locationId: number;
    contentType: string;
    bytes: Buffer;
}): Promise<SavedFloorPlan> {
    const {locationId, contentType, bytes} = opts;
    const ext = MIME_EXT[contentType];
    if (!ext) {
        throw new Error(`unsupported content type: ${contentType}`);
    }

    // Probe dimensions + strip EXIF for raster; SVG bypasses sharp re-encode
    // (no EXIF in SVG; transcoding to raster would lose vector resolution).
    let finalBytes: Buffer;
    let widthPx: number;
    let heightPx: number;

    // A PDF becomes SVG first and then follows the SVG path exactly — same
    // sanitize, same dimension probe. Converter output is not trusted input:
    // it goes through sanitizeSvg like anything else a user sent us.
    const svgBytes =
        contentType === PDF_CONTENT_TYPE
            ? await convertPdfToSvg(bytes)
            : contentType === 'image/svg+xml'
              ? bytes
              : null;

    if (svgBytes) {
        // Strip XSS payloads before write.
        const clean = sanitizeSvg(svgBytes);
        const meta = await sharp(clean).metadata();
        widthPx = meta.width ?? 0;
        heightPx = meta.height ?? 0;
        finalBytes = clean;
    } else {
        const img = sharp(bytes);
        const meta = await img.metadata();
        widthPx = meta.width ?? 0;
        heightPx = meta.height ?? 0;
        // toBuffer() without withMetadata() drops EXIF/ICC/XMP.
        finalBytes = await img.toBuffer();
    }

    if (widthPx < 1 || heightPx < 1) {
        throw new Error('image has zero or unknown dimensions');
    }

    const sha256 = crypto.createHash('sha256').update(finalBytes).digest('hex');
    const filename = `${sha256}.${ext}`;
    const dir = path.join(UPLOAD_ROOT, String(locationId));
    await fs.mkdir(dir, {recursive: true});
    const fullPath = path.join(dir, filename);
    await fs.writeFile(fullPath, finalBytes);

    return {
        url: `${URL_PREFIX}/${locationId}/${filename}`,
        widthPx,
        heightPx,
        sha256,
        sizeBytes: finalBytes.byteLength,
        contentType: svgBytes ? 'image/svg+xml' : contentType
    };
}

/** Disk path of the directory served at /uploads/floor-plans. */
export function floorPlanUploadRoot(): string {
    return UPLOAD_ROOT;
}
