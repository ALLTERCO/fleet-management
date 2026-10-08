// Telegram Bot API — rich messages / sendMessage / editMessageText / getMe.
// botToken is a secret merged into config by the outbox before this adapter runs.

import {envInt, envStr} from '../../../config/envReader';
import {buildDeliveryContext} from '../../alert/templateContext';
import {
    renderTemplate,
    type TemplateEscapeMode
} from '../../alert/templateRenderer';
import {alertHref, alertLinkBase} from '../alertLink';
import {analyzePayload, summaryLine} from '../groupedRender';
import {severityEmoji, severityLabel, stateBadge} from '../notificationDisplay';
import type {
    DeliveryAdapter,
    DeliveryContext,
    DeliveryPayload,
    DeliveryResult
} from '../types';
import {postJsonWithTimeout, readConfigString} from './_http';

const API_BASE = envStr('FM_TELEGRAM_API_BASE', 'https://api.telegram.org');
const MESSAGE_MAX_CHARS = envInt('FM_TELEGRAM_MESSAGE_MAX_CHARS', 4096, 100);
const DEFAULT_TEMPLATE_OVERRIDE = envStr('FM_TELEGRAM_DEFAULT_TEMPLATE', '');
const LOCAL_PREVIEW_TOKEN = 'local-preview';

function isLoopbackApiBase(): boolean {
    try {
        const url = new URL(API_BASE);
        return ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    } catch {
        return false;
    }
}

function rejectExternalPreviewToken(token: string): string | null {
    if (token === LOCAL_PREVIEW_TOKEN && !isLoopbackApiBase()) {
        return 'The local alert-preview Telegram token requires a loopback FM_TELEGRAM_API_BASE';
    }
    return null;
}

type ParseMode = 'MarkdownV2' | 'HTML';
function parseMode(config: Record<string, unknown>): ParseMode | undefined {
    if (config.parseMode === 'MarkdownV2' || config.parseMode === 'HTML') {
        return config.parseMode;
    }
    return undefined;
}

function escapeModeFor(mode: ParseMode | undefined): TemplateEscapeMode {
    if (mode === 'MarkdownV2') return 'markdown_v2';
    if (mode === 'HTML') return 'telegram_html';
    return 'none';
}

function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

function escapeHtmlAttribute(value: string): string {
    return escapeHtml(value).replaceAll('"', '&quot;');
}

function builtInSingleAlertCaption(payload: DeliveryPayload): string {
    const context = buildDeliveryContext(payload);
    const display = context.display as Record<string, string>;
    const status = `${severityEmoji(payload.severity)} <b>${escapeHtml(severityLabel(payload.severity))}</b>  |  ${escapeHtml(stateBadge(payload.state))}`;
    const facts = [
        escapeHtml(payload.message),
        ...(display.sourceLabel
            ? [`<b>Source</b>  ${escapeHtml(display.sourceLabel)}`]
            : []),
        `<b>Time</b>  ${escapeHtml(display.timeLabel)}`
    ];
    return `<b>${escapeHtml(payload.title)}</b>\n${status}\n\n${facts.join('\n')}`;
}

function groupedAlertMessage(payload: DeliveryPayload): string {
    const context = buildDeliveryContext(payload);
    const group = context.group as Record<string, string>;
    const info = analyzePayload(payload);
    const status = `${severityEmoji(payload.severity)} ${severityLabel(payload.severity)} · ${stateBadge(payload.state)}`;
    const detail =
        info.mode === 'summary' ? summaryLine(info.aggregate) : group.preview;
    return `${group.deviceTitle}\n${status}\n\n${detail}\n\nRule: ${payload.ruleName}\nTime: ${group.compactTimeLabel}`;
}

function defaultMessage(payload: DeliveryPayload): string {
    const info = analyzePayload(payload);
    if (info.mode === 'single') return builtInSingleAlertCaption(payload);
    return groupedAlertMessage(payload);
}

// Precedence: per-endpoint messageTemplate → FM_TELEGRAM_DEFAULT_TEMPLATE
// → built-in structured default. parse_mode only applies to a template
// (escaped for the mode); the built-in single-alert default is safe HTML.
function renderMessage(
    payload: DeliveryPayload,
    template: string | undefined,
    mode: ParseMode | undefined
): {text: string; parseMode: ParseMode | undefined} {
    const effective = template || DEFAULT_TEMPLATE_OVERRIDE;
    if (!effective) {
        const single = analyzePayload(payload).mode === 'single';
        return {
            text: clamp(defaultMessage(payload)),
            parseMode: single ? 'HTML' : undefined
        };
    }
    const rendered = renderTemplate(effective, buildDeliveryContext(payload), {
        escapeMode: escapeModeFor(mode)
    }).rendered;
    return {text: clamp(rendered), parseMode: mode};
}

function clamp(text: string): string {
    if (text.length <= MESSAGE_MAX_CHARS) return text;
    return `${text.slice(0, MESSAGE_MAX_CHARS - 1)}…`;
}

