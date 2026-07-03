// Render one MessageTemplate body for a destination channel, and validate
// bodies on save. Reuses the shared token renderer (renderTemplate) so the
// token set matches notification.rendertemplate and the delivery path.
//
// Channel -> body:
//   email_smtp                -> email body (object {subject, html, text})
//   slack_webhook             -> slack body (Block Kit JSON object, or text)
//   teams_workflow_webhook    -> teams body (Adaptive Card JSON object)
//   anything else / no body   -> fallbackText (string)

import RpcError from '../../rpc/RpcError';
import type {MessageTemplateBodies} from '../../types/api/notification';
import {renderTemplate} from '../alert/templateRenderer';

export interface ChannelRender {
    rendered: string | object;
    missingTokens: string[];
    usedFallback: boolean;
}

/** Minimum a template needs to render — satisfied by both the full
 *  MessageTemplate (RPC) and the delivery-side ResolvedMessageTemplate. */
export interface RenderableTemplate {
    bodies: MessageTemplateBodies;
    fallbackText: string;
}

type Ctx = Record<string, unknown>;

function renderText(
    template: string,
    ctx: Ctx
): {text: string; missing: string[]} {
    const r = renderTemplate(template, ctx);
    return {text: r.rendered, missing: r.missingTokens};
}

function renderJson(
    template: string,
    ctx: Ctx
): {value: unknown; missing: string[]; parsed: boolean} {
    const r = renderTemplate(template, ctx, {escapeMode: 'json'});
    try {
        return {
            value: JSON.parse(r.rendered),
            missing: r.missingTokens,
            parsed: true
        };
    } catch {
        return {value: undefined, missing: r.missingTokens, parsed: false};
    }
}

function looksLikeJson(raw: string): boolean {
    const t = raw.trim();
    return t.startsWith('{') || t.startsWith('[');
}

function fallback(template: RenderableTemplate, ctx: Ctx): ChannelRender {
    const {text, missing} = renderText(template.fallbackText, ctx);
    return {rendered: text, missingTokens: missing, usedFallback: true};
}

function renderEmail(
    body: NonNullable<MessageTemplateBodies['email']>,
    ctx: Ctx
): ChannelRender {
    const subject = renderText(body.subject, ctx);
    const html = renderText(body.html, ctx);
    const text = renderText(body.text, ctx);
    return {
        rendered: {subject: subject.text, html: html.text, text: text.text},
        missingTokens: [
            ...new Set([...subject.missing, ...html.missing, ...text.missing])
        ],
        usedFallback: false
    };
}

function renderSlack(blocks: string, ctx: Ctx): ChannelRender {
    // Block Kit JSON if it parses as JSON; otherwise plain/mrkdwn text.
    if (looksLikeJson(blocks)) {
        const j = renderJson(blocks, ctx);
        if (j.parsed) {
            return {
                rendered: j.value as object,
                missingTokens: j.missing,
                usedFallback: false
            };
        }
    }
    const {text, missing} = renderText(blocks, ctx);
    return {rendered: text, missingTokens: missing, usedFallback: false};
}

export function renderMessageTemplateForChannel(
    template: RenderableTemplate,
    channelType: string,
    ctx: Ctx
): ChannelRender {
    const b = template.bodies ?? {};
    if (channelType === 'email_smtp' && b.email) {
        return renderEmail(b.email, ctx);
    }
    if (channelType === 'slack_webhook' && b.slack?.blocks) {
        return renderSlack(b.slack.blocks, ctx);
    }
    if (channelType === 'teams_workflow_webhook' && b.teams?.card) {
        const j = renderJson(b.teams.card, ctx);
        if (j.parsed && j.value && typeof j.value === 'object') {
            return {
                rendered: j.value as object,
                missingTokens: j.missing,
                usedFallback: false
            };
        }
        // Card didn't render to valid JSON — fall back rather than send junk.
        return fallback(template, ctx);
    }
    return fallback(template, ctx);
}

// --- save-time validation ------------------------------------------------
// JSON well-formedness + a light structural sanity check. NOT full Block-Kit /
// Adaptive-Card schema validation (those are large, versioned, and the
// provider rejects bad payloads anyway; the engine also falls back at send).

function assertJsonObject(raw: string, label: string): void {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw RpcError.InvalidParams(`${label} must be valid JSON`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw RpcError.InvalidParams(`${label} must be a JSON object`);
    }
}

export function validateMessageTemplateBodies(
    bodies: MessageTemplateBodies | undefined
): void {
    if (!bodies) return;
    // Slack: allow plain text; if it looks like JSON it must parse and be an
    // array (blocks) or object.
    const slack = bodies.slack?.blocks;
    if (slack && looksLikeJson(slack)) {
        let parsed: unknown;
        try {
            parsed = JSON.parse(slack);
        } catch {
            throw RpcError.InvalidParams('slack blocks must be valid JSON');
        }
        if (!parsed || typeof parsed !== 'object') {
            throw RpcError.InvalidParams(
                'slack blocks must be a JSON array or object'
            );
        }
    }
    // Teams: an Adaptive Card is a JSON object.
    if (bodies.teams?.card) {
        assertJsonObject(bodies.teams.card, 'teams card');
    }
}
