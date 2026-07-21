import * as fsAsync from 'node:fs/promises';
import * as path from 'node:path';
import express from 'express';
import log4js from 'log4js';
import multer from 'multer';
import {tuning} from '../../../config';
import type BackupComponent from '../../../model/component/BackupComponent';
import RpcError from '../../../rpc/RpcError';
import {httpStatusFor} from '../../../types/api/errors';
import * as Commander from '../../Commander';
import {bestEffort} from '../../util/fireAndForget';
import {httpRouteLimit} from '../rateLimit';
import {requiresAnyPermission} from '../utils/authMiddleware';

const logger = log4js.getLogger('web');
const router = express.Router();

// Multer lands the upload on disk; the size cap is enforced here (and again in
// the strict parser) so an oversized upload is dropped before it reaches store.
const uploadBackupFile = multer({
    dest: 'uploads/temp/',
    limits: {fileSize: tuning.backup.importMaxBytes}
});

// Per-org admin action (devices:update). Chain mirrors the firmware route:
// permission gate → rate limit → multipart → handler.
router.post(
    '/importBackup',
    requiresAnyPermission('devices:update'),
    httpRouteLimit({
        name: 'backup-import',
        capacityPerMin: tuning.http.rateLimitBackupImportPerMin
    }),
    uploadBackupFile.single('backup'),
    async (req, res) => {
        const file = req.file;
        if (!file) {
            res.status(400).json({error: 'No backup file uploaded'});
            return;
        }
        const originalName = path.basename(file.originalname);
        const ext = path.extname(originalName).toLowerCase();
        if (ext !== '.zip') {
            await bestEffort(
                'unlink.backup-import-temp',
                fsAsync.unlink(file.path)
            );
            res.status(400).json({error: 'Backup file must be a .zip archive'});
            return;
        }

        try {
            const component = Commander.getComponent('backup') as
                | BackupComponent
                | undefined;
            if (!component) {
                res.status(500).json({error: 'Backup service unavailable'});
                return;
            }
            const fileBuffer = await fsAsync.readFile(file.path);
            const backup = await component.importBackup({
                fileBuffer,
                organizationId: req.user?.organizationId ?? null,
                requestedName: req.body?.name,
                originalFileName: originalName
            });
            res.json({success: true, backup});
        } catch (err) {
            if (err instanceof RpcError) {
                // Strict validation rejection — surface the stable code/reason.
                const details = err.data?.details as
                    | {reason?: string}
                    | undefined;
                res.status(httpStatusFor(err.code)).json({
                    error: err.message,
                    code: err.code,
                    ...(details?.reason ? {reason: details.reason} : {})
                });
                return;
            }
            logger.error('Backup import failed: %s', err);
            res.status(500).json({error: 'Failed to import backup'});
        } finally {
            // The stored copy is written by importBackup; the temp upload is
            // always removed, success or failure.
            await bestEffort(
                'unlink.backup-import-temp',
                fsAsync.unlink(file.path)
            );
        }
    }
);

export default router;