function telegramAlertUrl(payload: DeliveryPayload): string | undefined {
    const grouped = analyzePayload(payload).mode !== 'single';
    const href = grouped
        ? alertLinkBase().replace(/\/+$/, '')
        : alertHref(payload.alertId);
    if (!href) return undefined;
    try {
        const url = new URL(href);
        if (
            !['http:', 'https:'].includes(url.protocol) ||
            ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
        ) {
            return undefined;
        }
        return url.toString();
    } catch {
        return undefined;
    }
}

function richAlertHtml(
    payload: DeliveryPayload,
    href: string | undefined
): string {
    const context = buildDeliveryContext(payload);
    const display = context.display as Record<string, string>;
    const state =
        payload.state === 'active' ? '🚨 Active' : stateBadge(payload.state);
    const status = `${severityEmoji(payload.severity)} <b>${escapeHtml(severityLabel(payload.severity))}</b> &nbsp;|&nbsp; ${escapeHtml(state)}`;
    const facts = [
        `<p><b>Rule</b>&nbsp;&nbsp;${escapeHtml(payload.message)}</p>`,
        ...(display.sourceLabel
            ? [
                  `<p><b>Source</b>&nbsp;&nbsp;${escapeHtml(display.sourceLabel)}</p>`
              ]
            : []),
        `<p><b>Time</b>&nbsp;&nbsp;${escapeHtml(display.timeLabel)}</p>`
    ];
    const actions = href
        ? [
              `<tg-button type="url" style="primary" url="${escapeHtmlAttribute(href)}">View alert</tg-button>`,
              ...(payload.state === 'active'
                  ? [
                        `<tg-button type="url" url="${escapeHtmlAttribute(`${href}&action=acknowledge`)}">Acknowledge</tg-button>`,
                        `<tg-button type="url" url="${escapeHtmlAttribute(`${href}&action=silence`)}">Silence</tg-button>`
                    ]
                  : [])
          ].join('')
        : '';
    return [
        ...(payload.deviceImageUrl
            ? [`<img src="${escapeHtmlAttribute(payload.deviceImageUrl)}"/>`]
            : []),
        `<table compact><tr><td align="center"><h3>${escapeHtml(payload.title)}</h3></td></tr><tr><td align="center">${status}</td></tr></table>`,
        '<hr/>',
        ...facts,
        ...(actions
            ? [`<tg-button-row align="center">${actions}</tg-button-row>`]
            : [])
    ].join('');
}

function richGroupedAlertHtml(payload: DeliveryPayload, href: string): string {
    const context = buildDeliveryContext(payload);
    const group = context.group as Record<string, string>;
    const state =
        payload.state === 'active' ? '🚨 Active' : stateBadge(payload.state);
    const status = `${severityEmoji(payload.severity)} <b>${escapeHtml(severityLabel(payload.severity))}</b> &nbsp;|&nbsp; ${escapeHtml(state)}`;
    const deviceList = group.preview
        .split('\n')
        .map((line) => escapeHtml(line))
        .join('<br/>');
    return [
        `<table compact><tr><td align="center"><h3>${escapeHtml(group.deviceTitle)}</h3></td></tr><tr><td align="center">${status}</td></tr></table>`,
        '<hr/>',
        `<p><b>Devices</b><br/>${deviceList}</p>`,
        '<br/>',
        `<p><b>Rule</b>&nbsp;&nbsp;${escapeHtml(payload.ruleName)}</p>`,
        `<p><b>Time</b>&nbsp;&nbsp;${escapeHtml(group.compactTimeLabel)}</p>`,
        `<tg-button-row align="center"><tg-button type="url" style="primary" url="${escapeHtmlAttribute(href)}">View alerts</tg-button></tg-button-row>`
    ].join('');
}

// Telegram rejects local button links, so dev alerts omit the keyboard.
function keyboard(payload: DeliveryPayload):
    | {
          inline_keyboard: Array<
              Array<{
                  text: string;
                  url: string;
                  style?: 'primary' | 'success' | 'danger';
              }>
          >;
      }
    | undefined {
    const grouped = analyzePayload(payload).mode !== 'single';
    const href = telegramAlertUrl(payload);
    if (!href) return undefined;
    const inlineKeyboard: Array<
        Array<{
            text: string;
            url: string;
            style?: 'primary' | 'success' | 'danger';
        }>
    > = [
        [
            {
                text: grouped ? 'View alerts' : 'View alert',
                url: href,
                style: 'primary'
            }
        ]
    ];
    if (!grouped && payload.state === 'active') {
        inlineKeyboard.push([
            {text: 'Acknowledge', url: `${href}&action=acknowledge`},
            {text: 'Silence', url: `${href}&action=silence`}
        ]);
    }
    return {inline_keyboard: inlineKeyboard};
}

interface TelegramSendResponse {
    ok: boolean;
    result?: {message_id?: number};
    description?: string;
}

