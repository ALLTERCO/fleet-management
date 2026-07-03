// FCM v1 push adapter. Project ID + OAuth2 bearer from env:
//   FM_PUSH_FCM_PROJECT_ID       — Google Cloud project id
//   FM_PUSH_FCM_SERVICE_ACCOUNT  — service-account JSON; FM mints + caches the
//                                  bearer from it (preferred)
//   FM_PUSH_FCM_ACCESS_TOKEN     — pre-minted static bearer (fallback; ~1h ttl)

import {envCred, readString} from '../../util/objectReaders';
import type {DeliveryAdapter, DeliveryResult} from '../types';
import {resolveFcmAccessToken} from './fcmAuth';
import {type PushPlatform, type PushProviderSendFn, sendPush} from './push';

const FETCH_TIMEOUT_MS = 30_000;

function isPlatform(v: string): v is PushPlatform {
    return v === 'ios' || v === 'android' || v === 'webpush';
}

// Static token wins; otherwise mint from the service account. A mint failure
// degrades to null so send() reports "not configured" rather than throwing.
async function acquireFcmToken(): Promise<string | null> {
    try {
        return await resolveFcmAccessToken({
            staticToken: envCred('FM_PUSH_FCM_ACCESS_TOKEN') || undefined,
            serviceAccountJson:
                envCred('FM_PUSH_FCM_SERVICE_ACCOUNT') || undefined
        });
    } catch {
        return null;
    }
}

export const pushFcmAdapter: DeliveryAdapter = {
    provider: 'push_fcm',
    async send(payload, context): Promise<DeliveryResult> {
        const projectId = envCred('FM_PUSH_FCM_PROJECT_ID');
        const actionSigningKey = envCred('FM_PUSH_ACTION_SIGNING_KEY');
        const accessToken = await acquireFcmToken();
        if (!projectId || !accessToken) {
            return {
                state: 'failed',
                errorMessage:
                    'FCM not configured — set FM_PUSH_FCM_PROJECT_ID and FM_PUSH_FCM_SERVICE_ACCOUNT (or FM_PUSH_FCM_ACCESS_TOKEN).'
            };
        }
        if (!actionSigningKey) {
            return {
                state: 'failed',
                errorMessage:
                    'FM_PUSH_ACTION_SIGNING_KEY not set — required to sign action buttons.'
            };
        }
        const token = readString(context.config, 'token');
        const platformRaw = readString(context.config, 'platform');
        const envName = readString(context.config, 'env') || 'prod';
        if (!token || !isPlatform(platformRaw)) {
            return {
                state: 'failed',
                errorMessage: 'push_fcm config missing token or platform.'
            };
        }
        const providerSend: PushProviderSendFn = async ({wire}) => {
            const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
            const wireMessage =
                (wire as {message?: Record<string, unknown>}).message ?? wire;
            const messageWithToken = {
                ...(wireMessage as Record<string, unknown>),
                token
            };
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({message: messageWithToken}),
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
            });
            if (res.ok) {
                const data = (await res.json().catch(() => ({}))) as {
                    name?: string;
                };
                return {
                    success: true,
                    providerMessageId: data.name,
                    httpStatus: res.status
                };
            }
            const text = await res.text().catch(() => '');
            // Only a dead token (UNREGISTERED / 404) revokes. INVALID_ARGUMENT
            // is FCM's catch-all 400 for any malformed field, so it must NOT
            // mark an otherwise-valid token for deletion.
            const tokenInvalid =
                res.status === 404 || /UNREGISTERED/i.test(text);
            return {
                success: false,
                tokenInvalid,
                retryable: res.status >= 500 || res.status === 429,
                errorMessage: `fcm ${res.status}: ${text.slice(0, 200)}`,
                httpStatus: res.status
            };
        };
        const result = await sendPush(
            {
                token: {
                    platform: platformRaw,
                    token,
                    env: envName === 'sandbox' ? 'sandbox' : 'prod'
                },
                payload,
                actionSigningKey
            },
            providerSend
        );
        if (result.success) {
            return {
                state: 'succeeded',
                providerCode: result.providerMessageId ?? null,
                httpStatus: result.httpStatus ?? null
            };
        }
        return {
            state: 'failed',
            errorMessage: result.errorMessage ?? 'push send failed',
            retryAfterSec: result.retryable ? 60 : null,
            httpStatus: result.httpStatus ?? null
        };
    }
};
