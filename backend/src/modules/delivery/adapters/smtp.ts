// SMTP delivery via nodemailer. Preset → host/port/secure. Auth fields
// (auth.pass / auth.clientSecret / auth.refreshToken) come merged in
// from the encrypted secret payload.
import * as log4js from 'log4js';
import {envBool, envInt, envStr} from '../../../config/envReader';
import type {EmailAttachment} from '../../../types/api/_shared';
import {getSmtpPreset} from '../../../types/api/smtpPresets';
import {
    type PooledEmailSendResult,
    type PooledEmailTransportConfig,
    sendPooledEmail,
    verifyPooledEmailTransport
} from '../../email/EmailProvider';
import {runBoundedParallel} from '../../util/runBoundedParallel';
import {
    getAttachmentCacheEntry,
    setAttachmentCacheEntry
} from '../attachmentCache';
import {parseEmailAttachments} from '../emailAttachments';
import {resolveSystemNotificationSmtpConfig} from '../SystemSmtpConfig';
import type {
    DeliveryAdapter,
    DeliveryContext,
    DeliveryPayload,
    DeliveryResult
} from '../types';
import {withPublicFetch} from './_http';
import {templateObject} from './_template';
import {renderEmail, renderSubject} from './emailTemplate';

const logger = log4js.getLogger('SmtpAdapter');

const CONNECTION_TIMEOUT_DEFAULT = envInt(
    'FM_SMTP_CONNECTION_TIMEOUT_MS',
    10_000,
    1_000
);
const GREETING_TIMEOUT_DEFAULT = envInt(
    'FM_SMTP_GREETING_TIMEOUT_MS',
    10_000,
    1_000
);
const SOCKET_TIMEOUT_DEFAULT = envInt(
    'FM_SMTP_SOCKET_TIMEOUT_MS',
    30_000,
    1_000
);

// TLS floor — applied when endpoint config has no tls field.
const TLS_MIN_VERSION_DEFAULT: 'TLSv1.2' | 'TLSv1.3' =
    envStr('FM_SMTP_DEFAULT_TLS_MIN_VERSION', 'TLSv1.2') === 'TLSv1.3'
        ? 'TLSv1.3'
        : 'TLSv1.2';
const TLS_REJECT_UNAUTHORIZED_DEFAULT = envBool(
    'FM_SMTP_DEFAULT_TLS_REJECT_UNAUTHORIZED',
    true
);

// Pre-fetch attachments → nodemailer Buffer. Bounded by timeout+size cap.
const ATTACHMENT_HTTP_TIMEOUT_MS = envInt(
    'FM_EMAIL_ATTACHMENT_HTTP_TIMEOUT_MS',
    10_000,
    1_000
);
const ATTACHMENT_MAX_BYTES = envInt(
    'FM_EMAIL_ATTACHMENT_MAX_BYTES',
    5 * 1024 * 1024,
    1024
);
const ATTACHMENT_ALLOW_HTTP = envBool('FM_EMAIL_ATTACHMENT_ALLOW_HTTP', false);

type AuthType = 'password' | 'oauth2_google' | 'oauth2_microsoft';

interface PasswordAuth {
    type: 'password';
    user: string;
    pass: string;
}

interface OAuth2Auth {
    type: 'oauth2_google' | 'oauth2_microsoft';
    user: string;
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    /** Microsoft tenant id — only used by oauth2_microsoft. */
    tenant?: string;
}

interface DkimConfig {
    domainName: string;
    keySelector: string;
    privateKey: string;
}

interface SmtpConfig {
    host: string;
    port: number;
    secure: boolean;
    from: string;
    fromName?: string;
    toAddresses: string[];
    ccAddresses?: string[];
    bccAddresses?: string[];
    replyTo?: string;
    priority: 'high' | 'normal' | 'low';
    auth?: PasswordAuth | OAuth2Auth;
    tls: {minVersion: 'TLSv1.2' | 'TLSv1.3'; rejectUnauthorized: boolean};
    connectionTimeoutMs: number;
    greetingTimeoutMs: number;
    socketTimeoutMs: number;
    subjectTemplate?: string;
    htmlTemplate?: string;
    textTemplate?: string;
    attachments: EmailAttachment[];
    dkim?: DkimConfig;
}

type SmtpMode = 'custom_smtp' | 'use_system_smtp';