async function postTelegram<T = TelegramSendResponse>(
    token: string,
    method: string,
    body: Record<string, unknown>,
    organizationId: string
): Promise<
    | {state: 'ok'; data: T; httpStatus: number}
    | {state: 'failed'; errorMessage: string; httpStatus?: number}
> {
    const res = await postJsonWithTimeout(
        `${API_BASE}/bot${token}/${method}`,
        body,
        {organizationId}
    );
    if ('error' in res) {
        return {state: 'failed', errorMessage: res.error};
    }
    if (!res.ok) {
        return {
            state: 'failed',
            errorMessage: res.bodySnippet,
            httpStatus: res.status
        };
    }
    let data: T;
    try {
        data = JSON.parse(res.bodyText) as T;
    } catch {
        data = {} as T;
    }
    return {state: 'ok', data, httpStatus: res.status};
}

export const telegramBotAdapter: DeliveryAdapter = {
    provider: 'telegram_bot',

    // Validates bot token via getMe before Channel.Test sends a real msg.
    async verify(context: DeliveryContext): Promise<void> {
        const token = readConfigString(context.config, 'botToken');
        if (!token) throw new Error('Telegram bot token is not configured');
        const previewError = rejectExternalPreviewToken(token);
        if (previewError) throw new Error(previewError);
        const res = await postTelegram(
            token,
            'getMe',
            {},
            context.organizationId
        );
        if (res.state !== 'ok') {
            throw new Error(
                `Telegram getMe failed${res.httpStatus ? ` (HTTP ${res.httpStatus})` : ''}: ${res.errorMessage}`
            );
        }
    },

    async send(
        payload: DeliveryPayload,
        context: DeliveryContext
    ): Promise<DeliveryResult> {
        const token = readConfigString(context.config, 'botToken');
        const chatId = readConfigString(context.config, 'chatId');
        if (!token) {
            return {
                state: 'failed',
                errorMessage:
                    'Telegram bot token is not configured for this endpoint'
            };
        }
        const previewError = rejectExternalPreviewToken(token);
        if (previewError) {
            return {state: 'failed', errorMessage: previewError};
        }
        if (!chatId) {
            return {
                state: 'failed',
                errorMessage: 'Telegram chatId is required in endpoint config'
            };
        }
        const template =
            typeof context.config.messageTemplate === 'string'
                ? context.config.messageTemplate
                : undefined;
        const mode = parseMode(context.config);
        const {text, parseMode: effectiveMode} = renderMessage(
            payload,
            template,
            mode
        );
        const markup = keyboard(payload);
        const href = telegramAlertUrl(payload);
        const info = analyzePayload(payload);
        const richMessage =
            href && !template
                ? {
                      html:
                          info.mode === 'single'
                              ? richAlertHtml(payload, href)
                              : richGroupedAlertHtml(payload, href)
                  }
                : undefined;

        // State-change on an already-delivered alert → edit in place.
        const previousMessageId = context.previousSuccessfulProviderCode;
        if (previousMessageId && payload.state !== 'active') {
            const id = Number.parseInt(previousMessageId, 10);
            if (Number.isInteger(id) && id > 0) {
                const editBody = richMessage
                    ? {
                          chat_id: chatId,
                          message_id: id,
                          rich_message: richMessage
                      }
                    : {
                          chat_id: chatId,
                          message_id: id,
                          text,
                          ...(effectiveMode ? {parse_mode: effectiveMode} : {}),
                          ...(markup ? {reply_markup: markup} : {})
                      };
                const edit = await postTelegram(
                    token,
                    'editMessageText',
                    editBody,
                    payload.organizationId
                );
                if (edit.state === 'ok') {
                    return {
                        state: 'succeeded',
                        httpStatus: edit.httpStatus,
                        providerCode: previousMessageId
                    };
                }
                // Fall through to fresh send on edit failure.
            }
        }

        if (richMessage) {
            const rich = await postTelegram(
                token,
                'sendRichMessage',
                {chat_id: chatId, rich_message: richMessage},
                payload.organizationId
            );
            if (rich.state === 'ok') {
                const messageId = rich.data.result?.message_id;
                return {
                    state: 'succeeded',
                    httpStatus: rich.httpStatus,
                    providerCode:
                        typeof messageId === 'number' ? String(messageId) : null
                };
            }
        }

        const res = await postTelegram(
            token,
            'sendMessage',
            {
                chat_id: chatId,
                text,
                ...(effectiveMode ? {parse_mode: effectiveMode} : {}),
                ...(markup ? {reply_markup: markup} : {})
            },
            payload.organizationId
        );
        if (res.state !== 'ok') {
            return {
                state: 'failed',
                errorMessage: res.errorMessage,
                httpStatus: res.httpStatus
            };
        }
        const messageId = res.data.result?.message_id;
        return {
            state: 'succeeded',
            httpStatus: res.httpStatus,
            providerCode:
                typeof messageId === 'number' ? String(messageId) : null
        };
    }
};
