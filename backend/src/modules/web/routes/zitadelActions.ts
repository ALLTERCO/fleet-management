import express from 'express';
import {tuning} from '../../../config';
import {handleGrantRemoved} from '../../zitadelActions/grantRemoved';
import {handleUserRemoved} from '../../zitadelActions/userRemoved';
import {httpRouteLimit} from '../rateLimit';

const router = express.Router();

// Unconditional 200 — Zitadel target health-checks rely on this.
router.get('/healthz', (_req, res) => {
    res.status(200).json({ok: true});
});

// GDPR cascade — Zitadel emits user.removed; FM purges authz + cached rows.
// Shared 'zitadel-webhook' bucket with grant-removed so a single noisy source
// can't drain twice. Trusted upstream, but rate-limited as defense in depth.
router.post(
    '/user-removed',
    httpRouteLimit({
        name: 'zitadel-webhook',
        capacityPerMin: tuning.http.rateLimitZitadelWebhookPerMin
    }),
    async (req, res) => {
        const outcome = await handleUserRemoved({
            headers: req.headers,
            rawBody: (req as unknown as {rawBody?: Buffer}).rawBody,
            ip: req.ip
        });
        res.status(outcome.status).json(outcome.body);
    }
);

// Role revocation — invalidates userinfo cache + live V2 shape immediately.
router.post(
    '/grant-removed',
    httpRouteLimit({
        name: 'zitadel-webhook',
        capacityPerMin: tuning.http.rateLimitZitadelWebhookPerMin
    }),
    async (req, res) => {
        const outcome = await handleGrantRemoved({
            headers: req.headers,
            rawBody: (req as unknown as {rawBody?: Buffer}).rawBody,
            ip: req.ip
        });
        res.status(outcome.status).json(outcome.body);
    }
);

export default router;
