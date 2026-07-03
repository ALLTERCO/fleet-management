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

export const temporaryFirmwareFiles = new Map<string, TemporaryFirmwareFile>();

// Boot-time cleanup of stale firmware files from previous runs. Called
// from app.ts; module load is side-effect-free.
export async function cleanupStaleTemporaryFirmwareFiles(): Promise<void> {
    try {
        if (!fs.existsSync(temporaryFirmwareUploadsPath)) return;
        const files = await fsAsync.readdir(temporaryFirmwareUploadsPath);
        for (const file of files) {
            await bestEffort(
                'unlink.firmware-stale-temp',
                fsAsync.unlink(path.join(temporaryFirmwareUploadsPath, file))
            );
        }
        if (files.length > 0) {
            logger.info('Cleaned up %d stale firmware upload(s)', files.length);
        }
    } catch {
        // Non-fatal — directory may not exist yet
    }
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
    cleanupTimer = setInterval(
        () => cleanupExpiredTemporaryFirmwareFiles(),
        tuning.firmware.tempCleanupIntervalMs
    );
    cleanupTimer.unref?.();
}

export function stopTemporaryFirmwareCleanup(): void {
    if (!cleanupTimer) return;
    clearInterval(cleanupTimer);
    cleanupTimer = null;
}
