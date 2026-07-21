import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import type {CookieOptions} from 'express';
import {deviceGuiConfig} from '../../config/deviceGui';
import type {user_t} from '../../types';
import * as PostgresProvider from '../PostgresProvider';
import {deviceGuiSessions} from '../redis/services';
import {decryptStringSecret, encryptStringSecret} from '../secretCrypto';
import {getUserFromToken} from '../user';
import {attestDeviceGuiIp} from './deviceGuiAttestation';
import {
    type DeviceGuiOutcome,
    recordDeviceGuiEvent
} from './deviceGuiDiagnostics';
import {canExecuteOnDevice} from './utils/devicePermissions';
import {isPrivateDeviceIp} from './utils/ipValidation';

export const DEVICE_GUI_COOKIE = 'fm_device_gui_session';

export function deviceGuiCookieOptions(): CookieOptions {
    return {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/',
        maxAge: deviceGuiConfig.sessionTtlSec * 1000
    };
}

export type DeviceGuiLaunchErrorCode =
    | 'not_configured'
    | 'not_found'
    | 'access_denied'
    | 'no_private_ip'
    | 'identity_unverified';

export class DeviceGuiLaunchError extends Error {
    constructor(
        public readonly code: DeviceGuiLaunchErrorCode,
        message: string,
        public readonly outcome?: DeviceGuiOutcome
    ) {
        super(message);
    }
}

interface DeviceGuiSessionRecord {
    version: 2;
    slotId: string;
    sessionId: string;
    deviceId: number;
    externalId: string;
    targetIp: string;
    userId: string;
    organizationId: string | null;
    cookieHash: string;
    encryptedToken: string;
    expiresAt: number;
}

export interface DeviceGuiIdentitySource {
    getDeviceRows(
        deviceIds: number[]
    ): Promise<Array<{id: number; external_id: string; jdoc?: unknown}>>;
}

export interface DeviceGuiIdentity {
    id: number;
    externalId: string;
    ips: string[];
}

export interface DeviceGuiTarget {
    session: DeviceGuiSessionRecord;
    user: user_t;
    deviceId: number;
    externalId: string;
    ips: string[];
}

export function sessionTargetsIdentity(
    session: {externalId: string; targetIp: string},
    identity: DeviceGuiIdentity
): boolean {
    return (
        identity.externalId === session.externalId &&
        identity.ips.includes(session.targetIp)
    );
}

function secretHash(secret: string): string {
    return createHash('sha256').update(secret).digest('base64url');
}

function sameSecret(presented: string, expectedHash: string): boolean {
    const actual = Buffer.from(secretHash(presented));
    const expected = Buffer.from(expectedHash);
    return (
        actual.length === expected.length && timingSafeEqual(actual, expected)
    );
}

export interface DeviceGuiCookie {
    slotId: string;
    sessionId: string;
    secret: string;
}

export function encodeDeviceGuiCookie(value: DeviceGuiCookie): string {
    return `${value.slotId}.${value.sessionId}.${value.secret}`;
}

export function parseDeviceGuiCookie(value: string): DeviceGuiCookie | null {
    const [slotId, sessionId, secret, extra] = value.split('.');
    if (extra !== undefined) return null;
    if (!slotId || !/^[a-f0-9]{24}$/.test(slotId)) return null;
    if (!sessionId || !/^[a-f0-9]{24}$/.test(sessionId)) return null;
    if (!secret || !/^[A-Za-z0-9_-]{43}$/.test(secret)) return null;
    return {slotId, sessionId, secret};
}

export function deviceGuiCookieValue(
    header: string | undefined
): string | undefined {
    for (const pair of header?.split(';') ?? []) {
        const separator = pair.indexOf('=');
        if (
            separator <= 0 ||
            pair.slice(0, separator).trim() !== DEVICE_GUI_COOKIE
        ) {
            continue;
        }
        try {
            return decodeURIComponent(pair.slice(separator + 1).trim());
        } catch {
            return undefined;
        }
    }
    return undefined;
}

function sameUser(session: DeviceGuiSessionRecord, user: user_t): boolean {
    return (
        session.userId === (user.userId ?? user.username) &&
        session.organizationId === (user.organizationId ?? null)
    );
}

async function reusableSlotId(
    cookie: string | undefined,
    user: user_t
): Promise<string | undefined> {
    const parsed = parseDeviceGuiCookie(cookie ?? '');
    if (!parsed) return undefined;
    const session = parseSession(await deviceGuiSessions.get(parsed.sessionId));
    if (!session || !sameUser(session, user)) return undefined;
    return sameSecret(parsed.secret, session.cookieHash) &&
        parsed.slotId === session.slotId
        ? parsed.slotId
        : undefined;
}

function sessionAad(sessionId: string): string {
    return `device-gui:${sessionId}`;
}