// OAuth2 token endpoints — override for sovereign Microsoft clouds.
// `{tenant}` in the MS template is substituted at request time.
const GOOGLE_TOKEN_URL = envStr(
    'FM_SMTP_OAUTH2_GOOGLE_TOKEN_URL',
    'https://oauth2.googleapis.com/token'
);
const MICROSOFT_TOKEN_URL_TEMPLATE = envStr(
    'FM_SMTP_OAUTH2_MICROSOFT_TOKEN_URL_TEMPLATE',
    'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token'
);

function microsoftTokenUrl(tenant: string): string {
    return MICROSOFT_TOKEN_URL_TEMPLATE.replace(
        '{tenant}',
        encodeURIComponent(tenant)
    );
}

function stringOrUndefined(v: unknown): string | undefined {
    return typeof v === 'string' && v.length > 0 ? v : undefined;
}

// Reads auth.user, auth.pass, auth.clientId, auth.clientSecret,
// auth.refreshToken, auth.tenant straight off the merged config.
function buildAuth(
    type: AuthType,
    rawAuth: Record<string, unknown> | undefined
): PasswordAuth | OAuth2Auth | undefined {
    const user = rawAuth ? stringOrUndefined(rawAuth.user) : undefined;
    if (!user) return undefined;
    if (type === 'password') {
        const pass = rawAuth ? stringOrUndefined(rawAuth.pass) : undefined;
        return pass ? {type: 'password', user, pass} : undefined;
    }
    const clientId = rawAuth ? stringOrUndefined(rawAuth.clientId) : undefined;
    const clientSecret = rawAuth
        ? stringOrUndefined(rawAuth.clientSecret)
        : undefined;
    const refreshToken = rawAuth
        ? stringOrUndefined(rawAuth.refreshToken)
        : undefined;
    if (!clientId || !clientSecret || !refreshToken) return undefined;
    if (type === 'oauth2_microsoft') {
        const tenant =
            (rawAuth && stringOrUndefined(rawAuth.tenant)) || 'common';
        return {
            type: 'oauth2_microsoft',
            user,
            clientId,
            clientSecret,
            refreshToken,
            tenant
        };
    }
    return {type: 'oauth2_google', user, clientId, clientSecret, refreshToken};
}

/** Build the nodemailer auth block from our typed config. Nodemailer's
 *  `type: 'OAuth2'` path auto-refreshes the access token via the token
 *  URL we pass — no extra scheduling needed on our side. */
function toNodemailerAuth(cfg: SmtpConfig):
    | {user: string; pass: string}
    | {
          type: 'OAuth2';
          user: string;
          clientId: string;
          clientSecret: string;
          refreshToken: string;
          accessUrl: string;
      }
    | undefined {
    const a = cfg.auth;
    if (!a) return undefined;
    if (a.type === 'password') {
        return {user: a.user, pass: a.pass};
    }
    return {
        type: 'OAuth2',
        user: a.user,
        clientId: a.clientId,
        clientSecret: a.clientSecret,
        refreshToken: a.refreshToken,
        accessUrl:
            a.type === 'oauth2_microsoft'
                ? microsoftTokenUrl(a.tenant ?? 'common')
                : GOOGLE_TOKEN_URL
    };
}

function parseConfig(raw: Record<string, unknown>): SmtpConfig {
    return parseResolvedConfig(resolveSmtpModeConfig(raw));
}

function resolveSmtpModeConfig(
    raw: Record<string, unknown>
): Record<string, unknown> {
    const mode = smtpMode(raw.mode);
    if (mode === 'custom_smtp') return raw;
    return {
        ...resolveSystemNotificationSmtpConfig(),
        ...pickSystemModeMessageConfig(raw)
    };
}

function smtpMode(value: unknown): SmtpMode {
    return value === 'use_system_smtp' ? 'use_system_smtp' : 'custom_smtp';
}

function pickSystemModeMessageConfig(
    raw: Record<string, unknown>
): Record<string, unknown> {
    const keys = [
        'toAddresses',
        'ccAddresses',
        'bccAddresses',
        'replyTo',
        'priority',
        'subjectTemplate',
        'htmlTemplate',
        'textTemplate',
        'attachments'
    ] as const;
    const result: Record<string, unknown> = {};
    for (const key of keys) {
        if (raw[key] !== undefined) result[key] = raw[key];
    }
    return result;
}

