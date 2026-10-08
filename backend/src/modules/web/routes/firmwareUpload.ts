import * as fsAsync from 'node:fs/promises';
import * as path from 'node:path';
import express from 'express';
import log4js from 'log4js';
import multer from 'multer';
import {tuning} from '../../../config';
import {processFirmwareUpload} from '../../uploads/fileTransfer';
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

        try {
            const result = await processFirmwareUpload({
                tempPath: file.path,
                originalName,
                sizeBytes: file.size,
                uploadedBy: req.user?.username || 'unknown',
                options: {
                    retention:
                        req.body?.retention === 'library'
                            ? 'library'
                            : 'temporary',
                    name: req.body?.name,
                    app: req.body?.app,
                    model: req.body?.model,
                    ver: req.body?.ver,
                    fwId: req.body?.fwId,
                    channel:
                        req.body?.channel === 'stable' ||
                        req.body?.channel === 'beta' ||
                        req.body?.channel === 'custom'
                            ? req.body.channel
                            : undefined,
                    tags: req.body?.tags
                }
            });
            res.json({success: true, ...result});
        } catch (err) {
            logger.error('Firmware file upload failed: %s', err);
            res.status(500).json({error: 'Failed to store firmware file'});
        } finally {
            await bestEffort(
                'unlink.firmware-upload-temp',
                fsAsync.unlink(file.path)
            );
        }
    }
);

export default router;
