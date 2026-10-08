// Push adapter shell. Per-platform renderers + provider dispatch.
// Concrete HTTP delivery is injected so unit tests can run without
// hitting FCM/APNs/web-push providers.

import {createHmac, timingSafeEqual} from 'node:crypto';
import {analyzePayload, summaryLine} from '../groupedRender';
import {stateLabel} from '../notificationDisplay';
import {type CanonicalAlertPayload, toCanonical} from '../render/canonical';
import type {DeliveryPayload} from '../types';

export type PushPlatform = 'ios' | 'android' | 'webpush';

export interface PushToken {
    platform: PushPlatform;
    token: string;
    env?: 'prod' | 'sandbox';
}

export interface PushDeliveryRequest {
    token: PushToken;
    payload: DeliveryPayload;
    /** HMAC secret used to sign action button ids. */
    actionSigningKey: string;
    /** False for a custom fallback whose body already owns presentation. */
    useStandardPresentation?: boolean;
}

export interface PushDeliveryResult {
    success: boolean;
    providerMessageId?: string;
    /** Provider reports the token as invalid (caller should revoke). */
    tokenInvalid?: boolean;
    /** Provider transient failure (caller should retry). */
    retryable?: boolean;
    errorMessage?: string;
    httpStatus?: number;
}

export type PushProviderSendFn = (params: {
    platform: PushPlatform;
    env: 'prod' | 'sandbox';
    token: string;
    wire: Record<string, unknown>;
}) => Promise<PushDeliveryResult>;

// APNs single notification payload cap.
export const APNS_MAX_PAYLOAD_BYTES = 4096;
// FCM notification message cap.
export const FCM_MAX_PAYLOAD_BYTES = 4096;
// Web Push (RFC 8030) recommends keeping each push <= 4 KB.
export const WEBPUSH_MAX_PAYLOAD_BYTES = 4096;

export async function sendPush(
    req: PushDeliveryRequest,
    providerSend: PushProviderSendFn
): Promise<PushDeliveryResult> {
    const presentationPayload =
        req.useStandardPresentation === false
            ? req.payload
            : groupedPushPayload(req.payload);
    const canonical = toCanonical(presentationPayload);
    const wire = renderForPlatform(
        req.token.platform,
        canonical,
        req.actionSigningKey,
        req.useStandardPresentation ?? true
    );
    const sizeCap = sizeCapFor(req.token.platform);
    if (wireByteSize(wire) > sizeCap) {
        return {
            success: false,
            errorMessage: `payload exceeds ${sizeCap} bytes for ${req.token.platform}`
        };
    }
    return providerSend({
        platform: req.token.platform,
        env: req.token.env ?? 'prod',
        token: req.token.token,
        wire
    });
}

function groupedPushPayload(payload: DeliveryPayload): DeliveryPayload {
    const grouped = analyzePayload(payload);
    if (grouped.mode === 'single') return payload;
    return {
        ...payload,
        title: `${grouped.alerts.length} alerts · ${payload.ruleName}`,
        message:
            summaryLine(grouped.aggregate) || `${grouped.alerts.length} alerts`,
        alertId: null,
        firedAt: grouped.aggregate?.lastAt || payload.firedAt,
        source: null,
        deviceImageUrl: undefined
    };
}

export function renderForPlatform(
    platform: PushPlatform,
    canonical: CanonicalAlertPayload,
    signingKey: string,
    useStandardPresentation = true
): Record<string, unknown> {
    const signedActions = signActions(canonical.actions, signingKey);
    switch (platform) {
        case 'ios':
            return renderApns(
                canonical,
                signedActions,
                useStandardPresentation
            );
        case 'android':
            return renderFcm(canonical, signedActions, useStandardPresentation);
        case 'webpush':
            return renderWebPush(
                canonical,
                signedActions,
                useStandardPresentation
            );
    }
}

interface SignedAction {
    id: string;
    label: string;
    style?: 'primary' | 'danger' | 'default';
    sig: string;
}

// HMAC-SHA256 of action id with the channel signing key; receivers
// verify before calling Instance.{Acknowledge,Silence,ResolveManual}.
function signActions(
    actions: CanonicalAlertPayload['actions'],
    key: string
): SignedAction[] {
    return actions.map((a) => ({
        ...a,
        sig: createHmac('sha256', key).update(a.id).digest('hex').slice(0, 32)
    }));
}

