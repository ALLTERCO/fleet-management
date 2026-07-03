import * as path from 'node:path';
import type express from 'express';
import {
    ALLOWED_BACKGROUND_IMAGE_EXT,
    ALLOWED_REPORT_IMAGE_EXT,
    safeOrgSegment,
    userCanCrossOrganizations
} from '../../mediaAssetLibrary';
import {
    backgroundsPath,
    profilePicturesPath,
    reportImagesPath
} from './uploadPaths';

export type UploadAssetKind = 'background' | 'profilePic' | 'reportImage';

export interface ResolvedUploadAsset {
    root: string;
    file: string;
    fallbackFile?: string;
}

function splitAssetPath(raw: string): string[] | null {
    const parts = raw.split('/').filter(Boolean);
    if (parts.length === 0 || parts.length > 2) return null;
    for (const part of parts) {
        if (
            part !== path.basename(part) ||
            part === '.' ||
            part === '..' ||
            !/^[a-zA-Z0-9@._-]+$/.test(part)
        ) {
            return null;
        }
    }
    return parts;
}

function extensionAllowed(file: string, allowed: ReadonlySet<string>): boolean {
    return allowed.has(path.extname(file).toLowerCase());
}

// signedPath = true when a verified upload-asset token has already
// authorised this exact (kind, path); the resolver then only enforces
// shape (basename safety, extension whitelist) — NOT user-scoping, since
// the signature is the authorisation.
export function resolveUploadAsset(
    kind: UploadAssetKind,
    rawPath: string,
    user: express.Request['user'],
    signedPath = false
): ResolvedUploadAsset | null {
    const parts = splitAssetPath(rawPath);
    if (!parts) return null;

    if (kind === 'background') {
        const file = parts.at(-1)!;
        if (!extensionAllowed(file, ALLOWED_BACKGROUND_IMAGE_EXT)) return null;
        if (parts.length === 1) {
            return {root: backgroundsPath, file};
        }
        if (!signedPath) {
            const orgSeg = safeOrgSegment(user?.organizationId);
            if (!userCanCrossOrganizations(user) && parts[0] !== orgSeg) {
                return null;
            }
        }
        return {root: backgroundsPath, file: path.join(parts[0], file)};
    }

    if (kind === 'profilePic') {
        const file = parts[0];
        if (parts.length !== 1 || path.extname(file).toLowerCase() !== '.png') {
            return null;
        }
        return {
            root: profilePicturesPath,
            file,
            fallbackFile: 'default.png'
        };
    }

    const file = parts[0];
    if (
        parts.length !== 1 ||
        !extensionAllowed(file, ALLOWED_REPORT_IMAGE_EXT)
    ) {
        return null;
    }
    return {root: reportImagesPath, file};
}
