import crypto from 'node:crypto';
import * as fsAsync from 'node:fs/promises';
import * as path from 'node:path';
import express from 'express';
import log4js from 'log4js';
import multer from 'multer';
import {tuning} from '../../../config';
import {
    computeSha256,
    FIRMWARE_LIBRARY_REGISTRY,
    type FirmwareLibraryItem,
    firmwareLibraryPath,
    invalidateFirmwareLibraryCache,
    moveUploadedFirmwareFile,
    parseTags,
    registerTemporaryFirmwareFile,
    sanitizeOptionalText,
    temporaryFirmwareUploadsPath
} from '../../firmwareLibrary';
import * as Registry from '../../Registry';
import {consumeUploadTicket} from '../../uploadTickets';
import {bestEffort} from '../../util/fireAndForget';
import {httpRouteLimit} from '../rateLimit';
import {requiresPlatformAdmin} from '../utils/authMiddleware';

const logger = log4js.getLogger('web');
const router = express.Router();

const uploadFirmwareFile = multer({
    dest: 'uploads/temp/',
    limits: {fileSize: 64 * 1024 * 1024}
});

// Firmware library is instance-wide — provider support only.
router.post(
    '/uploadFirmwareFile',
    requiresPlatformAdmin,
    httpRouteLimit({
        name: 'media-upload-firmware',
        capacityPerMin: tuning.http.rateLimitFirmwareUploadPerMin
    }),
    uploadFirmwareFile.single('firmware'),
    async (req, res) => {
        const file = req.file;
        if (!file) {
            res.status(400).json({error: 'No firmware file uploaded'});
            return;
        }
        const originalName = path.basename(file.originalname);
        const ext = path.extname(originalName).toLowerCase();
        if (!['.zip', '.bin', '.ota', '.sfu', '.swu'].includes(ext)) {
            await bestEffort(
                'unlink.firmware-upload-temp',
                fsAsync.unlink(file.path)
            );
            res.status(400).json({error: 'Unsupported firmware file type'});
            return;
        }
        if (
            !(await consumeUploadTicket({
                token: req.body?.ticket ?? req.query?.ticket,
                kind: 'firmware',
                user: req.user
            }))
        ) {
            await bestEffort(
                'unlink.firmware-upload-temp',
                fsAsync.unlink(file.path)
            );
            res.status(403).json({error: 'Invalid upload ticket'});
            return;
        }

        const safeBase = path
            .basename(originalName, ext)
            .replace(/[^a-zA-Z0-9._-]+/g, '_')
            .slice(0, 80);
        const retention =
            req.body?.retention === 'library' ? 'library' : 'temporary';
        const fileName = `${safeBase || 'firmware'}-${Date.now()}${ext}`;
        const destPath = path.join(
            retention === 'library'
                ? firmwareLibraryPath
                : temporaryFirmwareUploadsPath,
            fileName
        );
        let promotedDest = false;
        let stored = false;

        try {
            await moveUploadedFirmwareFile(file.path, destPath);
            promotedDest = true;
            if (retention === 'library') {
                const id = crypto.randomUUID();
                const checksum = await computeSha256(destPath);
                const item: FirmwareLibraryItem = {
                    id,
                    name:
                        sanitizeOptionalText(req.body?.name) ||
                        path.basename(originalName, ext),
                    originalFileName: originalName,
                    storedFileName: fileName,
                    uploadedAt: Date.now(),
                    uploadedBy: req.user?.username || 'unknown',
                    fileSize: req.file?.size || 0,
                    checksum,
                    app: sanitizeOptionalText(req.body?.app),
                    model: sanitizeOptionalText(req.body?.model),
                    ver: sanitizeOptionalText(req.body?.ver),
                    fwId: sanitizeOptionalText(req.body?.fwId),
                    channel:
                        req.body?.channel === 'stable' ||
                        req.body?.channel === 'beta' ||
                        req.body?.channel === 'custom'
                            ? req.body.channel
                            : undefined,
                    tags: parseTags(req.body?.tags)
                };

                await Registry.addToRegistry(
                    FIRMWARE_LIBRARY_REGISTRY,
                    id,
                    item
                );
                invalidateFirmwareLibraryCache();
                stored = true;

                res.json({success: true, fileName, item});
                return;
            }

            const token = registerTemporaryFirmwareFile(destPath, fileName, {
                deleteOnExpire: true
            });
            stored = true;
            res.json({
                success: true,
                fileName,
                url: `/media/firmware-file/${token}`
            });
        } catch (err) {
            if (promotedDest && !stored) {
                await bestEffort(
                    'unlink.firmware-upload-dest',
                    fsAsync.unlink(destPath)
                );
            } else if (!promotedDest) {
                await bestEffort(
                    'unlink.firmware-upload-temp',
                    fsAsync.unlink(file.path)
                );
            }
            logger.error('Firmware file upload failed: %s', err);
            res.status(500).json({error: 'Failed to store firmware file'});
        }
    }
);

export default router;
