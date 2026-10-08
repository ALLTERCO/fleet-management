import crypto from 'node:crypto';
import {tuning} from '../../config/tuning';
import type {UploadSessionPort} from '../redis/ports';
import {kv, uploadSessions} from '../redis/services';
import type {UploadTicketKind, UploadTicketUser} from '../uploadTickets';

export type UploadSessionStatus =
    | 'open'
    | 'finalizing'
    | 'finalized'
    | 'cancelled'
    | 'outcome_unknown';

export interface UploadSessionOwner extends UploadTicketUser {
    credentialId?: string;
}

export interface UploadSession {
    id: string;
    kind: UploadTicketKind;
    owner: UploadSessionOwner;
    fileName: string;
    sizeBytes: number;
    offsetBytes: number;
    expectedSha256?: string;
    contentType?: string;
    target?: Record<string, unknown>;
    options?: Record<string, unknown>;
    result?: Record<string, unknown>;
    status: UploadSessionStatus;
    createdAt: number;
    updatedAt: number;
    expiresAt: number;
}

export interface BeginUploadSessionInput {
    kind: UploadTicketKind;
    owner: UploadSessionOwner;
    fileName: string;
    sizeBytes: number;
    expectedSha256?: string;
    contentType?: string;
    target?: Record<string, unknown>;
    options?: Record<string, unknown>;
}

export interface AppendUploadChunkInput {
    sessionId: string;
    owner: UploadSessionOwner;
    offsetBytes: number;
    chunkBytes: number;
}

export interface FinalizeUploadSessionInput {
    sessionId: string;
    owner: UploadSessionOwner;
    sha256: string;
}

const UPLOAD_SESSION_LIVE_PREFIX = 'file-transfer:session-live:';

function uploadSessionLiveKey(sessionId: string): string {
    return `${UPLOAD_SESSION_LIVE_PREFIX}${sessionId}`;
}

class UploadSessionError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = 'UploadSessionError';
        this.code = code;
    }
}

export class UploadSessionConflictError extends UploadSessionError {
    constructor(message: string) {
        super('upload_session_conflict', message);
    }
}

export class UploadSessionValidationError extends UploadSessionError {
    constructor(message: string) {
        super('upload_session_invalid', message);
    }
}

export class UploadSessionNotFoundError extends UploadSessionError {
    constructor() {
        super('upload_session_not_found', 'Upload session not found');
    }
}

export async function beginUploadSession(
    input: BeginUploadSessionInput,
    store: UploadSessionPort = uploadSessions
): Promise<UploadSession> {
    const now = Date.now();
    const session = createUploadSession(input, now);
    await saveUploadSession(session, store);
    return session;
}

export async function appendUploadChunk(
    input: AppendUploadChunkInput,
    store: UploadSessionPort = uploadSessions
): Promise<UploadSession> {
    const session = await loadOpenSession(input.sessionId, input.owner, store);
    assertExpectedOffset(session, input.offsetBytes);
    assertChunkFits(session, input.chunkBytes);
    const next = {
        ...session,
        offsetBytes: session.offsetBytes + input.chunkBytes,
        updatedAt: Date.now()
    };
    await saveUploadSession(next, store);
    return next;
}

export async function finalizeUploadSession(
    input: FinalizeUploadSessionInput,
    store: UploadSessionPort = uploadSessions
): Promise<UploadSession> {
    const session = await loadOpenSession(input.sessionId, input.owner, store);
    assertUploadComplete(session);
    assertChecksumMatches(session, input.sha256);
    const next = {
        ...session,
        status: 'finalized' as const,
        updatedAt: Date.now()
    };
    await saveUploadSession(next, store);
    return next;
}

export async function cancelUploadSession(
    sessionId: string,
    owner: UploadSessionOwner,
    store: UploadSessionPort = uploadSessions
): Promise<UploadSession> {
    const session = await loadOpenSession(sessionId, owner, store);
    const next = {
        ...session,
        status: 'cancelled' as const,
        updatedAt: Date.now()
    };
    await saveUploadSession(next, store);
    return next;
}

function createUploadSession(
    input: BeginUploadSessionInput,
    now: number
): UploadSession {
    assertOwner(input.owner);
    assertFileName(input.fileName);
    assertPositiveSize(input.sizeBytes);
    assertOptionalSha256(input.expectedSha256);
    return {
        id: crypto.randomUUID(),
        kind: input.kind,
        owner: input.owner,
        fileName: input.fileName,
        sizeBytes: input.sizeBytes,
        offsetBytes: 0,
        expectedSha256: input.expectedSha256,
        contentType: input.contentType,
        target: input.target,
        options: input.options,
        status: 'open',
        createdAt: now,
        updatedAt: now,
        expiresAt: now + tuning.upload.sessionTtlMs
    };
}

async function loadOpenSession(
    sessionId: string,
    owner: UploadSessionOwner,
    store: UploadSessionPort
): Promise<UploadSession> {
    const session = await loadUploadSession(sessionId, store);
    if (!session) throw new UploadSessionNotFoundError();
    assertSessionOwner(session, owner);
    assertSessionOpen(session);
    assertSessionNotExpired(session);
    return session;
}

export async function loadUploadSession(
    sessionId: string,
    store: UploadSessionPort = uploadSessions
): Promise<UploadSession | null> {
    if (!sessionId)
        throw new UploadSessionValidationError('sessionId required');
    const raw = await store.get(sessionId);
    if (!raw) return null;
    return parseUploadSession(raw);
}

