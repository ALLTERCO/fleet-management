import type express from 'express';
import {tuning} from '../../../config/tuning';
import {UNAUTHORIZED_USER} from '../../user';
import {isLoggedIn} from '../utils/authMiddleware';
import {
    type ResolvedUploadAsset,
    resolveUploadAsset,
    type UploadAssetKind
} from '../utils/uploadAssetResolver';
import {verifyUploadAssetPath} from '../utils/uploadAssetTokens';

function paramPath(value: unknown): string {
    if (Array.isArray(value)) return value.join('/');
    return typeof value === 'string' ? value : '';
}

function sendResolvedAsset(
    resolved: ResolvedUploadAsset,
    res: express.Response,
    next: express.NextFunction
): void {
    const maxAgeSec = tuning.upload.assetCacheMaxAgeSec;
    const headers = {
        'Cache-Control':
            maxAgeSec > 0 ? `private, max-age=${maxAgeSec}` : 'no-store',
        'X-Content-Type-Options': 'nosniff'
    };
    res.sendFile(
        resolved.file,
        {
            root: resolved.root,
            dotfiles: 'deny',
            headers,
            lastModified: true,
            maxAge: maxAgeSec > 0 ? maxAgeSec * 1000 : 0
        },
        (err) => {
            if (!err) return;
            if (resolved.fallbackFile && !res.headersSent) {
                res.sendFile(
                    resolved.fallbackFile,
                    {
                        root: resolved.root,
                        dotfiles: 'deny',
                        headers,
                        lastModified: true,
                        maxAge: maxAgeSec > 0 ? maxAgeSec * 1000 : 0
                    },
                    // Fallback is the bundled default; a failure here means a
                    // broken image — surface it, do not swallow.
                    (fallbackErr) => {
                        if (fallbackErr && !res.headersSent) next(fallbackErr);
                    }
                );
                return;
            }
            if (!res.headersSent) res.status(404).json({error: 'Not found'});
            else next(err);
        }
    );
}

function uploadAssetHandler(kind: UploadAssetKind) {
    return (
        req: express.Request,
        res: express.Response,
        next: express.NextFunction
    ) => {
        const assetPath = paramPath(req.params.assetPath);
        const signed = verifyUploadAssetPath(
            kind,
            assetPath,
            req.query.assetToken
        );
        const loggedIn =
            !!req.token &&
            !!req.user &&
            req.user.username !== UNAUTHORIZED_USER.username;
        if (!signed && !loggedIn) {
            isLoggedIn(req, res, next);
            return;
        }
        const resolved = resolveUploadAsset(kind, assetPath, req.user, signed);
        if (!resolved) {
            res.status(404).json({error: 'Not found'});
            return;
        }
        sendResolvedAsset(resolved, res, next);
    };
}

export function registerUploadAssetRoutes(app: express.Express): void {
    app.get(
        '/uploads/backgrounds/*assetPath',
        uploadAssetHandler('background')
    );
    app.get(
        '/uploads/profilePics/*assetPath',
        uploadAssetHandler('profilePic')
    );
    app.get(
        '/uploads/reportImages/*assetPath',
        uploadAssetHandler('reportImage')
    );
}