function parseSession(
    raw: string | null,
    includeExpired = false
): DeviceGuiSessionRecord | null {
    if (!raw) return null;
    try {
        const record = JSON.parse(raw) as DeviceGuiSessionRecord;
        if (
            record.version !== 2 ||
            !/^[a-f0-9]{24}$/.test(record.slotId) ||
            !/^[a-f0-9]{24}$/.test(record.sessionId) ||
            !Number.isSafeInteger(record.deviceId) ||
            record.deviceId <= 0 ||
            typeof record.externalId !== 'string' ||
            typeof record.targetIp !== 'string' ||
            !isPrivateDeviceIp(record.targetIp) ||
            typeof record.userId !== 'string' ||
            typeof record.cookieHash !== 'string' ||
            typeof record.encryptedToken !== 'string' ||
            !Number.isFinite(record.expiresAt)
        ) {
            return null;
        }
        return includeExpired || record.expiresAt > Date.now() ? record : null;
    } catch {
        return null;
    }
}

const defaultIdentitySource: DeviceGuiIdentitySource = {
    getDeviceRows: PostgresProvider.getBatchByIds
};

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function lanIpsFromJdoc(jdoc: unknown): string[] {
    const status = record(record(jdoc).status);
    const candidates = [record(status.eth).ip, record(status.wifi).sta_ip];
    return candidates.filter(
        (ip, index): ip is string =>
            typeof ip === 'string' &&
            isPrivateDeviceIp(ip) &&
            candidates.indexOf(ip) === index
    );
}

export async function resolveCurrentDevice(
    deviceId: number,
    source: DeviceGuiIdentitySource = defaultIdentitySource
): Promise<DeviceGuiIdentity | null> {
    const rows = await source.getDeviceRows([deviceId]);
    const row = rows[0];
    if (!row || row.id !== deviceId || typeof row.external_id !== 'string') {
        return null;
    }
    return {
        id: deviceId,
        externalId: row.external_id,
        ips: lanIpsFromJdoc(row.jdoc)
    };
}

async function requireLaunchDevice(
    deviceId: number,
    user: user_t
): Promise<DeviceGuiIdentity> {
    const device = await resolveCurrentDevice(deviceId);
    if (!device)
        throw new DeviceGuiLaunchError('not_found', 'Device not found');
    if (!(await canExecuteOnDevice(user, device.externalId))) {
        throw new DeviceGuiLaunchError('access_denied', 'Device access denied');
    }
    if (device.ips.length === 0) {
        throw new DeviceGuiLaunchError(
            'no_private_ip',
            'Device has no private LAN address'
        );
    }
    return device;
}

export async function createDeviceGuiLaunch(input: {
    deviceId: number;
    user: user_t;
    token: string;
    currentCookie?: string;
    sessionId?: string;
}): Promise<{
    guiUrl: string;
    cookie: string;
    replacedSessionId?: string;
    directUrl: string;
    expiresAt: number;
}> {
    if (!deviceGuiConfig.enabled) {
        throw new DeviceGuiLaunchError(
            'not_configured',
            'Device GUI proxy is not configured'
        );
    }
    const sessionId = input.sessionId ?? createDeviceGuiSessionId();
    const device = await requireLaunchDevice(input.deviceId, input.user);
    const attestation = await attestDeviceGuiIp(
        device.externalId,
        device.ips,
        80,
        sessionId
    );
    if (!attestation.targetIp) {
        throw new DeviceGuiLaunchError(
            'identity_unverified',
            'Device LAN identity could not be verified',
            attestation.outcome
        );
    }
    const targetIp = attestation.targetIp;
    const userId = input.user.userId ?? input.user.username;
    const slotId =
        (await reusableSlotId(input.currentCookie, input.user)) ??
        randomBytes(12).toString('hex');
    const cookieSecret = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + deviceGuiConfig.sessionTtlSec * 1000;
    const session: DeviceGuiSessionRecord = {
        version: 2,
        slotId,
        sessionId,
        deviceId: input.deviceId,
        externalId: device.externalId,
        targetIp,
        userId,
        organizationId: input.user.organizationId ?? null,
        cookieHash: secretHash(cookieSecret),
        encryptedToken: encryptStringSecret(input.token, {
            additionalData: sessionAad(sessionId)
        }),
        expiresAt
    };
    const replacedSessionId = await deviceGuiSessions.create({
        slotId,
        sessionId,
        session: JSON.stringify(session),
        ttlSec: deviceGuiConfig.sessionTtlSec
    });
    await deviceGuiSessions.markAttested(
        sessionId,
        deviceGuiConfig.attestationTtlSec
    );
    recordDeviceGuiEvent({
        stage: 'session',
        outcome: 'success',
        level: 'info',
        sessionId,
        deviceId: device.id,
        externalId: device.externalId,
        targetIp
    });
    return {
        guiUrl: `/api/device-gui/${sessionId}/`,
        cookie: encodeDeviceGuiCookie({
            slotId,
            sessionId,
            secret: cookieSecret
        }),
        replacedSessionId: replacedSessionId ?? undefined,
        directUrl: `http://${targetIp}/`,
        expiresAt
    };
}

