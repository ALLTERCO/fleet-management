import * as fsAsync from 'node:fs/promises';
import * as path from 'node:path';
import log4js from 'log4js';
import {bestEffort} from './util/fireAndForget';
import {backgroundsPath, reportImagesPath} from './web/utils/uploadPaths';

const logger = log4js.getLogger('media-assets');

export interface MediaImageList {
    thumbnails: string[];
    displays: string[];
    originals: string[];
}

export interface MediaAssetUser {
    organizationId?: string;
    tenantPinned?: boolean;
    group?: string;
    roles?: readonly string[];
    isPlatformAdmin?: boolean;
}

export class MediaAssetValidationError extends Error {}
export class MediaAssetPermissionError extends Error {}
export class MediaAssetNotFoundError extends Error {}

export const ALLOWED_REPORT_IMAGE_EXT = new Set([
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp'
]);

export const ALLOWED_BACKGROUND_IMAGE_EXT = new Set([
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp'
]);

export function backgroundThumbName(originalName: string): string {
    const parsed = path.parse(originalName);
    return `${parsed.name}_thumb.png`;
}

export function backgroundDisplayName(originalName: string): string {
    const parsed = path.parse(originalName);
    return `${parsed.name}_display.png`;
}

export function backgroundThumbNames(originalName: string): string[] {
    const parsed = path.parse(originalName);
    return Array.from(
        new Set([
            backgroundThumbName(originalName),
            `${parsed.name}_thumb${parsed.ext}`
        ])
    );
}

export function safeBackgroundName(originalName: string): string | null {
    const parsed = path.parse(path.basename(originalName));
    const ext = parsed.ext.toLowerCase();
    if (!ALLOWED_BACKGROUND_IMAGE_EXT.has(ext)) return null;

    const base = parsed.name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'background';
    return `${base}${ext}`;
}

export function safeOrgSegment(
    orgId: string | undefined | null
): string | null {
    if (!orgId) return null;
    const sanitized = orgId.replace(/[^a-zA-Z0-9._-]/g, '_');
    return sanitized.length > 0 ? sanitized : null;
}

export function userIsPlatformAdmin(user?: MediaAssetUser | null): boolean {
    return user?.isPlatformAdmin === true;
}

export function userCanCrossOrganizations(
    user?: MediaAssetUser | null
): boolean {
    return userIsPlatformAdmin(user) && user?.tenantPinned !== true;
}

export async function listBackgrounds(
    user?: MediaAssetUser | null
): Promise<MediaImageList> {
    const visibleDirs: Array<{rel: string; abs: string}> = [
        {rel: '', abs: backgroundsPath}
    ];
    const orgSeg = safeOrgSegment(user?.organizationId);
    if (userCanCrossOrganizations(user)) {
        const entries = await fsAsync
            .readdir(backgroundsPath, {withFileTypes: true})
            .catch(() => []);
        for (const e of entries) {
            if (e.isDirectory()) {
                visibleDirs.push({
                    rel: e.name,
                    abs: path.join(backgroundsPath, e.name)
                });
            }
        }
    } else if (orgSeg) {
        visibleDirs.push({
            rel: orgSeg,
            abs: path.join(backgroundsPath, orgSeg)
        });
    }

    const thumbnails: string[] = [];
    const displays: string[] = [];
    const originals: string[] = [];
    for (const {rel, abs} of visibleDirs) {
        const files = await fsAsync.readdir(abs).catch(() => []);
        for (const f of files) {
            const full = rel ? `${rel}/${f}` : f;
            if (f.includes('_thumb')) thumbnails.push(full);
            else if (f.includes('_display')) displays.push(full);
            else originals.push(full);
        }
    }
    return {thumbnails, displays, originals};
}

export async function deleteBackground(
    user: MediaAssetUser | undefined | null,
    fileName: unknown
): Promise<{success: true}> {
    if (!fileName || typeof fileName !== 'string') {
        throw new MediaAssetValidationError('Missing fileName');
    }
    const parts = fileName.split('/').filter(Boolean);
    let dirSeg = '';
    let baseName = fileName;
    if (parts.length === 2) {
        dirSeg = path.basename(parts[0]);
        baseName = path.basename(parts[1]);
    } else if (parts.length === 1) {
        baseName = path.basename(parts[0]);
    } else {
        throw new MediaAssetValidationError('Invalid fileName');
    }

    const isSuper = userCanCrossOrganizations(user);
    if (dirSeg && !isSuper) {
        const orgSeg = safeOrgSegment(user?.organizationId);
        if (dirSeg !== orgSeg) {
            throw new MediaAssetPermissionError(
                'Cannot delete another tenants background'
            );
        }
    } else if (!dirSeg && !isSuper) {
        throw new MediaAssetPermissionError(
            'Shared backgrounds are provider-support-only'
        );
    }

    const targetDir = dirSeg
        ? path.join(backgroundsPath, dirSeg)
        : backgroundsPath;
    const originalPath = path.join(targetDir, baseName);
    const thumbPaths = backgroundThumbNames(baseName).map((name) =>
        path.join(targetDir, name)
    );
    const displayPath = path.join(targetDir, backgroundDisplayName(baseName));

    try {
        await fsAsync.stat(originalPath);
    } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
            throw new MediaAssetNotFoundError('Background image not found');
        }
        throw err;
    }
    await fsAsync.unlink(originalPath);
    for (const thumbPath of thumbPaths) {
        await bestEffort('unlink.media-thumb', fsAsync.unlink(thumbPath));
    }
    await bestEffort('unlink.media-display', fsAsync.unlink(displayPath));
    logger.info('background deleted file=%s', fileName);
    return {success: true};
}