function renderApns(
    c: CanonicalAlertPayload,
    actions: SignedAction[],
    useStandardPresentation: boolean
): Record<string, unknown> {
    return {
        message: {
            notification: {
                title: c.title,
                body: useStandardPresentation
                    ? notificationTime(c.firedAt)
                    : c.body,
                ...(c.imageUrl ? {image: c.imageUrl} : {})
            },
            apns: {
                payload: {
                    aps: {
                        alert: {
                            title: c.title,
                            ...(useStandardPresentation
                                ? {subtitle: notificationMetadata(c)}
                                : {}),
                            body: useStandardPresentation
                                ? notificationTime(c.firedAt)
                                : c.body
                        },
                        category: `alert_${c.severity}`,
                        sound:
                            c.severity === 'critical'
                                ? 'critical.caf'
                                : 'default',
                        'thread-id': c.source?.subjectId ?? 'fleet',
                        ...(c.imageUrl ? {'mutable-content': 1} : {})
                    }
                },
                ...(c.imageUrl ? {fcm_options: {image: c.imageUrl}} : {})
            },
            data: pushData(c, actions)
        }
    };
}

function renderFcm(
    c: CanonicalAlertPayload,
    actions: SignedAction[],
    useStandardPresentation: boolean
): Record<string, unknown> {
    return {
        message: {
            notification: {
                title: c.title,
                body: useStandardPresentation ? notificationBody(c) : c.body,
                ...(c.imageUrl ? {image: c.imageUrl} : {})
            },
            android: {
                priority: c.severity === 'critical' ? 'HIGH' : 'NORMAL',
                notification: {
                    channel_id: `alert_${c.severity}`,
                    tag: c.source?.subjectId ?? 'fleet',
                    ...(c.imageUrl ? {image: c.imageUrl} : {})
                }
            },
            data: pushData(c, actions)
        }
    };
}

function renderWebPush(
    c: CanonicalAlertPayload,
    actions: SignedAction[],
    useStandardPresentation: boolean
): Record<string, unknown> {
    return {
        message: {
            notification: {
                title: c.title,
                body: useStandardPresentation ? notificationBody(c) : c.body,
                ...(c.imageUrl ? {image: c.imageUrl} : {})
            },
            webpush: {
                notification: {
                    title: c.title,
                    body: useStandardPresentation
                        ? notificationBody(c)
                        : c.body,
                    tag: c.source?.subjectId ?? 'fleet',
                    requireInteraction: c.severity === 'critical',
                    ...(c.imageUrl ? {image: c.imageUrl} : {}),
                    actions: actions.slice(0, 2).map((a) => ({
                        action: `${a.id}|${a.sig}`,
                        title: a.label
                    }))
                }
            },
            data: pushData(c, actions)
        }
    };
}

function pushData(
    c: CanonicalAlertPayload,
    actions: SignedAction[]
): Record<string, string> {
    return {
        severity: c.severity,
        state: c.state,
        actions: JSON.stringify(actions),
        labels: JSON.stringify(c.labels),
        firedAt: c.firedAt,
        ...(c.imageUrl ? {imageUrl: c.imageUrl} : {})
    };
}

function notificationMetadata(c: CanonicalAlertPayload): string {
    return [stateLabel(c.state), c.source?.subjectId]
        .filter((value): value is string => Boolean(value))
        .join(' · ');
}

function notificationBody(c: CanonicalAlertPayload): string {
    const metadata = notificationMetadata(c);
    const time = notificationTime(c.firedAt);
    return metadata ? `${metadata}\n${time}` : time;
}

function notificationTime(value: string): string {
    const displayed =
        /(?:^|\s)(\d{1,2})\s+([A-Za-z]{3})(?:\s+\d{4})?\s*·\s*(\d{2}:\d{2})/.exec(
            value
        );
    if (displayed) return `${displayed[1]} ${displayed[2]} · ${displayed[3]}`;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const parts = new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'UTC'
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((entry) => entry.type === type)?.value ?? '';
    return `${part('day')} ${part('month')} · ${part('hour')}:${part('minute')}`;
}

function sizeCapFor(platform: PushPlatform): number {
    switch (platform) {
        case 'ios':
            return APNS_MAX_PAYLOAD_BYTES;
        case 'android':
            return FCM_MAX_PAYLOAD_BYTES;
        case 'webpush':
            return WEBPUSH_MAX_PAYLOAD_BYTES;
    }
}

function wireByteSize(wire: Record<string, unknown>): number {
    return Buffer.byteLength(JSON.stringify(wire), 'utf8');
}

// Action callback verification — receivers POST {id, sig} back.
export function verifyActionSignature(
    id: string,
    sig: string,
    signingKey: string
): boolean {
    const expected = createHmac('sha256', signingKey)
        .update(id)
        .digest('hex')
        .slice(0, 32);
    if (sig.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

// Decode an action id of the form "kind:alertId" → {kind, alertId}.
// Used by the push callback route to dispatch to Instance.{Ack,Silence,Resolve}.
export function decodeActionId(
    id: string
): {kind: 'ack' | 'snooze' | 'resolve'; alertId: number} | null {
    const m = /^(ack|snooze|resolve):(\d+)$/.exec(id);
    if (!m) return null;
    return {
        kind: m[1] as 'ack' | 'snooze' | 'resolve',
        alertId: Number(m[2])
    };
}
