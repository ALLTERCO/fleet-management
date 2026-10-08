/**
 * Firmware library domain module.
 *
 * Owns the firmware-library data store (backed by Registry), the
 * temporary-download-URL mechanism shared with the HTTP upload/download
 * routes, and the helpers for sanitizing and persisting library entries.
 *
 * Consumers:
 *   - `FirmwareComponent` — RPC methods (`Firmware.ListLibrary`,
 *     `Firmware.DeleteLibraryEntry`, `Firmware.UpdateLibraryEntry`,
 *     `Firmware.CreateLibraryDownloadUrl`).
 *   - `web/index.ts` — the HTTP routes that must stay HTTP:
 *     `POST /media/uploadFirmwareFile` (multipart upload) and
 *     `GET /media/firmware-file/:token` (streamed browser download).
 *
 * The module-level state here (`temporaryFirmwareFiles`, the library
 * cache) is shared by design: both the RPC layer and the HTTP transport
 * layer reference the same token map so an RPC-generated URL can be
 * consumed by a browser GET.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsAsync from 'node:fs/promises';
import path from 'node:path';
import * as log4js from 'log4js';
import {tuning} from '../config/tuning';
import type {FirmwareLibraryItem} from '../types/api/firmware';
import * as Registry from './Registry';
import {kv} from './redis/services';
import type {UploadSessionOwner} from './uploads/uploadSessions';
import {bestEffort} from './util/fireAndForget';

export type {FirmwareLibraryItem};

const logger = log4js.getLogger('firmware-library');

// Paths anchored at the backend runtime root. `__dirname` during prod
// resolves to `.../backend/dist/modules/`; during dev (`tsx`) to
// `.../backend/src/modules/`. Both land two levels up at `backend/`.
const BACKEND_ROOT = path.join(__dirname, '../..');
export const firmwareLibraryPath = path.join(
    BACKEND_ROOT,
    'uploads/firmware-library'
);
export const temporaryFirmwareUploadsPath = path.join(
    BACKEND_ROOT,
    'uploads/firmware-temp'
);

export const TEMP_FIRMWARE_URL_TTL_MS = 60 * 60 * 1000;
export const FIRMWARE_LIBRARY_REGISTRY = 'firmware-library';

export type TemporaryFirmwareFile = {
    filePath: string;
    fileName: string;
    expiresAt: number;
    deleteOnExpire: boolean;
};

export interface TemporaryFirmwareArtifact {
    artifactId: string;
    storageFileName: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
    owner: UploadSessionOwner;
    expiresAt: number;
}

const TEMP_FIRMWARE_ARTIFACT_PREFIX = 'firmware-temp-artifact:';
const TEMP_FIRMWARE_CLEANUP_BATCH_SIZE = 200;
const TEMP_FIRMWARE_REGISTRATION_GRACE_MS = 60_000;
const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const temporaryFirmwareFiles = new Map<string, TemporaryFirmwareFile>();

// Boot-time cleanup of stale firmware files from previous runs. Called
// from app.ts; module load is side-effect-free.
let staleCleanupDirectory: Awaited<ReturnType<typeof fsAsync.opendir>> | null =
    null;
let staleCleanupRun: Promise<{
    inspected: number;
    removed: number;
    more: boolean;
}> | null = null;

async function closeStaleCleanupDirectory(): Promise<void> {
    const directory = staleCleanupDirectory;
    staleCleanupDirectory = null;
    await directory?.close().catch(() => undefined);
}

function artifactKey(artifactId: string): string {
    return `${TEMP_FIRMWARE_ARTIFACT_PREFIX}${artifactId}`;
}

function artifactIdFromStorageName(fileName: string): string | null {
    const match = /-([0-9a-f-]{36})(?:\.[a-z0-9]+)$/i.exec(fileName);
    return match && UUID_PATTERN.test(match[1]) ? match[1] : null;
}

function isActiveTemporaryFirmwarePath(filePath: string, now: number): boolean {
    for (const file of temporaryFirmwareFiles.values()) {
        if (file.filePath === filePath && file.expiresAt > now) return true;
    }
    return false;
}

// Each pass is bounded. Redis failures abort without deleting undecided files.
async function cleanupStaleTemporaryFirmwareBatch(): Promise<{
    inspected: number;
    removed: number;
    more: boolean;
}> {
    await fsAsync.mkdir(temporaryFirmwareUploadsPath, {recursive: true});
    staleCleanupDirectory ??= await fsAsync.opendir(
        temporaryFirmwareUploadsPath
    );
    let inspected = 0;
    let removed = 0;
    const now = Date.now();
    try {
        while (inspected < TEMP_FIRMWARE_CLEANUP_BATCH_SIZE) {
            const entry = await staleCleanupDirectory.read();
            if (!entry) {
                await closeStaleCleanupDirectory();
                return {inspected, removed, more: false};
            }
            inspected++;
            if (!entry.isFile()) continue;
            const filePath = path.join(
                temporaryFirmwareUploadsPath,
                entry.name
            );
            if (isActiveTemporaryFirmwarePath(filePath, now)) continue;

            const artifactId = artifactIdFromStorageName(entry.name);
            if (artifactId && (await kv.get(artifactKey(artifactId)))) continue;

            const stat = await fsAsync.stat(filePath).catch(() => null);
            if (
                stat &&
                now - stat.mtimeMs < TEMP_FIRMWARE_REGISTRATION_GRACE_MS
            ) {
                continue;
            }

            await deleteFileIfExists(filePath);
            removed++;
        }
        return {inspected, removed, more: true};
    } catch (error) {
        await closeStaleCleanupDirectory();
        throw error;
    }
}

export async function cleanupStaleTemporaryFirmwareFiles(): Promise<{
    inspected: number;
    removed: number;
    more: boolean;
}> {
    staleCleanupRun ??= cleanupStaleTemporaryFirmwareBatch().finally(() => {
        staleCleanupRun = null;
    });
    return staleCleanupRun;
}

export async function deleteFileIfExists(filePath: string) {
    try {
        await fsAsync.unlink(filePath);
    } catch {
        // Ignore cleanup failures — file may already be gone
    }
}

export function cleanupExpiredTemporaryFirmwareFiles(now = Date.now()) {
    for (const [token, file] of temporaryFirmwareFiles.entries()) {
        if (file.expiresAt > now) continue;
        temporaryFirmwareFiles.delete(token);
        if (file.deleteOnExpire) {
            void deleteFileIfExists(file.filePath);
        }
    }
}

export function registerTemporaryFirmwareFile(
    filePath: string,
    fileName: string,
    options?: {deleteOnExpire?: boolean}
) {
    cleanupExpiredTemporaryFirmwareFiles();
    const token = crypto.randomUUID();
    temporaryFirmwareFiles.set(token, {
        filePath,
        fileName,
        expiresAt: Date.now() + TEMP_FIRMWARE_URL_TTL_MS,
        deleteOnExpire: options?.deleteOnExpire ?? true
    });
    return token;
}

function isTemporaryFirmwareArtifact(
    value: unknown
): value is TemporaryFirmwareArtifact {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const record = value as Record<string, unknown>;
    const owner = record.owner as Record<string, unknown> | null;
    return (
        typeof record.artifactId === 'string' &&
        UUID_PATTERN.test(record.artifactId) &&
        typeof record.storageFileName === 'string' &&
        path.basename(record.storageFileName) === record.storageFileName &&
        typeof record.fileName === 'string' &&
        path.basename(record.fileName) === record.fileName &&
        typeof record.contentType === 'string' &&
        typeof record.sizeBytes === 'number' &&
        typeof record.sha256 === 'string' &&
        /^[a-f0-9]{64}$/i.test(record.sha256) &&
        owner !== null &&
        typeof owner === 'object' &&
        (owner.organizationId === undefined ||
            typeof owner.organizationId === 'string') &&
        typeof owner.userId === 'string' &&
        (owner.username === undefined || typeof owner.username === 'string') &&
        (owner.credentialId === undefined ||
            typeof owner.credentialId === 'string') &&
        typeof record.expiresAt === 'number'
    );
}

function sameTemporaryFirmwareOwner(
    stored: UploadSessionOwner,
    caller: UploadSessionOwner
): boolean {
    return (
        stored.organizationId === caller.organizationId &&
        stored.userId === caller.userId &&
        stored.username === caller.username &&
        stored.credentialId === caller.credentialId
    );
}

export async function registerTemporaryFirmwareArtifact(input: {
    artifactId: string;
    filePath: string;
    storageFileName: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
    owner: UploadSessionOwner;
}): Promise<{artifactId: string; token: string; expiresAt: number}> {
    if (!UUID_PATTERN.test(input.artifactId)) {
        throw new Error('invalid temporary firmware artifact id');
    }
    const expectedPath = path.join(
        temporaryFirmwareUploadsPath,
        path.basename(input.storageFileName)
    );
    if (
        input.filePath !== expectedPath ||
        !input.storageFileName.includes(input.artifactId)
    ) {
        throw new Error('invalid temporary firmware artifact path');
    }
    const expiresAt = Date.now() + TEMP_FIRMWARE_URL_TTL_MS;
    const artifact: TemporaryFirmwareArtifact = {
        artifactId: input.artifactId,
        storageFileName: input.storageFileName,
        fileName: path.basename(input.fileName),
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256.toLowerCase(),
        owner: input.owner,
        expiresAt
    };
    await kv.set(
        artifactKey(input.artifactId),
        JSON.stringify(artifact),
        Math.ceil(TEMP_FIRMWARE_URL_TTL_MS / 1000)
    );
    const token = registerTemporaryFirmwareFile(
        input.filePath,
        artifact.fileName,
        {deleteOnExpire: true}
    );
    return {artifactId: input.artifactId, token, expiresAt};
}

export async function resolveTemporaryFirmwareArtifact(
    artifactId: string,
    owner: UploadSessionOwner
): Promise<TemporaryFirmwareArtifact | null> {
    if (!UUID_PATTERN.test(artifactId)) return null;
    const raw = await kv.get(artifactKey(artifactId));
    if (!raw) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (
        !isTemporaryFirmwareArtifact(parsed) ||
        parsed.artifactId !== artifactId ||
        !parsed.storageFileName.includes(artifactId) ||
        !sameTemporaryFirmwareOwner(parsed.owner, owner)
    ) {
        return null;
    }
    if (parsed.expiresAt <= Date.now()) {
        await kv.delete(artifactKey(artifactId));
        await deleteFileIfExists(
            path.join(temporaryFirmwareUploadsPath, parsed.storageFileName)
        );
        return null;
    }
    return parsed;
}

export function sanitizeOptionalText(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed.slice(0, 120) : undefined;
}

export function parseTags(value: unknown): string[] {
    if (typeof value !== 'string') return [];
    return value
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 20);
}

export async function computeSha256(filePath: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    for await (const chunk of stream) {
        hash.update(chunk);
    }
    return hash.digest('hex');
}

export interface FirmwareMoveDeps {
    rename: (src: string, dest: string) => Promise<void>;
    copyFile: (src: string, dest: string) => Promise<void>;
    unlink: (src: string) => Promise<void>;
}

const DEFAULT_MOVE_DEPS: FirmwareMoveDeps = {
    rename: fsAsync.rename,
    copyFile: fsAsync.copyFile,
    unlink: fsAsync.unlink
};

export async function moveUploadedFirmwareFile(
    src: string,
    dest: string,
    deps: FirmwareMoveDeps = DEFAULT_MOVE_DEPS
): Promise<void> {
    try {
        await deps.rename(src, dest);
    } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code !== 'EXDEV') throw err;
        await deps.copyFile(src, dest);
        await deps.unlink(src);
    }
}

export function getFirmwareLibraryFilePath(item: FirmwareLibraryItem): string {
    return path.join(
        firmwareLibraryPath,
        path.basename(item.storedFileName || '')
    );
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fsAsync.access(filePath, fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

async function pruneMissingFirmwareLibraryItem(
    item: FirmwareLibraryItem
): Promise<boolean> {
    const filePath = getFirmwareLibraryFilePath(item);
    if (item.storedFileName && (await fileExists(filePath))) {
        return false;
    }

    logger.warn(
        'Removing stale firmware library item %s (%s) because the backing file is missing',
        item.id,
        item.name || item.originalFileName || item.storedFileName
    );
    await bestEffort(
        'registry-remove.firmware-stale',
        Registry.removeFromRegistry(FIRMWARE_LIBRARY_REGISTRY, item.id, {
            id: item.id
        })
    );
    invalidateFirmwareLibraryCache();
    return true;
}

let firmwareLibraryCache: {items: FirmwareLibraryItem[]; ts: number} | null =
    null;
const FIRMWARE_LIBRARY_CACHE_TTL = 30_000;

export async function getFirmwareLibraryItems(): Promise<
    FirmwareLibraryItem[]
> {
    if (
        firmwareLibraryCache &&
        Date.now() - firmwareLibraryCache.ts < FIRMWARE_LIBRARY_CACHE_TTL
    ) {
        return firmwareLibraryCache.items;
    }

    const all = await Registry.getAll(FIRMWARE_LIBRARY_REGISTRY);
    const items = (
        await Promise.all(
            Object.values(all).map(async (rawItem) => {
                const item = rawItem as FirmwareLibraryItem;
                if (!item?.id || !item?.storedFileName) return null;
                if (await pruneMissingFirmwareLibraryItem(item)) return null;
                return item;
            })
        )
    ).filter((item): item is FirmwareLibraryItem => Boolean(item));

    const sorted = items.sort((a, b) => b.uploadedAt - a.uploadedAt);
    firmwareLibraryCache = {items: sorted, ts: Date.now()};
    return sorted;
}

export function invalidateFirmwareLibraryCache() {
    firmwareLibraryCache = null;
}

export async function getFirmwareLibraryItem(
    id: string
): Promise<FirmwareLibraryItem | null> {
    const item = (await Registry.getFromRegistry(
        FIRMWARE_LIBRARY_REGISTRY,
        id
    )) as FirmwareLibraryItem | null;
    if (!item?.id || !item?.storedFileName) return null;
    if (await pruneMissingFirmwareLibraryItem(item)) return null;
    return item;
}

// Periodic cleanup. Armed via startTemporaryFirmwareCleanup() at boot so
// importing this module is side-effect-free.
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startTemporaryFirmwareCleanup(): void {
    if (cleanupTimer) return;
    cleanupTimer = setInterval(() => {
        cleanupExpiredTemporaryFirmwareFiles();
        void cleanupStaleTemporaryFirmwareFiles().catch(() => undefined);
    }, tuning.firmware.tempCleanupIntervalMs);
    cleanupTimer.unref?.();
}

export async function stopTemporaryFirmwareCleanup(): Promise<void> {
    if (cleanupTimer) clearInterval(cleanupTimer);
    cleanupTimer = null;
    await staleCleanupRun?.catch(() => undefined);
    await closeStaleCleanupDirectory();
}
