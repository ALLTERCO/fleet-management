import express from 'express';
import * as log4js from 'log4js';
import {
    handleProviderReceiptCallback,
    receiptSignatureHeaderName
} from '../../notification/ProviderReceiptCallback';
import {httpRouteLimit} from '../rateLimit';

const logger = log4js.getLogger('provider-receipts');
const router = express.Router();

router.post(
    '/provider-receipts/:provider',
    httpRouteLimit({name: 'provider-receipts', capacityPerMin: 120}),
    async (req, res) => {
        try {
            const provider = providerParam(req.params.provider);
            const result = await handleProviderReceiptCallback({
                provider,
                rawBody: (req as unknown as {rawBody?: Buffer}).rawBody,
                signatureHeader: req.header(receiptSignatureHeaderName()),
                payload: req.body
            });
            res.json(result);
        } catch (err) {
            logger.warn(
                'provider receipt rejected provider=%s: %s',
                providerParam(req.params.provider),
                err instanceof Error ? err.message : String(err)
            );
            res.status(400).json({
                ok: false,
                error: err instanceof Error ? err.message : String(err)
            });
        }
    }
);

function providerParam(value: string | string[] | undefined): string {
    return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

export default router;
