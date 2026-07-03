// Slack incoming webhook. URL is a secret field.
import {analyzePayload, summaryLine} from '../groupedRender';
import {slackSeverityEmoji} from '../notificationDisplay';
import type {
    DeliveryAdapter,
    DeliveryContext,
    DeliveryPayload,
    DeliveryResult
} from '../types';
import {postJsonWithTimeout, readConfigString} from './_http';
import {renderTemplatedBody, templateObject, templateText} from './_template';

function formatText(payload: DeliveryPayload, prefix: string | null): string {
    const info = analyzePayload(payload);
    const head = prefix ? `${prefix} ` : '';
    const emoji = slackSeverityEmoji(payload.severity);
    if (info.mode === 'single') {
        return `${head}${emoji} *${payload.title}*\n${payload.message}`;
    }
    if (info.mode === 'summary') {
        return `${head}${emoji} *${summaryLine(info.aggregate)}*\nRule: ${payload.ruleName}`;
    }
    const lines = info.alerts
        .slice(0, 20)
        .map(
            (a) =>
                `• ${slackSeverityEmoji(a.severity)} ${a.title}${a.source ? ` _${a.source.subjectId}_` : ''}`
        );
    return `${head}${emoji} *${info.alerts.length} alerts — ${payload.ruleName}*\n${lines.join('\n')}`;
}

function customBody(
    custom: unknown,
    payload: DeliveryPayload,
    prefix: string | null
): Record<string, unknown> {
    if (Array.isArray(custom)) return {blocks: custom};
    if (custom && typeof custom === 'object') {
        return custom as Record<string, unknown>;
    }
    return {text: formatText(payload, prefix)};
}

// Emit `channel` when channelOverride is set. Honored by legacy
// custom-integration webhooks; app-based webhooks post to their configured
// channel and ignore it (Slack's behavior, not ours).
export function applyChannelOverride(
    body: Record<string, unknown>,
    config: Record<string, unknown>
): Record<string, unknown> {
    const override = config.channelOverride;
    if (typeof override !== 'string' || !override.trim()) return body;
    return {...body, channel: override.trim()};
}

// Final Slack body for a send. The rule template (context.templateBody) wins
// over the endpoint's blocksTemplate: a structured body becomes Block Kit, a
// plain/fallback string becomes {text}. channelOverride applied last.
export function buildSlackBody(
    payload: DeliveryPayload,
    context: DeliveryContext,
    prefix: string | null,
    blocksTemplate: string | undefined
): Record<string, unknown> {
    const tmplObject = templateObject(context);
    const tmplText = templateText(context);
    const baseBody =
        tmplObject === undefined && tmplText !== undefined
            ? {text: tmplText}
            : customBody(
                  tmplObject ??
                      renderTemplatedBody<unknown>(
                          blocksTemplate,
                          payload,
                          'slack_webhook'
                      ),
                  payload,
                  prefix
              );
    return applyChannelOverride(baseBody, context.config);
}

export const slackWebhookAdapter: DeliveryAdapter = {
    provider: 'slack_webhook',
    async send(
        payload: DeliveryPayload,
        context: DeliveryContext
    ): Promise<DeliveryResult> {
        const url = readConfigString(context.config, 'url');
        if (!url) {
            return {
                state: 'failed',
                errorMessage:
                    'Slack webhook URL is not configured for this endpoint'
            };
        }
        const prefix =
            typeof context.config.defaultTextPrefix === 'string'
                ? (context.config.defaultTextPrefix as string)
                : null;
        const blocksTemplate =
            typeof context.config.blocksTemplate === 'string'
                ? context.config.blocksTemplate
                : undefined;
        try {
            const body = buildSlackBody(
                payload,
                context,
                prefix,
                blocksTemplate
            );
            const result = await postJsonWithTimeout(url, body, {
                organizationId: payload.organizationId
            });
            if ('error' in result) {
                return {state: 'failed', errorMessage: result.error};
            }
            if (result.ok) {
                return {
                    state: 'succeeded',
                    httpStatus: result.status,
                    providerCode: result.bodySnippet || null
                };
            }
            return {
                state: 'failed',
                httpStatus: result.status,
                errorMessage: result.bodySnippet
            };
        } catch (err) {
            return {
                state: 'failed',
                errorMessage: err instanceof Error ? err.message : String(err)
            };
        }
    }
};
