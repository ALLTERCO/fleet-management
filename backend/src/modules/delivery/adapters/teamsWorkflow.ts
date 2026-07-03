// Teams workflow webhook — Adaptive Card via Power Automate.
// See docs/teams-setup.md for the feature list and template fields.

import * as log4js from 'log4js';
import {envCsv, envInt, envStr} from '../../../config/envReader';
import {buildDeliveryContext} from '../../alert/templateContext';
import {renderTemplate} from '../../alert/templateRenderer';
import {alertHref} from '../alertLink';
import {analyzePayload, summaryLine} from '../groupedRender';
import {severityEmoji, severityLabel, stateBadge} from '../notificationDisplay';
import type {
    DeliveryAdapter,
    DeliveryContext,
    DeliveryPayload,
    DeliveryResult
} from '../types';
import {
    type HttpPostResult,
    parseRetryAfterSec,
    postJsonWithTimeout,
    readConfigString
} from './_http';
import {renderTemplatedBody, templateObject} from './_template';

const logger = log4js.getLogger('TeamsWorkflow');

// All tunables env-read per-call so deploy overrides apply without restart.
const maxCardBytes = () => envInt('FM_TEAMS_MAX_CARD_BYTES', 25_000, 1_000);
const cardVersion = () => envStr('FM_TEAMS_CARD_VERSION', '1.5');
const defaultTemplateOverride = () => envStr('FM_TEAMS_DEFAULT_TEMPLATE', '');

// Adaptive Card spec tokens — not user-tunable (spec-defined enums).
const SEVERITY_COLOR: Record<DeliveryPayload['severity'], string> = {
    info: 'Good',
    warning: 'Warning',
    critical: 'Attention'
};
const CONTAINER_STYLE: Record<DeliveryPayload['severity'], string> = {
    info: 'emphasis',
    warning: 'warning',
    critical: 'attention'
};

function allowedHostSuffixes(): readonly string[] {
    return envCsv('FM_TEAMS_WEBHOOK_ALLOWED_HOSTS', []);
}

function mentionSeverities(): readonly string[] {
    return envCsv('FM_TEAMS_MENTION_SEVERITIES', ['critical']);
}

// SSRF-hardening. Empty allowlist = any https URL accepted.
function assertHostAllowed(rawUrl: string): string | null {
    const suffixes = allowedHostSuffixes();
    if (suffixes.length === 0) return null;
    let host: string;
    try {
        host = new URL(rawUrl).hostname.toLowerCase();
    } catch {
        return 'Teams webhook URL is malformed';
    }
    const matches = suffixes.some((raw) => {
        const s = raw.toLowerCase();
        if (host === s) return true;
        const withDot = s.startsWith('.') ? s : `.${s}`;
        return host.endsWith(withDot);
    });
    if (matches) return null;
    return `Teams webhook host '${host}' not in FM_TEAMS_WEBHOOK_ALLOWED_HOSTS`;
}

interface TeamsMention {
    id: string;
    name: string;
}

interface AdditionalFact {
    title: string;
    value: string;
}

interface TeamsConfig {
    headingTemplate?: string;
    footerTemplate?: string;
    additionalFacts: AdditionalFact[];
    mentions: TeamsMention[];
    cardTemplate?: string;
}

