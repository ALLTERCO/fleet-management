import express from 'express';
import {handleGrantRemoved} from '../../zitadelActions/grantRemoved';
import {handleUserRemoved} from '../../zitadelActions/userRemoved';

const router = express.Router();

// Unconditional 200 — Zitadel target health-checks rely on this.
router.get('/healthz', (_req, res) => {
    res.status(200).json({ok: true});
});

// Signed callbacks are persisted before acknowledgement. Do not put a shared
// request-rate bucket in front of them: a bulk user cleanup must remain lossless.
router.post('/user-removed', async (req, res) => {
    const outcome = await handleUserRemoved({
        headers: req.headers,
        rawBody: (req as unknown as {rawBody?: Buffer}).rawBody,
        ip: req.ip
    });
    res.status(outcome.status).json(outcome.body);
});

// Role change, removal, or account deactivate/lock: drops cached access at once.
router.post('/grant-removed', async (req, res) => {
    const outcome = await handleGrantRemoved({
        headers: req.headers,
        rawBody: (req as unknown as {rawBody?: Buffer}).rawBody,
        ip: req.ip
    });
    res.status(outcome.status).json(outcome.body);
});

export default router;
