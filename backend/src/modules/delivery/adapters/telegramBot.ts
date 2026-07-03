// Telegram Bot API — sendMessage / editMessageText / getMe. botToken is
// a secret merged into config by the outbox before this adapter runs.

import {envInt, envStr} from '../../../config/envReader';
import {buildDeliveryContext} from '../../alert/templateContext';
import {
    renderTemplate,
    type TemplateEscapeMode
} from '../../alert/templateRenderer';
import {alertHref} from '../alertLink';
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

function singleLine(p: DeliveryPayload): string {
    const head = `${severityEmoji(p.severity)} ${severityLabel(p.severity)}`;
    const state = stateBadge(p.state);
    const tail = state ? ` · ${state}` : '';
    return `${head}: ${p.title}${tail}\n\n${p.message}`;
}

function defaultMessage(payload: DeliveryPayload): string {
    const info = analyzePayload(payload);
    if (info.mode === 'single') return singleLine(payload);
    if (info.mode === 'summary') {
        return `${severityEmoji(payload.severity)} ${summaryLine(info.aggregate)}\nRule: ${payload.ruleName}`;
    }
    // list mode
    const header = `${severityEmoji(payload.severity)} ${info.alerts.length} alerts · ${payload.ruleName}`;
    const lines = info.alerts
        .slice(0, 20)
        .map(
            (a) =>
                `• ${severityEmoji(a.severity)} ${a.title}${a.source ? ` (${a.source.subjectId})` : ''}`
        );
    return `${header}\n${lines.join('\n')}`;
}

// Precedence: per-endpoint messageTemplate → FM_TELEGRAM_DEFAULT_TEMPLATE
// → built-in structured default. parse_mode only applies to a template
// (escaped for the mode); the built-in default is plain text, so sending it
// with parse_mode set would 400 on unescaped chars in the title/message.
function renderMessage(
    payload: DeliveryPayload,
    template: string | undefined,
    mode: ParseMode | undefined
): {text: string; parseMode: ParseMode | undefined} {
    const effective = template || DEFAULT_TEMPLATE_OVERRIDE;
    if (!effective)
        return {text: clamp(defaultMessage(payload)), parseMode: undefined};
    const rendered = renderTemplate(effective, buildDeliveryContext(payload), {
        escapeMode: escapeModeFor(mode)
    }).rendered;
    return {text: clamp(rendered), parseMode: mode};
}

function clamp(text: string): string {
    if (text.length <= MESSAGE_MAX_CHARS) return text;
    return `${text.slice(0, MESSAGE_MAX_CHARS - 1)}…`;
}

// "Open alert" inline keyboard; undefined when FM_ALERT_LINK_BASE unset.
function keyboard(
    payload: DeliveryPayload
): {inline_keyboard: Array<Array<{text: string; url: string}>>} | undefined {
    const href = alertHref(payload.alertId);
    if (!href) return undefined;
    return {inline_keyboard: [[{text: 'Open alert', url: href}]]};
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

        // State-change on an already-delivered alert → edit in place.
        const previousMessageId = context.previousSuccessfulProviderCode;
        if (previousMessageId && payload.state !== 'active') {
            const id = Number.parseInt(previousMessageId, 10);
            if (Number.isInteger(id) && id > 0) {
                const edit = await postTelegram(
                    token,
                    'editMessageText',
                    {
                        chat_id: chatId,
                        message_id: id,
                        text,
                        ...(effectiveMode ? {parse_mode: effectiveMode} : {}),
                        ...(markup ? {reply_markup: markup} : {})
                    },
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
