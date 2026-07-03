import crypto from 'node:crypto';
import {tuning} from '../../config/tuning';
import type {UploadSessionPort} from '../redis/ports';
import {uploadSessions} from '../redis/services';
import type {UploadTicketKind, UploadTicketUser} from '../uploadTickets';

export type UploadSessionStatus = 'open' | 'finalized' | 'cancelled';

export interface UploadSession {
    id: string;
    kind: UploadTicketKind;
    owner: UploadTicketUser;
    fileName: string;
    sizeBytes: number;
    offsetBytes: number;
    expectedSha256?: string;
    contentType?: string;
    status: UploadSessionStatus;
    createdAt: number;
    updatedAt: number;
    expiresAt: number;
}

export interface BeginUploadSessionInput {
    kind: UploadTicketKind;
    owner: UploadTicketUser;
    fileName: string;
    sizeBytes: number;
    expectedSha256?: string;
    contentType?: string;
}

export interface AppendUploadChunkInput {
    sessionId: string;
    owner: UploadTicketUser;
    offsetBytes: number;
    chunkBytes: number;
}

export interface FinalizeUploadSessionInput {
    sessionId: string;
    owner: UploadTicketUser;
    sha256: string;
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
    owner: UploadTicketUser,
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
        status: 'open',
        createdAt: now,
        updatedAt: now,
        expiresAt: now + tuning.upload.sessionTtlMs
    };
}

async function loadOpenSession(
    sessionId: string,
    owner: UploadTicketUser,
    store: UploadSessionPort
): Promise<UploadSession> {
    const session = await loadUploadSession(sessionId, store);
    if (!session) throw new UploadSessionNotFoundError();
    assertSessionOwner(session, owner);
    assertSessionOpen(session);
    assertSessionNotExpired(session);
    return session;
}

async function loadUploadSession(
    sessionId: string,
    store: UploadSessionPort
): Promise<UploadSession | null> {
    if (!sessionId)
        throw new UploadSessionValidationError('sessionId required');
    const raw = await store.get(sessionId);
    if (!raw) return null;
    return parseUploadSession(raw);
}

async function saveUploadSession(
    session: UploadSession,
    store: UploadSessionPort
): Promise<void> {
    const ttlSec = Math.max(
        1,
        Math.ceil((session.expiresAt - Date.now()) / 1000)
    );
    await store.set(session.id, JSON.stringify(session), ttlSec);
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

function assertOwner(owner: UploadTicketUser): void {
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
    owner: UploadTicketUser
): void {
    if (session.owner.userId && session.owner.userId !== owner.userId) {
        throw new UploadSessionNotFoundError();
    }
    if (session.owner.username && session.owner.username !== owner.username) {
        throw new UploadSessionNotFoundError();
    }
    if (
        session.owner.organizationId &&
        session.owner.organizationId !== owner.organizationId
    ) {
        throw new UploadSessionNotFoundError();
    }
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
    return (
        typeof record.id === 'string' &&
        typeof record.kind === 'string' &&
        typeof record.owner === 'object' &&
        typeof record.fileName === 'string' &&
        typeof record.sizeBytes === 'number' &&
        typeof record.offsetBytes === 'number' &&
        typeof record.status === 'string' &&
        typeof record.createdAt === 'number' &&
        typeof record.updatedAt === 'number' &&
        typeof record.expiresAt === 'number'
    );
}
