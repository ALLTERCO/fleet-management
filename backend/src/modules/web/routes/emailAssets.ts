// HTTP routes for binary email attachments — upload (multipart) and
// inline-download (bytea → stream). Mounted under /api/notifications by
// web/index.ts with isLoggedIn middleware applied upstream. Per-route
// notifications:* permission gate mirrors the RPC contract enforced on
// EmailAsset.List / EmailAsset.Get via @Component.CrudPermission.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import express from 'express';
import log4js from 'log4js';
import multer from 'multer';
import {tuning} from '../../../config';
import {envInt} from '../../../config/envReader';
import {
    deleteAsset,
    getAssetBytes,
    getAssetMetadata,
    insertAsset,
    isAllowedContentType,
    listAssets
} from '../../delivery/emailAssets';
import {sanitizeSvg} from '../../svgSanitize';
import {consumeUploadTicket} from '../../uploadTickets';
import {bestEffort} from '../../util/fireAndForget';
import {httpRouteLimit} from '../rateLimit';
import {requiresAnyPermission} from '../utils/authMiddleware';
import {paramStr} from '../utils/params';

const logger = log4js.getLogger('email-assets');

const SVG_CONTENT_TYPE = 'image/svg+xml';

// SVG can carry active script; sanitize before storage so neither the inline
// HTTP download nor the SMTP adapter ever serves an executable payload.
export function sanitizeAssetBytes(contentType: string, bytes: Buffer): Buffer {
    return contentType === SVG_CONTENT_TYPE ? sanitizeSvg(bytes) : bytes;
}

// Inline assets are served same-origin; nosniff stops a mislabelled byte
// stream from being interpreted as active content by the browser.
export function applyAssetDownloadHeaders(
    res: express.Response,
    asset: {filename: string; contentType: string}
): void {
    res.setHeader('Content-Type', asset.contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
        'Content-Disposition',
        `inline; filename="${asset.filename.replace(/"/g, '')}"`
    );
    res.setHeader('Cache-Control', 'private, max-age=600');
}

const MAX_FILE_BYTES = envInt(
    'FM_EMAIL_ATTACHMENT_MAX_BYTES',
    5 * 1024 * 1024,
    1024
);

const router = express.Router();

const upload = multer({
    dest: 'uploads/temp/',
    limits: {fileSize: MAX_FILE_BYTES}
});

router.post(
    '/email-assets',
    requiresAnyPermission('notifications:create', 'notifications:update'),
    httpRouteLimit({
        name: 'email-asset-upload',
        capacityPerMin: tuning.http.rateLimitMediaUploadPerMin
    }),
    upload.single('file'),
    async (req, res) => {
        const organizationId = req.user?.organizationId;
        const file = req.file;
        if (!organizationId) {
            if (file)
                await bestEffort(
                    'unlink.email-asset-temp',
                    fs.unlink(file.path)
                );
            res.status(403).json({error: 'no organization context'});
            return;
        }
        if (!file) {
            res.status(400).json({error: 'no file in "file" form field'});
            return;
        }
        try {
            const contentType = (file.mimetype || '').toLowerCase();
            if (!isAllowedContentType(contentType)) {
                res.status(400).json({
                    error: `content type "${contentType}" not allowed — set FM_EMAIL_ASSETS_CONTENT_TYPES to extend`
                });
                return;
            }
            if (
                !(await consumeUploadTicket({
                    token: req.body?.ticket ?? req.query?.ticket,
                    kind: 'email_asset',
                    user: req.user
                }))
            ) {
                res.status(403).json({error: 'Invalid upload ticket'});
                return;
            }
            const raw = await fs.readFile(file.path);
            const bytes = sanitizeAssetBytes(contentType, raw);
            const sha256 = crypto
                .createHash('sha256')
                .update(bytes)
                .digest('hex');
            const inserted = await insertAsset({
                organizationId,
                filename: file.originalname.slice(0, 255),
                contentType,
                sizeBytes: bytes.byteLength,
                sha256,
                bytes
            });
            res.json({
                id: inserted.id,
                filename: inserted.filename,
                contentType: inserted.contentType,
                sizeBytes: inserted.sizeBytes,
                sha256: inserted.sha256,
                createdAt: inserted.createdAt,
                deduped: inserted.deduped
            });
        } catch (err) {
            logger.warn(
                'email asset upload failed org=%s err=%s',
                organizationId,
                err instanceof Error ? err.message : String(err)
            );
            const msg = err instanceof Error ? err.message : String(err);
            const code = /quota exceeded/i.test(msg) ? 413 : 500;
            res.status(code).json({error: msg});
        } finally {
            await bestEffort(
                'unlink.email-asset-replace-temp',
                fs.unlink(file.path)
            );
        }
    }
);

router.get(
    '/email-assets/:id',
    requiresAnyPermission('notifications:read'),
    httpRouteLimit({
        name: 'email-asset-download',
        capacityPerMin: tuning.http.rateLimitMediaUploadPerMin
    }),
    async (req, res) => {
        const organizationId = req.user?.organizationId;
        const id = Number.parseInt(paramStr(req.params.id), 10);
        if (!organizationId) {
            res.status(403).json({error: 'no organization context'});
            return;
        }
        if (!Number.isInteger(id) || id < 1) {
            res.status(400).json({error: 'invalid id'});
            return;
        }
        try {
            const asset = await getAssetBytes(organizationId, id);
            if (!asset) {
                res.status(404).json({error: 'asset not found'});
                return;
            }
            applyAssetDownloadHeaders(res, asset);
            res.end(asset.bytes);
        } catch (err) {
            logger.warn(
                'email asset download failed org=%s id=%d err=%s',
                organizationId,
                id,
                err instanceof Error ? err.message : String(err)
            );
            res.status(500).json({error: 'asset fetch failed'});
        }
    }
);

// Exposed for the Component layer (List / Get / Delete RPCs); the heavy
// bytes endpoint stays HTTP so <img src="/api/..."> works directly.
export {deleteAsset, getAssetMetadata, listAssets};
export default router;