function parseResolvedConfig(raw: Record<string, unknown>): SmtpConfig {
    const preset = getSmtpPreset(
        typeof raw.preset === 'string' ? raw.preset : undefined
    );

    // Explicit values on the endpoint override the preset.
    const host = stringOrUndefined(raw.host) ?? preset?.host ?? '';
    const portNum =
        typeof raw.port === 'number' && Number.isFinite(raw.port)
            ? raw.port
            : preset?.port;
    const secure =
        typeof raw.secure === 'boolean' ? raw.secure : (preset?.secure ?? true);

    const from = stringOrUndefined(raw.from) ?? '';
    const fromName = stringOrUndefined(raw.fromName);
    const replyTo = stringOrUndefined(raw.replyTo);
    const stringList = (v: unknown): string[] =>
        Array.isArray(v)
            ? v.filter((x): x is string => typeof x === 'string')
            : [];
    const toAddresses = stringList(raw.toAddresses);
    const ccAddresses = stringList(raw.ccAddresses);
    const bccAddresses = stringList(raw.bccAddresses);
    const priority: SmtpConfig['priority'] =
        raw.priority === 'high' || raw.priority === 'low'
            ? raw.priority
            : 'normal';

    if (
        !host ||
        typeof portNum !== 'number' ||
        !from ||
        toAddresses.length === 0
    ) {
        throw new Error(
            'SMTP config requires host (or non-custom preset), port, from, and at least one toAddress'
        );
    }

    const rawAuth =
        typeof raw.auth === 'object' && raw.auth !== null
            ? (raw.auth as Record<string, unknown>)
            : undefined;
    const authType: AuthType =
        rawAuth?.type === 'oauth2_google' ||
        rawAuth?.type === 'oauth2_microsoft'
            ? rawAuth.type
            : 'password';
    const auth = buildAuth(authType, rawAuth);

    const rawTls =
        typeof raw.tls === 'object' && raw.tls !== null
            ? (raw.tls as Record<string, unknown>)
            : {};
    // Always set tls — either from the endpoint config or the ENV-backed
    // floor. Removes the fallback duplication in buildTransporter.
    const tls = {
        minVersion:
            rawTls.minVersion === 'TLSv1.3' || rawTls.minVersion === 'TLSv1.2'
                ? (rawTls.minVersion as 'TLSv1.2' | 'TLSv1.3')
                : TLS_MIN_VERSION_DEFAULT,
        rejectUnauthorized:
            typeof rawTls.rejectUnauthorized === 'boolean'
                ? rawTls.rejectUnauthorized
                : TLS_REJECT_UNAUTHORIZED_DEFAULT
    };

    return {
        host,
        port: portNum,
        secure,
        from,
        fromName,
        toAddresses,
        ccAddresses: ccAddresses.length > 0 ? ccAddresses : undefined,
        bccAddresses: bccAddresses.length > 0 ? bccAddresses : undefined,
        replyTo,
        priority,
        auth,
        tls,
        connectionTimeoutMs:
            typeof raw.connectionTimeoutMs === 'number'
                ? raw.connectionTimeoutMs
                : CONNECTION_TIMEOUT_DEFAULT,
        greetingTimeoutMs:
            typeof raw.greetingTimeoutMs === 'number'
                ? raw.greetingTimeoutMs
                : GREETING_TIMEOUT_DEFAULT,
        socketTimeoutMs:
            typeof raw.socketTimeoutMs === 'number'
                ? raw.socketTimeoutMs
                : SOCKET_TIMEOUT_DEFAULT,
        subjectTemplate: stringOrUndefined(raw.subjectTemplate),
        htmlTemplate: stringOrUndefined(raw.htmlTemplate),
        textTemplate: stringOrUndefined(raw.textTemplate),
        attachments: parseEmailAttachments(raw.attachments),
        dkim: parseDkim(raw.dkim)
    };
}

// All three fields are required together — partial dkim is silently dropped.
function parseDkim(raw: unknown): DkimConfig | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const rec = raw as Record<string, unknown>;
    const domainName = stringOrUndefined(rec.domainName);
    const keySelector = stringOrUndefined(rec.keySelector);
    const privateKey = stringOrUndefined(rec.privateKey);
    if (!domainName || !keySelector || !privateKey) return undefined;
    return {domainName, keySelector, privateKey};
}

function isAllowedAttachmentUrl(url: string): boolean {
    if (url.startsWith('https://')) return true;
    return ATTACHMENT_ALLOW_HTTP && url.startsWith('http://');
}

function attachmentUrlForError(url: string): string {
    try {
        const parsed = new URL(url);
        parsed.search = '';
        parsed.hash = '';
        return parsed.toString();
    } catch {
        return 'invalid-url';
    }
}

interface NodemailerAttachment {
    filename: string;
    content: Buffer;
    cid?: string;
    contentType?: string;
}

