/** Generic webhook: POST JSON. Secret headers arrive via merged config. */
import type {
    DeliveryAdapter,
    DeliveryContext,
    DeliveryPayload,
    DeliveryResult
} from '../types';
import {postJsonWithTimeout} from './_http';
import {renderTemplatedBody} from './_template';

interface WebhookHeader {
    name: string;
    value?: string;
}
interface WebhookConfig {
    url: string;
    headers: WebhookHeader[];
    timeoutMs?: number;
    bodyTemplate?: string;
}

function parseConfig(raw: Record<string, unknown>): WebhookConfig {
    const url = String(raw.url ?? '');
    if (!url) throw new Error('generic_webhook config requires url');
    const headers = Array.isArray(raw.headers)
        ? (raw.headers as Array<Record<string, unknown>>)
              .filter((h) => typeof h?.name === 'string')
              .map((h) => ({
                  name: String(h.name),
                  value: typeof h.value === 'string' ? h.value : undefined
              }))
        : [];
    return {
        url,
        headers,
        timeoutMs:
            typeof raw.timeoutMs === 'number' ? raw.timeoutMs : undefined,
        bodyTemplate:
            typeof raw.bodyTemplate === 'string' ? raw.bodyTemplate : undefined
    };
}

function buildHeaders(cfg: WebhookConfig): Record<string, string> {
    const out: Record<string, string> = {'content-type': 'application/json'};
    for (const h of cfg.headers) {
        if (h.value !== undefined) out[h.name] = h.value;
    }
    return out;
}

export const genericWebhookAdapter: DeliveryAdapter = {
    provider: 'generic_webhook',
    async send(
        payload: DeliveryPayload,
        context: DeliveryContext
    ): Promise<DeliveryResult> {
        let cfg: WebhookConfig;
        try {
            cfg = parseConfig(context.config);
        } catch (err) {
            return {
                state: 'failed',
                errorMessage: err instanceof Error ? err.message : String(err)
            };
        }
        const templatedBody = renderTemplatedBody<unknown>(
            cfg.bodyTemplate,
            payload,
            'generic_webhook'
        );
        const body = templatedBody ?? payload;
        const res = await postJsonWithTimeout(cfg.url, body, {
            headers: buildHeaders(cfg),
            timeoutMs: cfg.timeoutMs,
            organizationId: payload.organizationId
        });
        if ('error' in res) {
            return {state: 'failed', errorMessage: res.error};
        }
        if (res.ok) return {state: 'succeeded', httpStatus: res.status};
        return {
            state: 'failed',
            httpStatus: res.status,
            errorMessage: res.bodySnippet
        };
    }
};