function parseString(v: unknown): string | undefined {
    return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function parseAdditionalFacts(raw: unknown): AdditionalFact[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter(
            (f): f is Record<string, unknown> => !!f && typeof f === 'object'
        )
        .map((f) => ({
            title: typeof f.title === 'string' ? f.title : '',
            value: typeof f.value === 'string' ? f.value : ''
        }))
        .filter((f) => f.title && f.value);
}

function parseMentions(raw: unknown): TeamsMention[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter(
            (m): m is Record<string, unknown> => !!m && typeof m === 'object'
        )
        .map((m) => ({
            id: typeof m.id === 'string' ? m.id : '',
            name: typeof m.name === 'string' ? m.name : ''
        }))
        .filter((m) => m.id && m.name);
}

function parseTeamsConfig(raw: Record<string, unknown>): TeamsConfig {
    return {
        headingTemplate: parseString(raw.headingTemplate),
        footerTemplate: parseString(raw.footerTemplate),
        additionalFacts: parseAdditionalFacts(raw.additionalFacts),
        mentions: parseMentions(raw.mentions),
        cardTemplate: parseString(raw.cardTemplate)
    };
}

function renderString(
    tmpl: string,
    payload: DeliveryPayload
): string | undefined {
    try {
        return renderTemplate(tmpl, buildDeliveryContext(payload)).rendered;
    } catch (err) {
        logger.warn(
            'teams_workflow_webhook: string template render failed: %s',
            err instanceof Error ? err.message : String(err)
        );
        return undefined;
    }
}

interface AdaptiveElement {
    type: string;
    [key: string]: unknown;
}

function heading(payload: DeliveryPayload, cfg: TeamsConfig): string {
    if (cfg.headingTemplate) {
        const rendered = renderString(cfg.headingTemplate, payload);
        if (rendered) return rendered;
    }
    return payload.title;
}

function buildFactSet(
    payload: DeliveryPayload,
    extras: AdditionalFact[]
): AdaptiveElement {
    const facts: Array<{title: string; value: string}> = [
        {title: 'Rule', value: payload.ruleName || '—'},
        {
            title: 'Source',
            value: payload.source
                ? `${payload.source.subjectType}: ${payload.source.subjectId}`
                : '—'
        },
        {title: 'Fired at', value: payload.firedAt}
    ];
    for (const f of extras) {
        const rendered = renderString(f.value, payload);
        if (rendered) facts.push({title: f.title, value: rendered});
    }
    return {type: 'FactSet', facts, spacing: 'Medium', separator: true};
}

function buildMentionBody(
    payload: DeliveryPayload,
    mentions: TeamsMention[]
): {block: AdaptiveElement; entities: Array<Record<string, unknown>>} | null {
    if (mentions.length === 0) return null;
    const severities = mentionSeverities();
    if (!severities.includes(payload.severity)) return null;
    const ats = mentions.map((m) => `<at>${m.name}</at>`).join(' ');
    return {
        block: {
            type: 'TextBlock',
            text: ats,
            wrap: true,
            spacing: 'Small'
        },
        entities: mentions.map((m) => ({
            type: 'mention',
            text: `<at>${m.name}</at>`,
            mentioned: {id: m.id, name: m.name}
        }))
    };
}

function buildHeaderContainer(
    payload: DeliveryPayload,
    cfg: TeamsConfig
): AdaptiveElement {
    const sev = `${severityEmoji(payload.severity)} ${severityLabel(payload.severity)}`;
    const state = stateBadge(payload.state);
    const badges = state ? `${sev} · ${state}` : sev;
    const items: AdaptiveElement[] = [
        {
            type: 'ColumnSet',
            columns: [
                {
                    type: 'Column',
                    width: 'auto',
                    verticalContentAlignment: 'Center',
                    items: [
                        {
                            type: 'TextBlock',
                            text: badges,
                            weight: 'Bolder',
                            color: SEVERITY_COLOR[payload.severity],
                            wrap: false
                        }
                    ]
                },
                {
                    type: 'Column',
                    width: 'stretch',
                    verticalContentAlignment: 'Center',
                    items: [
                        {
                            type: 'TextBlock',
                            text: heading(payload, cfg),
                            weight: 'Bolder',
                            size: 'Large',
                            wrap: true
                        }
                    ]
                }
            ]
        }
    ];
    return {
        type: 'Container',
        style: CONTAINER_STYLE[payload.severity],
        items,
        bleed: true,
        spacing: 'None'
    };
}

function buildOpenUrlAction(payload: DeliveryPayload): AdaptiveElement | null {
    const href = alertHref(payload.alertId);
    if (!href) return null;
    return {type: 'Action.OpenUrl', title: 'Open alert', url: href};
}

function buildGroupedBody(
    info: ReturnType<typeof analyzePayload>,
    payload: DeliveryPayload
): AdaptiveElement[] {
    if (info.mode === 'summary') {
        return [
            {
                type: 'TextBlock',
                text: summaryLine(info.aggregate),
                size: 'Large',
                weight: 'Bolder',
                wrap: true
            },
            {
                type: 'TextBlock',
                text: `Rule: ${payload.ruleName}`,
                wrap: true,
                isSubtle: true,
                spacing: 'Small'
            }
        ];
    }
    // list mode — FactSet of "title (subject)"
    return [
        {
            type: 'FactSet',
            facts: info.alerts.slice(0, 20).map((a) => ({
                title: `${severityEmoji(a.severity)} ${severityLabel(a.severity)}`,
                value: a.source
                    ? `${a.title} — ${a.source.subjectType}: ${a.source.subjectId}`
                    : a.title
            })),
            spacing: 'Medium'
        }
    ];
}

function buildDefaultCardContent(
    payload: DeliveryPayload,
    cfg: TeamsConfig
): {
    content: Record<string, unknown>;
    msteamsEntities: Array<Record<string, unknown>>;
} {
    const info = analyzePayload(payload);
    const body: AdaptiveElement[] = [buildHeaderContainer(payload, cfg)];

    if (info.mode === 'single') {
        body.push({
            type: 'TextBlock',
            text: payload.message,
            wrap: true,
            spacing: 'Medium'
        });
        body.push(buildFactSet(payload, cfg.additionalFacts));
    } else {
        body.push(...buildGroupedBody(info, payload));
    }

    const mention = buildMentionBody(payload, cfg.mentions);
    if (mention) body.push(mention.block);

    if (cfg.footerTemplate) {
        const rendered = renderString(cfg.footerTemplate, payload);
        if (rendered) {
            body.push({
                type: 'TextBlock',
                text: rendered,
                wrap: true,
                isSubtle: true,
                size: 'Small',
                spacing: 'Medium',
                separator: true
            });
        }
    }

    const actions: AdaptiveElement[] = [];
    const openUrl = buildOpenUrlAction(payload);
    if (openUrl) actions.push(openUrl);

    // msteams.width="Full" = full channel width (1.5; older clients ignore it).
    const msteams: Record<string, unknown> = {width: 'Full'};
    if (mention) msteams.entities = mention.entities;

    const content: Record<string, unknown> = {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: cardVersion(),
        body,
        msteams
    };
    if (actions.length > 0) content.actions = actions;

    return {content, msteamsEntities: mention?.entities ?? []};
}

function wrapEnvelope(
    content: Record<string, unknown>
): Record<string, unknown> {
    return {
        type: 'message',
        attachments: [
            {
                contentType: 'application/vnd.microsoft.card.adaptive',
                content
            }
        ]
    };
}

// Override with {body,actions,msteams} merges over defaults. Full
// {attachments:[...]} envelope used as-is.
function mergeCardOverride(
    defaultContent: Record<string, unknown>,
    override: unknown
): Record<string, unknown> | null {
    if (!override || typeof override !== 'object') return null;
    const raw = override as Record<string, unknown>;
    if (Array.isArray(raw.attachments)) return raw;
    return {
        ...defaultContent,
        ...(raw.body !== undefined ? {body: raw.body} : {}),
        ...(raw.actions !== undefined ? {actions: raw.actions} : {}),
        ...(raw.msteams !== undefined ? {msteams: raw.msteams} : {})
    };
}

function effectiveCardTemplate(cfg: TeamsConfig): string | undefined {
    return cfg.cardTemplate || defaultTemplateOverride() || undefined;
}

function buildFinalEnvelope(
    payload: DeliveryPayload,
    cfg: TeamsConfig,
    // Pre-rendered card from the rule template; wins over the endpoint's own
    // cardTemplate when present.
    preRenderedCard?: Record<string, unknown>
): Record<string, unknown> {
    const {content} = buildDefaultCardContent(payload, cfg);
    const tmpl = effectiveCardTemplate(cfg);
    const rendered =
        preRenderedCard ??
        (tmpl
            ? renderTemplatedBody<Record<string, unknown>>(
                  tmpl,
                  payload,
                  'teams_workflow_webhook'
              )
            : undefined);
    if (!rendered) return wrapEnvelope(content);
    if (Array.isArray(rendered.attachments)) return rendered;
    const merged = mergeCardOverride(content, rendered);
    if (!merged) return wrapEnvelope(content);
    if (Array.isArray(merged.attachments)) return merged;
    return wrapEnvelope(merged);
}

function byteLength(body: unknown): number {
    return Buffer.byteLength(JSON.stringify(body), 'utf8');
}

function buildTestEnvelope(): Record<string, unknown> {
    return wrapEnvelope({
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: cardVersion(),
        msteams: {width: 'Full'},
        body: [
            {
                type: 'Container',
                style: 'good',
                bleed: true,
                items: [
                    {
                        type: 'TextBlock',
                        text: '🔧 Fleet Manager · connection test',
                        weight: 'Bolder',
                        color: 'Good',
                        wrap: true
                    }
                ]
            },
            {
                type: 'TextBlock',
                text: 'If you can see this card, your Teams webhook is reachable. No alert is attached.',
                wrap: true,
                isSubtle: true,
                size: 'Small',
                spacing: 'Medium'
            }
        ]
    });
}

function summarizeHttpFailure(res: HttpPostResult): {
    errorMessage: string;
    retryAfterSec?: number;
} {
    const retryAfterSec = parseRetryAfterSec(res.headers);
    const parts = [`HTTP ${res.status}`];
    if (retryAfterSec !== undefined)
        parts.push(`retry-after=${retryAfterSec}s`);
    if (res.bodySnippet) parts.push(res.bodySnippet);
    return {
        errorMessage: parts.join(' · '),
        ...(retryAfterSec !== undefined ? {retryAfterSec} : {})
    };
}

function runUrlFrom(headers: Record<string, string>): string | null {
    return headers['x-ms-workflow-run-url'] || null;
}

export const teamsWorkflowAdapter: DeliveryAdapter = {
    provider: 'teams_workflow_webhook',

    async verify(context: DeliveryContext): Promise<void> {
        const url = readConfigString(context.config, 'url');
        if (!url) throw new Error('Teams webhook URL is not configured');
        const hostError = assertHostAllowed(url);
        if (hostError) throw new Error(hostError);
        const res = await postJsonWithTimeout(url, buildTestEnvelope(), {
            organizationId: context.organizationId
        });
        if ('error' in res) {
            throw new Error(
                `Teams webhook connection test failed: ${res.error}`
            );
        }
        if (!res.ok) {
            throw new Error(
                `Teams webhook connection test failed: HTTP ${res.status}${res.bodySnippet ? ` · ${res.bodySnippet}` : ''}`
            );
        }
    },

    async send(
        payload: DeliveryPayload,
        context: DeliveryContext
    ): Promise<DeliveryResult> {
        const url = readConfigString(context.config, 'url');
        if (!url) {
            return {
                state: 'failed',
                errorMessage:
                    'Teams workflow webhook URL is not configured for this endpoint'
            };
        }
        const hostError = assertHostAllowed(url);
        if (hostError) {
            return {state: 'failed', errorMessage: hostError};
        }
        const cfg = parseTeamsConfig(context.config);
        const ruleCard = templateObject(context);
        let envelope: Record<string, unknown>;
        try {
            envelope = buildFinalEnvelope(
                payload,
                cfg,
                ruleCard && !Array.isArray(ruleCard) ? ruleCard : undefined
            );
        } catch (err) {
            return {
                state: 'failed',
                errorMessage: err instanceof Error ? err.message : String(err)
            };
        }
        const size = byteLength(envelope);
        const cap = maxCardBytes();
        if (size > cap) {
            return {
                state: 'failed',
                errorMessage: `Teams card exceeds FM_TEAMS_MAX_CARD_BYTES (${size} > ${cap}) — shorten template or facts`
            };
        }
        const res = await postJsonWithTimeout(url, envelope, {
            organizationId: payload.organizationId
        });
        if ('error' in res) {
            return {state: 'failed', errorMessage: res.error};
        }
        if (res.ok) {
            return {
                state: 'succeeded',
                httpStatus: res.status,
                providerCode: runUrlFrom(res.headers)
            };
        }
        const failure = summarizeHttpFailure(res);
        return {
            state: 'failed',
            httpStatus: res.status,
            errorMessage: failure.errorMessage,
            ...(failure.retryAfterSec !== undefined
                ? {retryAfterSec: failure.retryAfterSec}
                : {})
        };
    }
};
