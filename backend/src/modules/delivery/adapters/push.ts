// Push adapter shell. Per-platform renderers + provider dispatch.
// Concrete HTTP delivery is injected so unit tests can run without
// hitting FCM/APNs/web-push providers.

import {createHmac, timingSafeEqual} from 'node:crypto';
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
    const canonical = toCanonical(req.payload);
    const wire = renderForPlatform(
        req.token.platform,
        canonical,
        req.actionSigningKey
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

export function renderForPlatform(
    platform: PushPlatform,
    canonical: CanonicalAlertPayload,
    signingKey: string
): Record<string, unknown> {
    const signedActions = signActions(canonical.actions, signingKey);
    switch (platform) {
        case 'ios':
            return renderApns(canonical, signedActions);
        case 'android':
            return renderFcm(canonical, signedActions);
        case 'webpush':
            return renderWebPush(canonical, signedActions);
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
    actions: SignedAction[]
): Record<string, unknown> {
    return {
        aps: {
            alert: {title: c.title, body: c.body},
            category: `alert_${c.severity}`,
            sound: c.severity === 'critical' ? 'critical.caf' : 'default',
            'thread-id': c.source?.subjectId ?? 'fleet'
        },
        fm: {
            severity: c.severity,
            state: c.state,
            actions,
            labels: c.labels,
            firedAt: c.firedAt
        }
    };
}

function renderFcm(
    c: CanonicalAlertPayload,
    actions: SignedAction[]
): Record<string, unknown> {
    return {
        message: {
            notification: {title: c.title, body: c.body},
            android: {
                priority: c.severity === 'critical' ? 'HIGH' : 'NORMAL',
                notification: {
                    channel_id: `alert_${c.severity}`,
                    tag: c.source?.subjectId ?? 'fleet'
                }
            },
            data: {
                severity: c.severity,
                state: c.state,
                actions: JSON.stringify(actions),
                firedAt: c.firedAt
            }
        }
    };
}

function renderWebPush(
    c: CanonicalAlertPayload,
    actions: SignedAction[]
): Record<string, unknown> {
    return {
        notification: {
            title: c.title,
            body: c.body,
            tag: c.source?.subjectId ?? 'fleet',
            requireInteraction: c.severity === 'critical',
            actions: actions.slice(0, 2).map((a) => ({
                action: `${a.id}|${a.sig}`,
                title: a.label
            })),
            data: {
                severity: c.severity,
                state: c.state,
                firedAt: c.firedAt
            }
        }
    };
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
