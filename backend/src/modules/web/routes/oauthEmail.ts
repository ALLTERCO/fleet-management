// HTTP callback for in-app email OAuth2 consent. Mounted at
// /api/oauth/callback/email. No auth middleware — the provider redirect
// arrives unauthenticated; CSRF/replay guards live on the state token.

import express from 'express';
import log4js from 'log4js';
import {tuning} from '../../../config';
import {
    readEndpointClientSecret,
    writeEndpointRefreshToken
} from '../../delivery/endpointSecretStore';
import {handleCallback} from '../../delivery/oauthConsent';
import {httpRouteLimit} from '../rateLimit';

const logger = log4js.getLogger('oauth-email');

const router = express.Router();

function htmlAttrEscape(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// External script (CSP-clean). Values via data-* attrs.
function landingHtml(status: 'ok' | 'error', detail: string): string {
    return `<!doctype html><meta charset="utf-8"><title>OAuth ${htmlAttrEscape(status)}</title>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:2rem;"
      data-oauth-status="${htmlAttrEscape(status)}"
      data-oauth-detail="${htmlAttrEscape(detail)}">
<h3 id="h"></h3><p id="p"></p>
<script src="/oauth-email-callback.js"></script>`;
}

router.get(
    '/callback/email',
    httpRouteLimit({
        name: 'oauth-email-callback',
        // Callback is one hit per operator consent — reuse the
        // light-traffic general-purpose bucket.
        capacityPerMin: tuning.http.rateLimitApiSwitchPerMin
    }),
    async (req, res) => {
        const code = typeof req.query.code === 'string' ? req.query.code : '';
        const state =
            typeof req.query.state === 'string' ? req.query.state : '';
        const providerError =
            typeof req.query.error === 'string' ? req.query.error : '';
        if (providerError) {
            res.status(400)
                .type('html')
                .send(landingHtml('error', `provider: ${providerError}`));
            return;
        }
        if (!code || !state) {
            res.status(400)
                .type('html')
                .send(landingHtml('error', 'missing code or state'));
            return;
        }
        try {
            const result = await handleCallback({
                code,
                state,
                hooks: {
                    readClientSecret: (_org, endpointId) =>
                        readEndpointClientSecret(endpointId),
                    writeRefreshToken: (_org, endpointId, token) =>
                        writeEndpointRefreshToken(endpointId, token)
                }
            });
            logger.info(
                'oauth consent ok org=%s channel=%d provider=%s',
                result.organizationId,
                result.channelId,
                result.provider
            );
            res.type('html').send(landingHtml('ok', 'refresh token stored'));
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn('oauth callback failed: %s', msg);
            res.status(400).type('html').send(landingHtml('error', msg));
        }
    }
);

export default router;
