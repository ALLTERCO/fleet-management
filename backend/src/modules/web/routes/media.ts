import * as fs from 'node:fs';
import * as fsAsync from 'node:fs/promises';
import * as path from 'node:path';
import express from 'express';
import log4js from 'log4js';
import multer from 'multer';
import sharp from 'sharp';
import {tuning} from '../../../config';
import {
    ALLOWED_REPORT_IMAGE_EXT,
    backgroundDisplayName,
    backgroundThumbName,
    deleteBackground,
    listBackgrounds,
    listReportImages,
    MediaAssetNotFoundError,
    MediaAssetPermissionError,
    MediaAssetValidationError,
    safeBackgroundName,
    safeOrgSegment
} from '../../mediaAssetLibrary';
import {consumeUploadTicket} from '../../uploadTickets';
import {httpRouteLimit} from '../rateLimit';
import {
    isLoggedIn,
    requiresAdmin,
    userCanCrossOrganizations
} from '../utils/authMiddleware';
import {appendUploadAssetToken} from '../utils/uploadAssetTokens';
import {
    backgroundsPath,
    profilePicturesPath,
    reportImagesPath
} from '../utils/uploadPaths';

const logger = log4js.getLogger('web');
const router = express.Router();

const upload = multer({
    dest: 'uploads/temp/',
    limits: {fileSize: 10 * 1024 * 1024},
    fileFilter: (_req, file, cb) => {
        cb(null, file.mimetype.startsWith('image/'));
    }
});

const uploadReportImage = multer({
    dest: 'uploads/temp/',
    limits: {fileSize: 10 * 1024 * 1024}
});

type RequestWithOrgUser = express.Request & {
    user?: {organizationId?: unknown};
};

function reqUserOrgSegment(req: express.Request): string | null {
    return safeOrgSegment((req as RequestWithOrgUser).user?.organizationId);
}

function backgroundDeleteErrorStatus(err: unknown): number {
    if (err instanceof MediaAssetValidationError) return 400;
    if (err instanceof MediaAssetPermissionError) return 403;
    if (err instanceof MediaAssetNotFoundError) return 404;
    return 500;
}

function deleteTempUpload(filePath: string): void {
    try {
        fs.unlinkSync(filePath);
    } catch (error) {
        logger.debug('Temp upload cleanup skipped: %s', errorMessage(error));
    }
}