export function createDeviceGuiSessionId(): string {
    return randomBytes(12).toString('hex');
}

export async function getDeviceGuiDirectInfo(input: {
    deviceId: number;
    user: user_t;
}): Promise<{shellyID: string; deviceIp: string; guiUrl: string}> {
    const device = await requireLaunchDevice(input.deviceId, input.user);
    const deviceIp = device.ips[0]!;
    return {
        shellyID: device.externalId,
        deviceIp,
        guiUrl: `http://${deviceIp}/`
    };
}

export async function authorizeDeviceGuiSession(
    sessionId: string,
    cookieSecret: string
): Promise<DeviceGuiTarget | null> {
    const raw = await deviceGuiSessions.get(sessionId);
    if (!raw) {
        recordDeviceGuiEvent({
            stage: 'session',
            outcome: 'invalid_session',
            level: 'debug',
            sessionId
        });
        return null;
    }
    const session = parseSession(raw, true);
    if (!session) {
        recordDeviceGuiEvent({
            stage: 'session',
            outcome: 'invalid_session',
            level: 'warn',
            sessionId
        });
        return null;
    }
    if (session.expiresAt <= Date.now()) {
        recordDeviceGuiEvent({
            stage: 'session',
            outcome: 'session_expired',
            level: 'info',
            sessionId,
            deviceId: session.deviceId,
            externalId: session.externalId,
            targetIp: session.targetIp
        });
        return null;
    }
    if (!sameSecret(cookieSecret, session.cookieHash)) {
        recordDeviceGuiEvent({
            stage: 'session',
            outcome: 'secret_mismatch',
            level: 'warn',
            sessionId,
            deviceId: session.deviceId,
            externalId: session.externalId,
            targetIp: session.targetIp
        });
        return null;
    }
    let token: string;
    try {
        token = decryptStringSecret(session.encryptedToken, {
            additionalData: sessionAad(sessionId),
            requireBinding: true
        });
    } catch {
        await deviceGuiSessions.delete(sessionId);
        recordDeviceGuiEvent({
            stage: 'session',
            outcome: 'token_invalid',
            level: 'error',
            sessionId,
            deviceId: session.deviceId,
            externalId: session.externalId,
            targetIp: session.targetIp
        });
        return null;
    }
    const user = await getUserFromToken(token);
    if (!user) {
        recordDeviceGuiEvent({
            stage: 'session',
            outcome: 'token_invalid',
            level: 'warn',
            sessionId,
            deviceId: session.deviceId,
            externalId: session.externalId,
            targetIp: session.targetIp
        });
        return null;
    }
    if (!sameUser(session, user)) {
        recordDeviceGuiEvent({
            stage: 'session',
            outcome: 'user_mismatch',
            level: 'warn',
            sessionId,
            deviceId: session.deviceId,
            externalId: session.externalId,
            targetIp: session.targetIp
        });
        return null;
    }
    const device = await resolveCurrentDevice(session.deviceId);
    if (!device || !sessionTargetsIdentity(session, device)) {
        recordDeviceGuiEvent({
            stage: 'session',
            outcome: 'device_changed',
            level: 'warn',
            sessionId,
            deviceId: session.deviceId,
            externalId: session.externalId,
            targetIp: session.targetIp
        });
        return null;
    }
    if (!(await canExecuteOnDevice(user, device.externalId))) {
        recordDeviceGuiEvent({
            stage: 'session',
            outcome: 'access_denied',
            level: 'warn',
            sessionId,
            deviceId: session.deviceId,
            externalId: session.externalId,
            targetIp: session.targetIp
        });
        return null;
    }
    if (!(await deviceGuiSessions.isAttested(sessionId))) {
        const attestation = await attestDeviceGuiIp(
            session.externalId,
            [session.targetIp],
            80,
            sessionId
        );
        if (attestation.targetIp !== session.targetIp) {
            await deviceGuiSessions.delete(sessionId);
            recordDeviceGuiEvent({
                stage: 'session',
                outcome: 'device_changed',
                level: 'warn',
                sessionId,
                deviceId: session.deviceId,
                externalId: session.externalId,
                targetIp: session.targetIp
            });
            return null;
        }
        await deviceGuiSessions.markAttested(
            sessionId,
            deviceGuiConfig.attestationTtlSec
        );
    }
    return {
        session,
        user,
        deviceId: device.id,
        externalId: device.externalId,
        ips: [session.targetIp]
    };
}
