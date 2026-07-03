// Discovery.AdmitDevice — configure a LAN-reachable Shelly's outbound WS
// at FM, reboot it, and record the auto-admission intent.

import log4js from 'log4js';
import {envStr} from '../../config/envReader';
import RpcError from '../../rpc/RpcError';
import {type DeviceHostTarget, deviceHostFromInput} from './deviceHostGuard';
import {digestAuth} from './digestAuth';
import {recordPendingAdmission} from './pendingAdmissionRepo';
import {
    fetchDeviceInfoOrUnavailable,
    rejectIfBadShape,
    type ShellyDeviceInfo
} from './probeHost';

const logger = log4js.getLogger('discovery-admit');

const DEFAULT_HTTP_TIMEOUT_MS = 5_000;
const REBOOT_DELAY_MS = 1_000;

export interface AdmitDeviceInput {
    host: string;
    password?: string;
    organizationId: string;
    actorId: string;
    groupId?: number;
    httpTimeoutMs?: number;
}

export interface AdmitDeviceResult {
    shellyId: string;
    gen: 2 | 3 | 4;
    rebootingMs: number;
    intentRecorded: true;
    expectedConnectionWithinSec: number;
}

interface RpcPostArgs {
    url: string;
    body: Record<string, unknown>;
    timeoutMs: number;
    password?: string;
}

// /rpc is the path Shelly Gen2+ exposes; the digest URI field MUST match.
const RPC_URI_PATH = '/rpc';

interface AdmissionIntent {
    info: ShellyDeviceInfo;
    target: DeviceHostTarget;
    input: AdmitDeviceInput;
    ttlSeconds: number;
}

// FM_DEVICE_WS_URL: device-facing override (LAN-reachable). Fallback derives
// from FM_PUBLIC_BASE_URL by swapping http→ws.
function outboundWsUrl(): string {
    const explicit = envStr('FM_DEVICE_WS_URL', '');
    if (explicit) return explicit;
    const pub = envStr('FM_PUBLIC_BASE_URL', '');
    if (pub) return `${pub.replace(/^http/, 'ws')}/shelly`;
    return 'ws://fleet-manager:7011/shelly';
}

function sslCaForOutboundWs(): string {
    return envStr('FM_DEVICE_WS_SSL_CA', '*');
}

function admissionTtlSeconds(): number {
    const raw = Number(envStr('FM_ADMISSION_TTL_SECONDS', '300'));
    return Number.isFinite(raw) && raw > 0 ? raw : 300;
}

// Single source of truth for device-side RPC error shape: every failure
// (network, non-OK, JSON-RPC error) exits as a typed RpcError tagged with
// the method name. Callers never need to wrap again.
async function rpcPost(args: RpcPostArgs): Promise<Record<string, unknown>> {
    const method = String(args.body.method ?? 'rpc');
    const response = await postWithOptionalDigest(args, method);
    return parseRpcResponse(response, method);
}

async function postWithOptionalDigest(
    args: RpcPostArgs,
    method: string
): Promise<Response> {
    const first = await postRaw(args, method);
    if (first.status !== 401) return first;
    if (!args.password) {
        await drainBody(first);
        throw authFailed(method, 'no-password');
    }
    return retryWithDigest(args, method, first);
}

async function retryWithDigest(
    args: RpcPostArgs,
    method: string,
    challenge: Response
): Promise<Response> {
    const wwwAuthenticate = challenge.headers.get('www-authenticate');
    await drainBody(challenge);
    if (!wwwAuthenticate) throw authFailed(method, 'no-challenge');
    const authorization = digestAuth({
        wwwAuthenticate,
        password: args.password!,
        method: 'POST',
        uri: RPC_URI_PATH
    });
    const retried = await postRaw(args, method, authorization);
    if (retried.status === 401) {
        await drainBody(retried);
        throw authFailed(method, 'rejected');
    }
    return retried;
}

// WHY: undici keeps the socket parked in the keep-alive pool until the
// response body is consumed or cancelled. 401-only Shelly bursts leak
// sockets without this drain.
async function drainBody(response: Response): Promise<void> {
    if (!response.body) return;
    try {
        await response.body.cancel();
    } catch {
        // already closed — nothing to do
    }
}

function authFailed(method: string, reason: string): RpcError {
    return RpcError.Domain('AuthFailed', {
        operation: method,
        details: {reason}
    });
}

async function postRaw(
    args: RpcPostArgs,
    method: string,
    authorization?: string
): Promise<Response> {
    const headers: Record<string, string> = {
        'content-type': 'application/json'
    };
    if (authorization) headers.authorization = authorization;
    try {
        return await fetch(args.url, {
            method: 'POST',
            headers,
            body: JSON.stringify(args.body),
            signal: AbortSignal.timeout(args.timeoutMs)
        });
    } catch (err) {
        throw RpcError.OperationFailed(method, err);
    }
}

async function parseRpcResponse(
    response: Response,
    method: string
): Promise<Record<string, unknown>> {
    if (!response.ok) {
        throw RpcError.Unavailable(
            'device',
            `HTTP ${response.status} on ${method}`
        );
    }
    const parsed = (await response.json()) as {
        result?: unknown;
        error?: {code?: number; message?: string};
    };
    if (parsed.error) {
        throw RpcError.OperationFailed(
            method,
            parsed.error.message ?? String(parsed.error.code ?? 'error')
        );
    }
    return (parsed.result ?? {}) as Record<string, unknown>;
}