async function deleteTempUploadAsync(filePath: string): Promise<void> {
    try {
        await fsAsync.unlink(filePath);
    } catch (error) {
        logger.debug('Temp upload cleanup skipped: %s', errorMessage(error));
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// Re-encode through sharp to strip EXIF/GPS/ICC/XMP before disk. animated:true
// keeps every GIF/WebP frame — libvips flattens to the first page otherwise.
export async function writeMetadataStrippedOriginal(
    tempPath: string,
    destPath: string
): Promise<void> {
    const stripped = await sharp(tempPath, {animated: true}).toBuffer();
    await fsAsync.writeFile(destPath, stripped);
}

// Admin sees own org dir + root pool; global provider support sees all tenants.
router.get(
    '/getAllBackgrounds',
    isLoggedIn,
    httpRouteLimit({
        name: 'media-list-backgrounds',
        capacityPerMin: tuning.http.rateLimitMediaUploadPerMin
    }),
    async (req, res) => {
        try {
            return res.json(await listBackgrounds(req.user));
        } catch (err) {
            logger.error('Background list failed: %s', err);
            return res.status(500).json({error: 'Failed to read directory'});
        }
    }
);

// Upload writes to uploads/backgrounds/{orgId}/.
router.post(
    '/uploadBackground',
    requiresAdmin,
    httpRouteLimit({
        name: 'media-upload-background',
        capacityPerMin: tuning.http.rateLimitMediaUploadPerMin
    }),
    upload.single('image'),
    async (req, res) => {
        const file = req.file;
        if (!file) {
            return res.status(400).json({error: 'No file uploaded'});
        }
        const safeName = safeBackgroundName(file.originalname);
        if (!safeName) {
            await deleteTempUploadAsync(file.path);
            return res.status(400).json({error: 'Unsupported image type'});
        }
        const orgSeg = reqUserOrgSegment(req);
        if (!orgSeg) {
            await deleteTempUploadAsync(file.path);
            return res
                .status(403)
                .json({error: 'Authenticated user has no organization'});
        }
        if (
            !(await consumeUploadTicket({
                token: req.body?.ticket ?? req.query?.ticket,
                kind: 'background',
                user: req.user
            }))
        ) {
            await deleteTempUploadAsync(file.path);
            return res.status(403).json({error: 'Invalid upload ticket'});
        }

        const orgDir = path.join(backgroundsPath, orgSeg);
        await fsAsync.mkdir(orgDir, {recursive: true});

        const originalPath = path.join(orgDir, safeName);
        const thumbPath = path.join(orgDir, backgroundThumbName(safeName));
        const displayPath = path.join(orgDir, backgroundDisplayName(safeName));
        let promotedOriginal = false;

        try {
            await writeMetadataStrippedOriginal(file.path, originalPath);
            promotedOriginal = true;
            // Active background paints from displays[], not originals[].
            await sharp(originalPath)
                .resize({
                    width: 1920,
                    height: 1080,
                    fit: 'inside',
                    withoutEnlargement: true
                })
                .png()
                .toFile(displayPath);
            await sharp(originalPath)
                .resize({width: 150, height: 150, fit: 'cover'})
                .png()
                .toFile(thumbPath);
            return res.json({
                success: true,
                message: 'Image uploaded successfully',
                filename: `${orgSeg}/${safeName}`,
                thumbnail: `${orgSeg}/${backgroundThumbName(safeName)}`,
                display: `${orgSeg}/${backgroundDisplayName(safeName)}`
            });
        } catch (err) {
            logger.error('Background upload failed: %s', err);
            if (promotedOriginal) {
                await deleteTempUploadAsync(originalPath);
            }
            await deleteTempUploadAsync(thumbPath);
            await deleteTempUploadAsync(displayPath);
            return res.status(500).json({error: 'Failed to process image'});
        } finally {
            await deleteTempUploadAsync(file.path);
        }
    }
);

router.post(
    '/uploadProfilePic',
    isLoggedIn,
    httpRouteLimit({
        name: 'media-upload-profile-pic',
        capacityPerMin: tuning.http.rateLimitMediaUploadPerMin
    }),
    upload.single('image'),
    async (req, res) => {
        const {username} = req.body;
        const file = req.file;

        if (!file) {
            return res.status(400).json({error: 'No file uploaded'});
        }
        if (
            !username ||
            !/^[a-zA-Z0-9@._-]+$/.test(username) ||
            username.includes('..')
        ) {
            deleteTempUpload(file.path);
            return res.status(400).json({error: 'Invalid username'});
        }

        // Self always allowed; cross-user requires global provider support.
        const isSelf = req.user?.username === username;
        if (!isSelf && !userCanCrossOrganizations(req.user)) {
            deleteTempUpload(file.path);
            return res.status(403).json({
                error: 'Cannot upload profile picture for another user'
            });
        }
        if (
            !(await consumeUploadTicket({
                token: req.body?.ticket ?? req.query?.ticket,
                kind: 'profile_picture',
                user: req.user,
                payload: {username}
            }))
        ) {
            deleteTempUpload(file.path);
            return res.status(403).json({error: 'Invalid upload ticket'});
        }

        const baseFilename = `${path.basename(username)}.png`;
        const originalPath = path.join(profilePicturesPath, baseFilename);

        try {
            await sharp(file.path).png().toFile(originalPath);
            // Returned inline so the client doesn't follow up with GetUrl.
            const url = `/uploads/profilePics/${appendUploadAssetToken(
                'profilePic',
                baseFilename,
                tuning.upload.assetUrlTtlSec
            )}`;
            return res.json({success: true, url});
        } catch (err) {
            logger.error('Profile pic upload failed: %s', err);
            return res.status(500).json({error: 'Failed to process image'});
        } finally {
            deleteTempUpload(file.path);
        }
    }
);

// Admin deletes from own org subdir; global provider support deletes anywhere.
// fileName is either `${file}` or `${orgSeg}/${file}`.
router.post('/deleteBackground', requiresAdmin, async (req, res) => {
    try {
        await deleteBackground(req.user, req.body?.fileName);
        return res.json({success: true, message: 'Image deleted successfully'});
    } catch (err) {
        logger.error('Background delete failed: %s', err);
        const status = backgroundDeleteErrorStatus(err);
        return res.status(status).json({
            error:
                err instanceof Error && status !== 500
                    ? err.message
                    : 'Failed to delete image'
        });
    }
});

router.get('/deleteBackground', (_req, res) => {
    return res.status(405).json({error: 'Method not allowed'});
});

router.get(
    '/getAllReportImages',
    isLoggedIn,
    httpRouteLimit({
        name: 'media-list-report-images',
        capacityPerMin: tuning.http.rateLimitMediaUploadPerMin
    }),
    async (_req, res) => {
        try {
            res.json(await listReportImages());
        } catch (error) {
            logger.error('Report image list failed: %s', errorMessage(error));
            res.status(500).json({
                error: 'Failed to read reportImages directory'
            });
        }
    }
);

// Shared report-image dir — admin baseline so viewers cannot mint files.
router.post(
    '/uploadReportImage',
    requiresAdmin,
    httpRouteLimit({
        name: 'media-upload-report-image',
        capacityPerMin: tuning.http.rateLimitMediaUploadPerMin
    }),
    uploadReportImage.single('image'),
    async (req, res) => {
        const file = req.file;
        const {reportName} = req.body;
        if (!file || !reportName) {
            if (file) await deleteTempUploadAsync(file.path);
            res.status(400).json({error: 'Missing image file or reportName'});
            return;
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(reportName)) {
            await deleteTempUploadAsync(file.path);
            res.status(400).json({error: 'Invalid reportName'});
            return;
        }

        const ext = path
            .extname(path.basename(file.originalname))
            .toLowerCase();
        if (!ALLOWED_REPORT_IMAGE_EXT.has(ext)) {
            await deleteTempUploadAsync(file.path);
            res.status(400).json({error: 'Unsupported image type'});
            return;
        }
        if (
            !(await consumeUploadTicket({
                token: req.body?.ticket ?? req.query?.ticket,
                kind: 'report_image',
                user: req.user
            }))
        ) {
            await deleteTempUploadAsync(file.path);
            res.status(403).json({error: 'Invalid upload ticket'});
            return;
        }

        const timestamp = Date.now();
        const wrapped = `report_${reportName}_${timestamp}`;
        const originalName = `${wrapped}${ext}`;
        const thumbName = `${wrapped}_thumb${ext}`;
        const destOriginal = path.join(reportImagesPath, originalName);
        const destThumb = path.join(reportImagesPath, thumbName);

        try {
            // Run sharp against TEMP path; only promote to public dir after
            // sharp accepts the file as an image. Prevents non-image payloads
            // from ever landing under /uploads/reportImages/.
            await sharp(file.path)
                .resize(150, 150, {fit: 'cover'})
                .toFile(destThumb);
            await writeMetadataStrippedOriginal(file.path, destOriginal);
            res.json({
                success: true,
                original: originalName,
                thumbnail: thumbName
            });
        } catch (err) {
            await deleteTempUploadAsync(destThumb);
            logger.error('Report image upload failed: %s', err);
            res.status(500).json({error: 'Failed to process report image'});
        } finally {
            await deleteTempUploadAsync(file.path);
        }
    }
);

export default router;
