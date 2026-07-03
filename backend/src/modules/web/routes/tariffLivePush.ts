import express from 'express';
import log4js from 'log4js';
import {hashIngressToken} from '../../deviceIngress/tokenHash.js';
import {defaultLiveTariffRepository} from '../../repositories/LiveTariffRepository.js';
import {httpRouteLimit} from '../rateLimit.js';
import {paramStr} from '../utils/params.js';

const logger = log4js.getLogger('web');
const router = express.Router();

// Unauthenticated price-push endpoint. The `:token` path parameter is the
// plaintext token returned by Tariff.SetLiveSource. We hash it and look up
// the owning tariff — the hash stored in DB is never exposed.
router.post(
    '/tariff/live/:token',
    httpRouteLimit({name: 'tariff-live-push', capacityPerMin: 120}),
    async (req, res) => {
        try {
            const token = paramStr(req.params.token);
            const hash = hashIngressToken(token);
            const liveRepo = await defaultLiveTariffRepository();
            const tariffId = await liveRepo.tariffIdByPushToken(hash);
            if (tariffId === null) {
                res.status(404).json({error: 'token not found'});
                return;
            }

            const price = (req.body as Record<string, unknown>)?.price;
            if (typeof price !== 'number' || !Number.isFinite(price)) {
                res.status(400).json({error: 'price must be a finite number'});
                return;
            }

            await liveRepo.appendPrice(
                tariffId,
                Math.floor(Date.now() / 1000),
                price
            );
            res.json({price});
        } catch (err) {
            logger.error('tariff live push failed: %s', err);
            res.status(500).json({error: 'internal error'});
        }
    }
);

export default router;
