// SoT for "ask a Shelly about itself" — admitDevice composes this with WS.SetConfig + reboot.

import RpcError from '../../rpc/RpcError';
import {type DeviceHostTarget, deviceHostFromInput} from './deviceHostGuard';
import {crossReference} from './scanLan';

const FW_MIN_MAJOR = 0;
const FW_MIN_MINOR = 11;
const DEFAULT_HTTP_TIMEOUT_MS = 5_000;
const MAX_DEVICE_INFO_BYTES = 64 * 1024;

export interface ShellyDeviceInfo {
    id: string;
    gen: number;
    model: string;
    ver: string;
    mac?: string;
    auth_en?: boolean;
    auth_domain?: string | null;
}

export interface ProbeHostInput {
    host: string;
    organizationId: string;
    httpTimeoutMs?: number;
}

export interface ProbeHostResult {
    ip: string;
    shellyId: string;
    gen: 2 | 3 | 4;
    model: string;
    ver: string;
    mac: string;
    authRequired: boolean;
    authDomain: string | null;
    alreadyKnown: boolean;
    inWaitingRoom: boolean;
}

// Split so non-JSON responses surface as NotAShellyDevice, not "unreachable".
class HttpUnreachable extends Error {}
class HttpBadPayload extends Error {}

async function rpcGet(
    url: string,
    timeoutMs: number
): Promise<Record<string, unknown>> {
    let response: Response;
    try {
        response = await fetch(url, {
            redirect: 'error',
            signal: AbortSignal.timeout(timeoutMs)
        });
    } catch (err) {
        throw new HttpUnreachable(
            err instanceof Error ? err.message : String(err)
        );
    }
    if (!response.ok) {
        throw new HttpUnreachable(`HTTP ${response.status} from ${url}`);
    }
    try {
        const declaredLength = Number(
            response.headers.get('content-length') ?? 0
        );
        if (
            Number.isFinite(declaredLength) &&
            declaredLength > MAX_DEVICE_INFO_BYTES
        ) {
            throw new Error('Device info response is too large');
        }
        if (!response.body) throw new Error('Device info response is empty');
        const reader = response.body.getReader();
        const chunks: Buffer[] = [];
        let bytes = 0;
        for (;;) {
            const {done, value} = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > MAX_DEVICE_INFO_BYTES) {
                await reader.cancel();
                throw new Error('Device info response is too large');
            }
            chunks.push(Buffer.from(value));
        }
        return JSON.parse(Buffer.concat(chunks).toString()) as Record<
            string,
            unknown
        >;
    } catch (err) {
        throw new HttpBadPayload(
            err instanceof Error ? err.message : String(err)
        );
    }
}

export async function fetchDeviceInfoOrUnavailable(
    target: DeviceHostTarget,
    timeoutMs: number,
    port = 80
): Promise<ShellyDeviceInfo> {
    try {
        const authority = port === 80 ? target.ip : `${target.ip}:${port}`;
        return (await rpcGet(
            `http://${authority}/rpc/Shelly.GetDeviceInfo`,
            timeoutMs
        )) as unknown as ShellyDeviceInfo;
    } catch (err) {
        if (err instanceof HttpBadPayload) {
            throw RpcError.Domain('NotAShellyDevice', {
                details: {host: target.host, ip: target.ip}
            });
        }
        throw RpcError.Unavailable('device', `unreachable at ${target.host}`);
    }
}

function parseVer(ver: string): [number, number] | null {
    const m = ver.match(/^(\d+)\.(\d+)/);
    if (!m) return null;
    return [Number(m[1]), Number(m[2])];
}

export function meetsMinFirmware(ver: string): boolean {
    const v = parseVer(ver);
    if (!v) return false;
    if (v[0] > FW_MIN_MAJOR) return true;
    if (v[0] < FW_MIN_MAJOR) return false;
    return v[1] >= FW_MIN_MINOR;
}

export function rejectIfBadShape(
    info: ShellyDeviceInfo,
    target: DeviceHostTarget
): void {
    if (!info?.id || !Number.isInteger(info.gen)) {
        throw RpcError.Domain('NotAShellyDevice', {
            details: {host: target.host, ip: target.ip}
        });
    }
    if (info.gen === 1) {
        throw RpcError.Domain('UnsupportedDeviceGen', {details: {gen: 1}});
    }
    if (info.gen < 2 || info.gen > 4) {
        throw RpcError.Domain('UnsupportedDeviceGen', {
            details: {gen: info.gen}
        });
    }
    if (!meetsMinFirmware(info.ver)) {
        throw RpcError.Domain('FirmwareTooOld', {
            details: {
                required: `${FW_MIN_MAJOR}.${FW_MIN_MINOR}.0`,
                actual: info.ver
            }
        });
    }
}

// Read-only — auth presence reported, not enforced; admit enforces it.
export async function probeHost(
    input: ProbeHostInput
): Promise<ProbeHostResult> {
    const timeoutMs = input.httpTimeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
    const target = await deviceHostFromInput(input.host);
    const info = await fetchDeviceInfoOrUnavailable(target, timeoutMs);
    rejectIfBadShape(info, target);
    const gen = info.gen as 2 | 3 | 4;
    const mac = info.mac ?? '';
    const refs = await crossReference({
        orgId: input.organizationId,
        hits: [{shellyId: info.id, ip: target.ip, model: info.model, gen, mac}]
    });
    return {
        ip: target.ip,
        shellyId: info.id,
        gen,
        model: info.model,
        ver: info.ver,
        mac,
        authRequired: info.auth_en === true,
        authDomain: info.auth_domain ?? null,
        alreadyKnown: refs.known.has(info.id),
        inWaitingRoom: refs.inWaiting.has(info.id)
    };
}
