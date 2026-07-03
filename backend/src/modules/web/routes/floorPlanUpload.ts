// POST /api/uploads/floor-plan — multipart image upload.
// Permission gate: caller must hold locations:update on the target locationId.
// Mounted under /api by web/index.ts with isLoggedIn applied upstream.

import fs from 'node:fs/promises';
import express from 'express';
import log4js from 'log4js';
import multer from 'multer';
import {tuning} from '../../../config';
import {envInt} from '../../../config/envReader';
import {
    canPerformComponentOperationAsync,
    isComponentPermissionAllowed
} from '../../authz/evaluator';
import {ALLOWED_MIME, saveFloorPlan} from '../../floorPlanUpload';
import * as postgres from '../../PostgresProvider';
import {consumeUploadTicket} from '../../uploadTickets';
import {bestEffort} from '../../util/fireAndForget';
import {httpRouteLimit} from '../rateLimit';
import {senderFromUser} from '../utils/senderFromRequest';

const logger = log4js.getLogger('floor-plan-upload');

const MAX_FILE_BYTES = envInt('FM_FLOOR_PLAN_MAX_BYTES', 5 * 1024 * 1024, 1024);

const router = express.Router();

const upload = multer({
    dest: 'uploads/temp/',
    limits: {fileSize: MAX_FILE_BYTES}
});

router.post(
    '/floor-plan',
    httpRouteLimit({
        name: 'floor-plan-upload',
        capacityPerMin: tuning.http.rateLimitMediaUploadPerMin
    }),
    upload.single('file'),
    async (req, res) => {
        const file = req.file;
        const cleanup = async () => {
            if (file)
                await bestEffort(
                    'unlink.floor-plan-upload-temp',
                    fs.unlink(file.path)
                );
        };

        try {
            if (!req.user) {
                await cleanup();
                res.status(401).json({error: 'unauthorized'});
                return;
            }
            if (!file) {
                res.status(400).json({error: 'no file in "file" form field'});
                return;
            }

            const locationIdRaw = String(req.body?.locationId ?? '').trim();
            if (!/^[1-9]\d*$/.test(locationIdRaw)) {
                await cleanup();
                res.status(400).json({error: 'locationId is required'});
                return;
            }
            const locationId = Number.parseInt(locationIdRaw, 10);

            const contentType = (file.mimetype || '').toLowerCase();
            if (!ALLOWED_MIME.has(contentType)) {
                await cleanup();
                res.status(400).json({
                    error: `unsupported content type "${contentType}" — accepted: ${[...ALLOWED_MIME].join(', ')}`
                });
                return;
            }

            // Guard tenant and permission checks before ticket consumption.
            if (req.user.organizationId) {
                const owns = await postgres.queryRows<{id: number}>(
                    'SELECT id FROM organization.locations WHERE id = $1 AND organization_id = $2 LIMIT 1',
                    [locationId, req.user.organizationId]
                );
                if (owns.length === 0) {
                    await cleanup();
                    logger.warn(
                        'floor-plan upload cross-org rejection user=%s locationId=%d',
                        req.user.username,
                        locationId
                    );
                    res.status(403).json({
                        error: 'permission denied for location'
                    });
                    return;
                }
            }

            const sender = await senderFromUser(req.user, {sourceIp: req.ip});
            const allowed = isComponentPermissionAllowed(
                await canPerformComponentOperationAsync(
                    sender,
                    'locations',
                    'update',
                    locationId
                )
            );
            if (!allowed) {
                await cleanup();
                logger.warn(
                    'floor-plan upload denied user=%s locationId=%d',
                    req.user.username,
                    locationId
                );
                res.status(403).json({
                    error: 'permission denied for location'
                });
                return;
            }

            if (
                !(await consumeUploadTicket({
                    token: req.body?.ticket ?? req.query?.ticket,
                    kind: 'floor_plan',
                    user: req.user,
                    payload: {locationId}
                }))
            ) {
                await cleanup();
                res.status(403).json({error: 'Invalid upload ticket'});
                return;
            }

            const bytes = await fs.readFile(file.path);
            const saved = await saveFloorPlan({
                locationId,
                contentType,
                bytes
            });

            res.json({
                url: saved.url,
                widthPx: saved.widthPx,
                heightPx: saved.heightPx,
                sizeBytes: saved.sizeBytes,
                sha256: saved.sha256
            });
        } catch (err) {
            logger.warn(
                'floor-plan upload failed user=%s err=%s',
                req.user?.username ?? '?',
                err instanceof Error ? err.message : String(err)
            );
            // Generic message — raw err can carry fs paths / internal detail.
            res.status(500).json({error: 'upload failed'});
        } finally {
            await cleanup();
        }
    }
);

export default router;