// Root files predate per-tenant folders and have no owner, so only
// provider support sees them.
function reportImageDirs(
    user?: MediaAssetUser | null
): Array<{rel: string; abs: string}> {
    if (userCanCrossOrganizations(user)) {
        return [{rel: '', abs: reportImagesPath}];
    }
    const orgSeg = safeOrgSegment(user?.organizationId);
    if (!orgSeg) return [];
    return [{rel: orgSeg, abs: path.join(reportImagesPath, orgSeg)}];
}

export async function listReportImages(
    user?: MediaAssetUser | null
): Promise<MediaImageList> {
    const thumbnails: string[] = [];
    const originals: string[] = [];
    for (const {rel, abs} of reportImageDirs(user)) {
        const entries = await fsAsync
            .readdir(abs, {withFileTypes: true})
            .catch(() => []);
        for (const entry of entries) {
            if (!entry.isFile()) continue;
            const full = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.name.includes('_thumb')) thumbnails.push(full);
            else if (!entry.name.includes('_display')) originals.push(full);
        }
    }
    return {thumbnails, displays: [], originals};
}

async function listLegacyReportImages(): Promise<string[]> {
    const entries = await fsAsync
        .readdir(reportImagesPath, {withFileTypes: true})
        .catch(() => []);
    return entries
        .filter(
            (entry) =>
                entry.isFile() &&
                ALLOWED_REPORT_IMAGE_EXT.has(
                    path.extname(entry.name).toLowerCase()
                )
        )
        .map((entry) => entry.name);
}

async function moveReportImageToTenant(
    fileName: string,
    orgSegment: string
): Promise<string> {
    const targetDir = path.join(reportImagesPath, orgSegment);
    await fsAsync.mkdir(targetDir, {recursive: true});
    await fsAsync.rename(
        path.join(reportImagesPath, fileName),
        path.join(targetDir, fileName)
    );
    return `${orgSegment}/${fileName}`;
}

// A dedicated install has exactly one tenant, so files from before per-tenant
// folders belong to it. Safe to run at every boot: a second run finds nothing.
export async function adoptLegacyReportImages(
    organizationId: string
): Promise<string[]> {
    const orgSegment = safeOrgSegment(organizationId);
    if (!orgSegment) {
        throw new MediaAssetValidationError('organization id is invalid');
    }
    const moved: string[] = [];
    for (const fileName of await listLegacyReportImages()) {
        await moveReportImageToTenant(fileName, orgSegment);
        moved.push(fileName);
        logger.info(
            'report image adopted file=%s tenant=%s',
            fileName,
            orgSegment
        );
    }
    return moved;
}

// Provider support gives an unowned root file to a tenant, by hand.
export async function assignReportImage(
    user: MediaAssetUser | undefined | null,
    fileName: unknown,
    organizationId: string
): Promise<{success: true; path: string}> {
    if (!userCanCrossOrganizations(user)) {
        throw new MediaAssetPermissionError(
            'Assigning report images is provider-support-only'
        );
    }
    if (
        typeof fileName !== 'string' ||
        fileName !== path.basename(fileName) ||
        !ALLOWED_REPORT_IMAGE_EXT.has(path.extname(fileName).toLowerCase())
    ) {
        throw new MediaAssetValidationError('Invalid fileName');
    }
    const orgSegment = safeOrgSegment(organizationId);
    if (!orgSegment) {
        throw new MediaAssetValidationError('organization id is invalid');
    }
    const legacy = await listLegacyReportImages();
    if (!legacy.includes(fileName)) {
        throw new MediaAssetNotFoundError('Report image not found');
    }
    const moved = await moveReportImageToTenant(fileName, orgSegment);
    // The thumbnail the upload wrote next to it goes along.
    const ext = path.extname(fileName);
    const thumb = `${fileName.slice(0, -ext.length)}_thumb${ext}`;
    if (legacy.includes(thumb))
        await moveReportImageToTenant(thumb, orgSegment);
    logger.info(
        'report image assigned file=%s tenant=%s',
        fileName,
        orgSegment
    );
    return {success: true, path: moved};
}
