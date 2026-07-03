// POST /api/uploads/asset — org-scoped asset library upload.
// GET  /api/assets/:id   — serve the binary by asset id.

import fs from 'node:fs/promises';
import express from 'express';
import log4js from 'log4js';
import multer from 'multer';
import {tuning} from '../../../config';
import {envInt} from '../../../config/envReader';
import {getAssetById} from '../../asset/assetRepository';
import {resolveAssetDiskPath} from '../../asset/assetStorage';
import {ALLOWED_MIME, uploadAsset} from '../../asset/assetUpload';
import {
    canPerformComponentOperationAsync,
    isComponentPermissionAllowed
} from '../../authz/evaluator';
import {
    consumeUploadTicket,
    type UploadTicketUser,
    type VisualAssetResourceKind
} from '../../uploadTickets';
import {bestEffort} from '../../util/fireAndForget';
import {httpRouteLimit} from '../rateLimit';
import {senderFromUser} from '../utils/senderFromRequest';

const logger = log4js.getLogger('asset-upload');

const MAX_FILE_BYTES = envInt('FM_VIRTUAL_IMAGE_MAX_BYTES', 1024 * 1024, 1024);

const router = express.Router();

const upload = multer({
    dest: 'uploads/temp/',
    limits: {fileSize: MAX_FILE_BYTES}
});

const VISUAL_ASSET_RESOURCE_KINDS = new Set<VisualAssetResourceKind>([
    'virtual-device',
    'bluetooth-device',
    'group'
]);

interface VisualAssetTicketPayload {
    resourceKind: VisualAssetResourceKind;
    resourceId: string;
}

function formText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function isVisualAssetResourceKind(
    value: string
): value is VisualAssetResourceKind {
    return VISUAL_ASSET_RESOURCE_KINDS.has(value as VisualAssetResourceKind);
}

function hasUploadTicket(body: unknown): body is Record<string, unknown> {
    return (
        typeof body === 'object' &&
        body !== null &&
        formText((body as Record<string, unknown>).ticket).length > 0
    );
}

function parseVisualAssetTicketPayload(
    body: Record<string, unknown>
): VisualAssetTicketPayload | null {
    const resourceKind = formText(body.resourceKind);
    const resourceId = formText(body.resourceId);
    if (!isVisualAssetResourceKind(resourceKind)) return null;
    if (!resourceId) return null;
    return {resourceKind, resourceId};
}

async function consumeVisualAssetTicket(input: {
    body: Record<string, unknown>;
    user: UploadTicketUser;
}): Promise<boolean> {
    const payload = parseVisualAssetTicketPayload(input.body);
    if (!payload) return false;
    return Boolean(
        await consumeUploadTicket({
            token: input.body.ticket,
            kind: 'visual_asset',
            user: input.user,
            payload
        })
    );
}

async function canUploadGeneralAsset(req: express.Request): Promise<boolean> {
    if (!req.user) return false;
    const sender = await senderFromUser(req.user, {sourceIp: req.ip});
    return isComponentPermissionAllowed(
        await canPerformComponentOperationAsync(sender, 'devices', 'update')
    );
}

router.post(
    '/uploads/asset',
    httpRouteLimit({
        name: 'asset-upload',
        capacityPerMin: tuning.http.rateLimitMediaUploadPerMin
    }),
    upload.single('file'),
    async (req, res) => {
        const file = req.file;
        const cleanup = async () => {
            if (file) {
                await bestEffort(
                    'unlink.asset-upload-temp',
                    fs.unlink(file.path)
                );
            }
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
            const organizationId = req.user.organizationId;
            if (!organizationId) {
                await cleanup();
                res.status(403).json({error: 'no organization'});
                return;
            }
            const contentType = (file.mimetype || '').toLowerCase();
            if (!ALLOWED_MIME.has(contentType)) {
                await cleanup();
                res.status(400).json({
                    error: `unsupported content type "${contentType}" — accepted: ${[...ALLOWED_MIME].join(', ')}`
                });
                return;
            }
            if (hasUploadTicket(req.body)) {
                if (
                    !(await consumeVisualAssetTicket({
                        body: req.body,
                        user: req.user
                    }))
                ) {
                    await cleanup();
                    res.status(403).json({error: 'Invalid upload ticket'});
                    return;
                }
            } else if (!(await canUploadGeneralAsset(req))) {
                await cleanup();
                res.status(403).json({error: 'permission denied for asset'});
                return;
            }
            const label = String(req.body?.label ?? '').trim() || null;
            const context = String(req.body?.context ?? '').trim() || undefined;
            const bytes = await fs.readFile(file.path);
            const asset = await uploadAsset({
                organizationId,
                uploadedBy: req.user.username,
                contentType,
                bytes,
                label,
                context
            });
            res.json(asset);
        } catch (err) {
            logger.warn(
                'asset upload failed user=%s err=%s',
                req.user?.username ?? '?',
                err instanceof Error ? err.message : String(err)
            );
            res.status(500).json({error: 'upload failed'});
        } finally {
            await cleanup();
        }
    }
);

router.get(
    '/assets/:id',
    httpRouteLimit({
        name: 'asset-get',
        capacityPerMin: tuning.http.rateLimitMediaUploadPerMin
    }),
    async (req, res) => {
        if (!req.user) {
            res.status(401).json({error: 'unauthorized'});
            return;
        }
        const organizationId = req.user.organizationId;
        if (!organizationId) {
            res.status(403).json({error: 'no organization'});
            return;
        }
        const asset = await getAssetById(organizationId, String(req.params.id));
        if (!asset) {
            res.status(404).json({error: 'asset not found'});
            return;
        }
        const disk = resolveAssetDiskPath(asset.file_path);
        if (!disk) {
            res.status(500).json({error: 'asset path invalid'});
            return;
        }
        res.setHeader('Content-Type', asset.content_type);
        res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
        res.sendFile(disk, (err) => {
            if (err) {
                logger.warn('asset send failed id=%s err=%s', asset.id, err);
            }
        });
    }
);

export default router;