// Fetch seam for tests (avoids globalThis patching under tsx).
type FetchLike = typeof fetch;
let _fetchImpl: FetchLike = (...args) => fetch(...args);
export function __setAttachmentFetchForTests(impl: FetchLike | null): void {
    _fetchImpl = impl ?? ((...args) => fetch(...args));
}

async function fetchAttachmentBytes(
    organizationId: string,
    url: string
): Promise<Buffer> {
    const cacheKey = `url://${organizationId}/${url}`;
    const cached = getAttachmentCacheEntry(cacheKey);
    if (cached) return cached;
    const controller = new AbortController();
    const timer = setTimeout(
        () => controller.abort(),
        ATTACHMENT_HTTP_TIMEOUT_MS
    );
    try {
        const buf = await withPublicFetch(
            url,
            {
                signal: controller.signal,
                headers: {accept: '*/*'},
                redirect: 'error'
            },
            async (res) => {
                if (!res.ok) {
                    throw new Error(
                        `HTTP ${res.status} fetching ${attachmentUrlForError(url)}`
                    );
                }
                const declared = Number(res.headers.get('content-length') ?? 0);
                if (declared > ATTACHMENT_MAX_BYTES) {
                    throw new Error(
                        `attachment exceeds FM_EMAIL_ATTACHMENT_MAX_BYTES (${declared} > ${ATTACHMENT_MAX_BYTES})`
                    );
                }
                const reader = res.body?.getReader();
                if (!reader) {
                    const bytes = Buffer.from(await res.arrayBuffer());
                    if (bytes.byteLength > ATTACHMENT_MAX_BYTES) {
                        throw new Error(
                            `attachment exceeds FM_EMAIL_ATTACHMENT_MAX_BYTES (>${ATTACHMENT_MAX_BYTES})`
                        );
                    }
                    return bytes;
                }
                const chunks: Uint8Array[] = [];
                let total = 0;
                while (true) {
                    const {done, value} = await reader.read();
                    if (done) break;
                    total += value.byteLength;
                    if (total > ATTACHMENT_MAX_BYTES) {
                        controller.abort();
                        throw new Error(
                            `attachment exceeds FM_EMAIL_ATTACHMENT_MAX_BYTES (>${ATTACHMENT_MAX_BYTES})`
                        );
                    }
                    chunks.push(value);
                }
                return Buffer.concat(chunks.map((c) => Buffer.from(c)));
            },
            _fetchImpl
        );
        setAttachmentCacheEntry(cacheKey, buf);
        return buf;
    } finally {
        clearTimeout(timer);
    }
}

// URL attachments: scheme allow-list runs first (sync), so a bad URL
// fails before any network I/O. Asset attachments: one DB read per
// asset, no allow-list (the upload route already enforced MIME + size).
async function resolveAttachments(
    list: EmailAttachment[],
    organizationId: string
): Promise<NodemailerAttachment[] | undefined> {
    if (list.length === 0) return undefined;
    for (const a of list) {
        if (a.url && !isAllowedAttachmentUrl(a.url)) {
            throw new Error(
                `attachment URL scheme not allowed for ${a.filename} — set FM_EMAIL_ATTACHMENT_ALLOW_HTTP=true to permit http://`
            );
        }
    }
    // Email send: surface a bad attachment fast rather than wait on the rest.
    const ATTACHMENT_FETCH_CONCURRENCY = 5;
    const settled = await runBoundedParallel({
        tasks: list,
        run: async (a) => {
            const entry: NodemailerAttachment = {
                filename: a.filename,
                content: a.assetId
                    ? await fetchAssetBytes(organizationId, a.assetId)
                    : await fetchAttachmentBytes(
                          organizationId,
                          a.url as string
                      )
            };
            if (a.cid) entry.cid = a.cid;
            if (a.contentType) entry.contentType = a.contentType;
            return entry;
        },
        concurrency: ATTACHMENT_FETCH_CONCURRENCY,
        perTaskTimeoutMs: ATTACHMENT_HTTP_TIMEOUT_MS,
        label: 'smtp-attachment-fetch',
        failFast: true
    });
    return settled
        .filter(
            (r): r is PromiseFulfilledResult<NodemailerAttachment> =>
                r.status === 'fulfilled'
        )
        .map((r) => r.value);
}

type GetAssetBytesFn = (
    organizationId: string,
    assetId: number
) => Promise<
    {filename: string; contentType: string; bytes: Buffer} | undefined