export async function saveUploadSession(
    session: UploadSession,
    store: UploadSessionPort = uploadSessions
): Promise<void> {
    const ttlSec = Math.max(
        1,
        Math.ceil((session.expiresAt - Date.now()) / 1000)
    );
    await store.set(session.id, JSON.stringify(session), ttlSec);
    if (store === uploadSessions) {
        await kv.set(
            uploadSessionLiveKey(session.id),
            String(session.expiresAt),
            ttlSec
        );
    }
}

export async function uploadSessionExpiryForCleanup(
    sessionId: string,
    store: UploadSessionPort = uploadSessions
): Promise<number | null> {
    const session = await loadUploadSession(sessionId, store);
    if (session) return session.expiresAt;
    if (store !== uploadSessions) return null;

    // Unlike the session adapter, KV reads surface Redis errors. Cleanup must
    // not mistake an unavailable session store for an expired session.
    const liveUntil = await kv.get(uploadSessionLiveKey(sessionId));
    if (liveUntil === null) return null;
    const parsed = Number(liveUntil);
    return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function parseUploadSession(raw: string): UploadSession {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new UploadSessionValidationError('Stored upload session invalid');
    }
    if (!isUploadSession(parsed)) {
        throw new UploadSessionValidationError('Stored upload session invalid');
    }
    return parsed;
}

function assertOwner(owner: UploadSessionOwner): void {
    if (!owner.userId && !owner.username) {
        throw new UploadSessionValidationError('owner identity required');
    }
}

function assertFileName(fileName: string): void {
    if (!fileName.trim() || fileName.includes('..')) {
        throw new UploadSessionValidationError('safe fileName required');
    }
}

function assertPositiveSize(sizeBytes: number): void {
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
        throw new UploadSessionValidationError('positive sizeBytes required');
    }
}

function assertOptionalSha256(value: string | undefined): void {
    if (value === undefined) return;
    if (!/^[a-f0-9]{64}$/i.test(value)) {
        throw new UploadSessionValidationError('expectedSha256 invalid');
    }
}

function assertExpectedOffset(
    session: UploadSession,
    offsetBytes: number
): void {
    if (offsetBytes !== session.offsetBytes) {
        throw new UploadSessionConflictError(
            `Expected offset ${session.offsetBytes}, got ${offsetBytes}`
        );
    }
}

function assertChunkFits(session: UploadSession, chunkBytes: number): void {
    if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) {
        throw new UploadSessionValidationError('positive chunkBytes required');
    }
    if (session.offsetBytes + chunkBytes > session.sizeBytes) {
        throw new UploadSessionValidationError('chunk exceeds session size');
    }
}

function assertUploadComplete(session: UploadSession): void {
    if (session.offsetBytes !== session.sizeBytes) {
        throw new UploadSessionConflictError('Upload session is incomplete');
    }
}

function assertChecksumMatches(session: UploadSession, sha256: string): void {
    assertOptionalSha256(sha256);
    if (session.expectedSha256 && session.expectedSha256 !== sha256) {
        throw new UploadSessionConflictError('Upload checksum mismatch');
    }
}

function assertSessionOwner(
    session: UploadSession,
    owner: UploadSessionOwner
): void {
    if (session.owner.userId && session.owner.userId !== owner.userId) {
        throw new UploadSessionNotFoundError();
    }
    if (session.owner.username && session.owner.username !== owner.username) {
        throw new UploadSessionNotFoundError();
    }
    if (session.owner.organizationId !== owner.organizationId) {
        throw new UploadSessionNotFoundError();
    }
    if (session.owner.credentialId !== owner.credentialId) {
        throw new UploadSessionNotFoundError();
    }
}

export function requireOwnedUploadSession(
    session: UploadSession | null,
    owner: UploadSessionOwner
): UploadSession {
    if (!session) throw new UploadSessionNotFoundError();
    assertSessionOwner(session, owner);
    assertSessionNotExpired(session);
    return session;
}

function assertSessionOpen(session: UploadSession): void {
    if (session.status !== 'open') {
        throw new UploadSessionConflictError('Upload session is not open');
    }
}

function assertSessionNotExpired(session: UploadSession): void {
    if (session.expiresAt <= Date.now()) {
        throw new UploadSessionNotFoundError();
    }
}

function isUploadSession(value: unknown): value is UploadSession {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const record = value as Record<string, unknown>;
    const owner = record.owner as Record<string, unknown> | null;
    return (
        typeof record.id === 'string' &&
        typeof record.kind === 'string' &&
        owner !== null &&
        typeof owner === 'object' &&
        (owner.organizationId === undefined ||
            typeof owner.organizationId === 'string') &&
        (owner.userId === undefined || typeof owner.userId === 'string') &&
        (owner.username === undefined || typeof owner.username === 'string') &&
        (owner.credentialId === undefined ||
            typeof owner.credentialId === 'string') &&
        typeof record.fileName === 'string' &&
        typeof record.sizeBytes === 'number' &&
        typeof record.offsetBytes === 'number' &&
        (record.status === 'open' ||
            record.status === 'finalizing' ||
            record.status === 'finalized' ||
            record.status === 'cancelled' ||
            record.status === 'outcome_unknown') &&
        typeof record.createdAt === 'number' &&
        typeof record.updatedAt === 'number' &&
        typeof record.expiresAt === 'number'
    );
}