// Admit needs auth to write; probe doesn't.
function rejectIfAuthMissingForMutation(
    info: ShellyDeviceInfo,
    input: AdmitDeviceInput
): void {
    if (info.auth_en === true && !input.password) {
        throw RpcError.Domain('AuthRequired', {
            shellyID: info.id,
            details: {authDomain: info.auth_domain ?? null}
        });
    }
}

interface DeviceCallContext {
    target: DeviceHostTarget;
    timeoutMs: number;
    password?: string;
}

async function configureOutboundWs(ctx: DeviceCallContext): Promise<void> {
    await rpcPost({
        url: `http://${ctx.target.ip}${RPC_URI_PATH}`,
        body: {
            id: 1,
            method: 'Ws.SetConfig',
            params: {
                config: {
                    enable: true,
                    server: outboundWsUrl(),
                    ssl_ca: sslCaForOutboundWs()
                }
            }
        },
        timeoutMs: ctx.timeoutMs,
        password: ctx.password
    });
}

// Gen2+ Ws.SetConfig only takes effect after reboot. A failed reboot must
// surface honestly so the caller knows the device never reconnected.
async function rebootDevice(ctx: DeviceCallContext): Promise<void> {
    try {
        await rpcPost({
            url: `http://${ctx.target.ip}${RPC_URI_PATH}`,
            body: {
                id: 2,
                method: 'Shelly.Reboot',
                params: {delay_ms: REBOOT_DELAY_MS}
            },
            timeoutMs: ctx.timeoutMs,
            password: ctx.password
        });
    } catch (err) {
        throw retagWithOperation(err, ADMIT_REBOOT_OPERATION);
    }
}

// Per-step operation tag — classifier reads errorData.operation to
// distinguish reboot-time failures from probe-time unreachable.
export const ADMIT_REBOOT_OPERATION = 'reboot';

function retagWithOperation(err: unknown, operation: string): unknown {
    if (!(err instanceof RpcError)) {
        return RpcError.Unavailable(
            operation,
            err instanceof Error ? err.message : String(err)
        );
    }
    const original = (err.data ?? {}) as {
        details?: Record<string, unknown>;
        operation?: string;
    };
    return RpcError.Domain('ServiceUnavailable', {
        message: err.message,
        operation,
        details: {...(original.details ?? {})}
    });
}

// SQLSTATE from fn_pending_admission_record when a live intent for another org
// already exists; surfaced as a clean cross-org refusal, not an opaque DB error.
const PENDING_ADMISSION_CROSS_ORG_SQLSTATE = 'FM071';

function isCrossOrgConflict(err: unknown): boolean {
    return (
        (err as {code?: string})?.code === PENDING_ADMISSION_CROSS_ORG_SQLSTATE
    );
}

function crossOrgAdmitRefused(
    shellyId: string,
    organizationId: string
): RpcError {
    return RpcError.Domain('CrossOrgReference', {
        message:
            'Device already has a live admission intent for a different organization',
        shellyID: shellyId,
        details: {organizationId}
    });
}

async function recordIntent(intent: AdmissionIntent): Promise<void> {
    try {
        await recordPendingAdmission({
            shellyId: intent.info.id,
            organizationId: intent.input.organizationId,
            groupId: intent.input.groupId,
            createdBy: intent.input.actorId,
            ttlSeconds: intent.ttlSeconds
        });
    } catch (err) {
        if (isCrossOrgConflict(err)) {
            logger.warn(
                'AdmitDevice refused: shellyId=%s already has a live admission intent for a different org (requested org=%s)',
                intent.info.id,
                intent.input.organizationId
            );
            throw crossOrgAdmitRefused(
                intent.info.id,
                intent.input.organizationId
            );
        }
        throw err;
    }
    logger.info(
        'AdmitDevice ok host=%s ip=%s shellyId=%s gen=%d org=%s',
        intent.target.host,
        intent.target.ip,
        intent.info.id,
        intent.info.gen,
        intent.input.organizationId
    );
}

function admissionResult(
    info: ShellyDeviceInfo,
    ttlSeconds: number
): AdmitDeviceResult {
    return {
        shellyId: info.id,
        gen: info.gen as 2 | 3 | 4,
        rebootingMs: REBOOT_DELAY_MS,
        intentRecorded: true,
        expectedConnectionWithinSec: Math.min(60, ttlSeconds)
    };
}

export async function admitDevice(
    input: AdmitDeviceInput
): Promise<AdmitDeviceResult> {
    const timeoutMs = input.httpTimeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
    const target = await deviceHostFromInput(input.host);
    const info = await fetchDeviceInfoOrUnavailable(target, timeoutMs);
    rejectIfBadShape(info, target);
    rejectIfAuthMissingForMutation(info, input);
    const ctx: DeviceCallContext = {
        target,
        timeoutMs,
        password: input.password
    };
    await configureOutboundWs(ctx);
    await rebootDevice(ctx);
    const ttlSeconds = admissionTtlSeconds();
    await recordIntent({info, target, input, ttlSeconds});
    return admissionResult(info, ttlSeconds);
}