>;
let _getAssetBytes: GetAssetBytesFn | undefined;
async function getAssetBytesImpl(): Promise<GetAssetBytesFn> {
    if (!_getAssetBytes) {
        _getAssetBytes = (await import('../emailAssets.js')).getAssetBytes;
    }
    return _getAssetBytes as GetAssetBytesFn;
}
export function __setAssetBytesForTests(impl: GetAssetBytesFn | null): void {
    _getAssetBytes = impl ?? undefined;
}

async function fetchAssetBytes(
    organizationId: string,
    assetId: number
): Promise<Buffer> {
    const key = `asset://${organizationId}/${assetId}`;
    const cached = getAttachmentCacheEntry(key);
    if (cached) return cached;
    const asset = await (await getAssetBytesImpl())(organizationId, assetId);
    if (!asset) {
        throw new Error(
            `email asset ${assetId} not found for org ${organizationId}`
        );
    }
    setAttachmentCacheEntry(key, asset.bytes);
    return asset.bytes;
}

function buildTransportConfig(cfg: SmtpConfig): PooledEmailTransportConfig {
    return {
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        // When not using implicit TLS we require STARTTLS — refuses to
        // fall back to plain text if the server strips it.
        requireTLS: !cfg.secure,
        auth: toNodemailerAuth(cfg),
        tls: cfg.tls,
        connectionTimeout: cfg.connectionTimeoutMs,
        greetingTimeout: cfg.greetingTimeoutMs,
        socketTimeout: cfg.socketTimeoutMs,
        dkim: cfg.dkim
    };
}

// Let nodemailer handle RFC 5322 quoting — manual "Name" <addr@...>
// breaks on quotes/unicode in the display name.
function formatFrom(cfg: SmtpConfig): {name: string; address: string} | string {
    return cfg.fromName ? {name: cfg.fromName, address: cfg.from} : cfg.from;
}

// The transport resolves even when the server rejects recipients. A full
// bounce is a failure; a partial bounce stays a success (retrying would
// double-send to the accepted recipients) but is logged so the drop is visible.
export function resultFromSendInfo(
    info: PooledEmailSendResult,
    endpointName: string
): DeliveryResult {
    if (info.accepted.length === 0 && info.rejected.length > 0) {
        return {
            state: 'failed',
            errorMessage: `all ${info.rejected.length} recipient(s) rejected by SMTP server${info.response ? `: ${info.response}` : ''}`
        };
    }
    if (info.rejected.length > 0) {
        logger.warn(
            'SMTP partial delivery for endpoint %s — accepted %d, rejected %s',
            endpointName,
            info.accepted.length,
            info.rejected.join(', ')
        );
    }
    return {state: 'succeeded', providerCode: info.messageId ?? null};
}

export const smtpAdapter: DeliveryAdapter = {
    provider: 'email_smtp',

    async verify(context: DeliveryContext): Promise<void> {
        const cfg = parseConfig(context.config);
        await verifyPooledEmailTransport(buildTransportConfig(cfg));
    },

    async send(
        payload: DeliveryPayload,
        context: DeliveryContext
    ): Promise<DeliveryResult> {
        try {
            const cfg = parseConfig(context.config);
            // Rule template (if any) provides the already-rendered subject/
            // html/text and wins over the endpoint's own templates.
            const ruleEmail = templateObject(context);
            const useRule =
                ruleEmail !== undefined &&
                !Array.isArray(ruleEmail) &&
                typeof ruleEmail.subject === 'string';
            const rendered = useRule
                ? {
                      html:
                          typeof ruleEmail.html === 'string'
                              ? ruleEmail.html
                              : undefined,
                      text:
                          typeof ruleEmail.text === 'string'
                              ? ruleEmail.text
                              : ''
                  }
                : renderEmail(payload, cfg.htmlTemplate, cfg.textTemplate);
            const subject = useRule
                ? String(ruleEmail.subject)
                : renderSubject(payload, cfg.subjectTemplate);
            // Resolve attachments BEFORE opening the SMTP conversation —
            // fetch errors fail cleanly without a half-written message.
            const attachments = await resolveAttachments(
                cfg.attachments,
                context.organizationId
            );
            const info = await sendPooledEmail(buildTransportConfig(cfg), {
                from: formatFrom(cfg),
                to: cfg.toAddresses.join(', '),
                cc: cfg.ccAddresses?.join(', '),
                bcc: cfg.bccAddresses?.join(', '),
                replyTo: cfg.replyTo,
                priority: cfg.priority,
                subject,
                text: rendered.text,
                html: rendered.html,
                attachments
            });
            return resultFromSendInfo(info, context.endpointName);
        } catch (err) {
            return {
                state: 'failed',
                errorMessage: err instanceof Error ? err.message : String(err)
            };
        }
    }
};
