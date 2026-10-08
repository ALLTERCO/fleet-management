import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {envInt} from '../../config/envReader';
import {tuning} from '../../config/tuning';
import type CommandSender from '../../model/CommandSender';
import {getAuditExportOwner} from '../../model/component/AuditComponent';
import type BackupComponent from '../../model/component/BackupComponent';
import {isExportOwner} from '../../model/energy/exportHandler';
import RpcError from '../../rpc/RpcError';
import {
    FILE_TRANSFER_MAX_CHUNK_BYTES,
    type FileTransferBeginParams,
    type FileTransferOptions,
    type FileTransferReadChunkParams,
    type FileTransferTarget,
    type FileTransferUploadParams,
    type FileTransferWriteChunkParams,
    type FileUploadKind
} from '../../types/api/fileTransfer';
import {getAssetById} from '../asset/assetRepository';
import {resolveAssetDiskPath} from '../asset/assetStorage';
import {
    uploadAsset,
    ALLOWED_MIME as VISUAL_ASSET_MIME
} from '../asset/assetUpload';
import * as Commander from '../Commander';
import {
    getAssetBytes,
    insertAsset,
    isAllowedContentType
} from '../delivery/emailAssets';
import {
    computeSha256,
    FIRMWARE_LIBRARY_REGISTRY,
    type FirmwareLibraryItem,
    firmwareLibraryPath,
    getFirmwareLibraryFilePath,
    getFirmwareLibraryItem,
    invalidateFirmwareLibraryCache,
    moveUploadedFirmwareFile,
    parseTags,
    registerTemporaryFirmwareArtifact,
    registerTemporaryFirmwareFile,
    resolveTemporaryFirmwareArtifact,
    sanitizeOptionalText,
    temporaryFirmwareUploadsPath
} from '../firmwareLibrary';
import {
    ALLOWED_MIME as FLOOR_PLAN_MIME,
    floorPlanUploadRoot,
    saveFloorPlan
} from '../floorPlanUpload';
import {
    ALLOWED_REPORT_IMAGE_EXT,
    backgroundDisplayName,
    backgroundThumbName,
    safeBackgroundName,
    safeOrgSegment
} from '../mediaAssetLibrary';
import * as Registry from '../Registry';
import {kv, uploadSessions} from '../redis/services';
import {sanitizeSvg} from '../svgSanitize';
import {
    consumeUploadTicket,
    issueUploadTicket,
    type UploadTicketPayload,
    type UploadTicketUser
} from '../uploadTickets';
import {
    auditLogsPath,
    backgroundsPath,
    emReportsPath,
    profilePicturesPath,
    reportImagesPath
} from '../web/utils/uploadPaths';
import {runUploadStagingCleanupBatch, uploadStagingPath} from './uploadCleanup';
import {
    appendUploadChunk,
    beginUploadSession,
    loadUploadSession,
    requireOwnedUploadSession,
    saveUploadSession,
    type UploadSession,
    type UploadSessionOwner
} from './uploadSessions';

const WRITE_LOCK_TTL_SEC = 120;
const RESPONSE_METADATA_RESERVE_BYTES = 4096;
const DEFAULT_READ_CHUNK_BYTES = 64 * 1024;
const MEDIA_MAX_BYTES = 10 * 1024 * 1024;
const FIRMWARE_MAX_BYTES = 64 * 1024 * 1024;
const EMAIL_MAX_BYTES = envInt(
    'FM_EMAIL_ATTACHMENT_MAX_BYTES',
    5 * 1024 * 1024,
    1024
);
const FLOOR_PLAN_MAX_BYTES = envInt(
    'FM_FLOOR_PLAN_MAX_BYTES',
    5 * 1024 * 1024,
    1024
);
const VISUAL_ASSET_MAX_BYTES = Math.min(
    1024 * 1024,
    envInt('FM_VIRTUAL_IMAGE_MAX_BYTES', 1024 * 1024, 1)
);
const BASE64_PATTERN =
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const REPORT_ARTIFACT_PATTERN =
    /^[a-zA-Z0-9\-_.]+\.(csv(\.gz)?|html|xlsx|pdf)$/;
const AUDIT_ARTIFACT_PATTERN = /^audit-log-([0-9]+|fleet)-\d+\.csv$/;

interface StoredFileResult {
    filePath: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    sha256?: string;
}

export interface FileTransferBeginResult {
    uploadId: string;
    nextOffset: number;
    expiresAt: string;
    maxChunkBytes: number;
}

export interface FileTransferWriteResult {
    uploadId: string;
    nextOffset: number;
    complete: boolean;
}

export interface FileTransferGetResult {
    uploadId: string;
    kind: string;
    status: UploadSession['status'];
    nextOffset: number;
    sizeBytes: number;
    sha256: string;
    expiresAt: string;
    result?: Record<string, unknown>;
}

export interface FileTransferFinalizeResult {
    uploadId: string;
    kind: FileUploadKind;
    sizeBytes: number;
    sha256: string;
    result: Record<string, unknown>;
}

export interface FileTransferReadResult {
    fileName: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
    offset: number;
    nextOffset: number;
    eof: boolean;
    dataBase64: string;
}

export interface BackgroundUploadInput {
    tempPath: string;
    originalName: string;
    organizationId: string;
}

export interface FirmwareUploadInput {
    tempPath: string;
    originalName: string;
    sizeBytes: number;
    uploadedBy: string;
    options?: FileTransferOptions;
    owner?: UploadSessionOwner;
    sha256?: string;
    contentType?: string;
}

function invalidParams(message: string): never {
    throw RpcError.InvalidParams(message);
}

function operationUnavailable(operation: string): never {
    throw RpcError.Domain('OperationFailed', {
        message: `${operation} outcome is unknown`,
        operation,
        details: {reason: 'outcome_unknown'}
    });
}

function uploadOwner(sender: CommandSender): UploadSessionOwner {
    const userId = sender.getUserId();
    if (!userId) {
        throw RpcError.InvalidParams(
            'file transfer requires a stable authenticated user id'
        );
    }
    return {
        organizationId: sender.getOrganizationId(),
        userId,
        username: sender.getUser()?.username,
        credentialId: sender.getCredentialId()
    };
}

function ticketUser(owner: UploadSessionOwner): UploadTicketUser {
    return {
        organizationId: owner.organizationId,
        userId: owner.userId,
        username: owner.username
    };
}

function ticketPayload(
    target: FileTransferTarget | undefined
): UploadTicketPayload {
    return {
        locationId: target?.locationId,
        username: target?.username,
        resourceKind: target?.resourceKind,
        resourceId: target?.resourceId
    };
}

function ticketKind(kind: FileUploadKind) {
    return kind === 'visual_asset' ? 'visual_asset' : kind;
}

function uploadTempPath(uploadId: string): string {
    return uploadStagingPath(uploadId);
}

function writeLockKey(uploadId: string): string {
    return `file-transfer:write:${uploadId}`;
}

function finalizeClaimKey(uploadId: string): string {
    return `file-transfer:finalize:${uploadId}`;
}

async function withUploadLock<T>(
    uploadId: string,
    action: () => Promise<T>
): Promise<T> {
    const token = crypto.randomUUID();
    const key = writeLockKey(uploadId);
    if (!(await kv.setIfAbsent(key, token, WRITE_LOCK_TTL_SEC))) {
        throw RpcError.Domain('ResourceConflict', {
            details: {resourceType: 'file_upload', identifier: uploadId}
        });
    }
    try {
        return await action();
    } finally {
        await kv.compareAndDelete(key, token);
    }
}

function maxUploadBytes(kind: FileUploadKind): number {
    const limits: Record<FileUploadKind, number> = {
        backup_import: tuning.backup.importMaxBytes,
        firmware: FIRMWARE_MAX_BYTES,
        background: MEDIA_MAX_BYTES,
        profile_picture: MEDIA_MAX_BYTES,
        report_image: MEDIA_MAX_BYTES,
        email_asset: EMAIL_MAX_BYTES,
        floor_plan: FLOOR_PLAN_MAX_BYTES,
        visual_asset: VISUAL_ASSET_MAX_BYTES
    };
    return limits[kind];
}

function validateBegin(params: FileTransferBeginParams): void {
    if (params.sizeBytes > maxUploadBytes(params.kind)) {
        invalidParams(`${params.kind} upload exceeds its size limit`);
    }
    if (path.basename(params.fileName) !== params.fileName) {
        invalidParams('fileName must not contain a path');
    }
    if (
        params.kind === 'backup_import' &&
        path.extname(params.fileName).toLowerCase() !== '.zip'
    ) {
        invalidParams('backup_import requires a .zip file');
    }
    if (params.kind === 'firmware') firmwareExtension(params.fileName);
    if (params.kind === 'background' && !safeBackgroundName(params.fileName)) {
        invalidParams('unsupported background image type');
    }
    if (
        params.kind === 'profile_picture' &&
        !params.contentType.toLowerCase().startsWith('image/')
    ) {
        invalidParams('profile_picture requires an image content type');
    }
    if (params.kind === 'report_image') {
        const ext = path.extname(params.fileName).toLowerCase();
        if (!ALLOWED_REPORT_IMAGE_EXT.has(ext)) {
            invalidParams('unsupported report image type');
        }
    }
    if (
        params.kind === 'email_asset' &&
        !isAllowedContentType(params.contentType)
    ) {
        invalidParams('unsupported email asset content type');
    }
    if (
        params.kind === 'floor_plan' &&
        !FLOOR_PLAN_MIME.has(params.contentType.toLowerCase())
    ) {
        invalidParams('unsupported floor plan content type');
    }
    if (
        params.kind === 'visual_asset' &&
        !VISUAL_ASSET_MIME.has(params.contentType.toLowerCase())
    ) {
        invalidParams('unsupported visual asset content type');
    }
    if (params.kind === 'floor_plan' && !params.target?.locationId) {
        invalidParams('floor_plan requires target.locationId');
    }
    if (params.kind === 'profile_picture' && !params.target?.username) {
        invalidParams('profile_picture requires target.username');
    }
    if (params.kind === 'report_image' && !params.target?.reportName) {
        invalidParams('report_image requires target.reportName');
    }
    if (
        params.kind === 'visual_asset' &&
        (!params.target?.resourceKind || !params.target.resourceId)
    ) {
        invalidParams(
            'visual_asset requires target.resourceKind and target.resourceId'
        );
    }
    if (
        params.kind === 'visual_asset' &&
        params.target?.resourceKind === 'group' &&
        !/^[1-9]\d*$/.test(params.target.resourceId ?? '')
    ) {
        invalidParams('group resourceId must be a positive decimal string');
    }
}

export function decodeCanonicalFileChunk(data: string): Buffer {
    const maxEncodedLength = 4 * Math.ceil(FILE_TRANSFER_MAX_CHUNK_BYTES / 3);
    if (
        data.length === 0 ||
        data.length > maxEncodedLength ||
        data.length % 4 !== 0 ||
        !BASE64_PATTERN.test(data)
    ) {
        invalidParams('data must be canonical padded base64');
    }
    const bytes = Buffer.from(data, 'base64');
    if (
        bytes.byteLength === 0 ||
        bytes.byteLength > FILE_TRANSFER_MAX_CHUNK_BYTES ||
        bytes.toString('base64') !== data
    ) {
        invalidParams('data must be canonical padded base64');
    }
    return bytes;
}

async function createEmptyUploadFile(uploadId: string): Promise<void> {
    await fs.mkdir(path.dirname(uploadTempPath(uploadId)), {recursive: true});
    const file = await fs.open(uploadTempPath(uploadId), 'wx', 0o600);
    await file.close();
}

async function writeFileChunk(
    uploadId: string,
    offset: number,
    bytes: Buffer
): Promise<void> {
    const file = await fs.open(uploadTempPath(uploadId), 'r+');
    try {
        let written = 0;
        while (written < bytes.byteLength) {
            const result = await file.write(
                bytes,
                written,
                bytes.byteLength - written,
                offset + written
            );
            if (result.bytesWritten === 0) {
                throw new Error('file transfer write made no progress');
            }
            written += result.bytesWritten;
        }
        await file.sync();
    } finally {
        await file.close();
    }
}

async function chunkMatches(
    uploadId: string,
    offset: number,
    expected: Buffer
): Promise<boolean> {
    const file = await fs.open(uploadTempPath(uploadId), 'r');
    try {
        const actual = Buffer.alloc(expected.byteLength);
        const {bytesRead} = await file.read(
            actual,
            0,
            expected.byteLength,
            offset
        );
        return bytesRead === expected.byteLength && actual.equals(expected);
    } finally {
        await file.close();
    }
}

async function removeTempFile(uploadId: string): Promise<void> {
    await fs
        .unlink(uploadTempPath(uploadId))
        .catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') throw error;
        });
}

export async function beginFileTransfer(
    params: FileTransferBeginParams,
    sender: CommandSender
): Promise<FileTransferBeginResult> {
    validateBegin(params);
    await runUploadStagingCleanupBatch();
    const owner = uploadOwner(sender);
    if (
        params.kind !== 'firmware' &&
        params.kind !== 'profile_picture' &&
        !owner.organizationId
    ) {
        invalidParams('organization context required for this upload kind');
    }
    const payload = ticketPayload(params.target);
    const issued = await issueUploadTicket({
        kind: ticketKind(params.kind),
        user: ticketUser(owner),
        payload
    });
    const consumed = await consumeUploadTicket({
        token: issued.token,
        kind: ticketKind(params.kind),
        user: ticketUser(owner),
        payload
    });
    if (!consumed) throw RpcError.OperationFailed('create upload session');

    const session = await beginUploadSession({
        kind: ticketKind(params.kind),
        owner,
        fileName: params.fileName,
        sizeBytes: params.sizeBytes,
        expectedSha256: params.sha256.toLowerCase(),
        contentType: params.contentType.toLowerCase(),
        target: params.target as Record<string, unknown> | undefined,
        options: params.options as Record<string, unknown> | undefined
    });
    try {
        await createEmptyUploadFile(session.id);
    } catch (error) {
        await uploadSessions.delete(session.id);
        throw error;
    }
    return {
        uploadId: session.id,
        nextOffset: 0,
        expiresAt: new Date(session.expiresAt).toISOString(),
        maxChunkBytes: FILE_TRANSFER_MAX_CHUNK_BYTES
    };
}

export async function getOwnedFileTransfer(
    params: FileTransferUploadParams,
    sender: CommandSender
): Promise<UploadSession> {
    return requireOwnedUploadSession(
        await loadUploadSession(params.uploadId),
        uploadOwner(sender)
    );
}

export async function getFileTransfer(
    params: FileTransferUploadParams,
    sender: CommandSender
): Promise<FileTransferGetResult> {
    const session = await getOwnedFileTransfer(params, sender);
    return {
        uploadId: session.id,
        kind: session.kind,
        status: session.status,
        nextOffset: session.offsetBytes,
        sizeBytes: session.sizeBytes,
        sha256: session.expectedSha256 ?? '',
        expiresAt: new Date(session.expiresAt).toISOString(),
        ...(session.status === 'finalized' && session.result
            ? {result: session.result}
            : {})
    };
}

export async function writeFileTransferChunk(
    params: FileTransferWriteChunkParams,
    sender: CommandSender
): Promise<FileTransferWriteResult> {
    const bytes = decodeCanonicalFileChunk(params.data);
    const owner = uploadOwner(sender);
    return withUploadLock(params.uploadId, async () => {
        const session = requireOwnedUploadSession(
            await loadUploadSession(params.uploadId),
            owner
        );
        if (session.status !== 'open') {
            throw RpcError.Domain('ResourceConflict', {
                details: {
                    resourceType: 'file_upload',
                    identifier: params.uploadId
                }
            });
        }
        if (
            params.offset < session.offsetBytes &&
            params.offset + bytes.byteLength <= session.offsetBytes &&
            (await chunkMatches(params.uploadId, params.offset, bytes))
        ) {
            return {
                uploadId: session.id,
                nextOffset: session.offsetBytes,
                complete: session.offsetBytes === session.sizeBytes
            };
        }
        if (session.offsetBytes !== params.offset) {
            throw RpcError.Domain('ResourceConflict', {
                details: {
                    resourceType: 'file_upload_offset',
                    expectedOffset: session.offsetBytes
                }
            });
        }
        if (params.offset + bytes.byteLength > session.sizeBytes) {
            invalidParams('chunk exceeds declared upload size');
        }
        await writeFileChunk(params.uploadId, params.offset, bytes);
        const next = await appendUploadChunk({
            sessionId: params.uploadId,
            owner,
            offsetBytes: params.offset,
            chunkBytes: bytes.byteLength
        });
        return {
            uploadId: next.id,
            nextOffset: next.offsetBytes,
            complete: next.offsetBytes === next.sizeBytes
        };
    });
}

export async function processBackupImportUpload(input: {
    filePath: string;
    organizationId: string | null;
    requestedName?: string;
    originalFileName: string;
}): Promise<Record<string, unknown>> {
    const component = Commander.getComponent('backup') as
        | BackupComponent
        | undefined;
    if (!component) throw RpcError.Unavailable('backup');
    const bytes = await fs.readFile(input.filePath);
    const backup = await component.importBackup({
        fileBuffer: bytes,
        organizationId: input.organizationId,
        requestedName: input.requestedName,
        originalFileName: input.originalFileName
    });
    return backup as unknown as Record<string, unknown>;
}

function firmwareExtension(originalName: string): string {
    const ext = path.extname(path.basename(originalName)).toLowerCase();
    if (!['.zip', '.bin', '.ota', '.sfu', '.swu'].includes(ext)) {
        invalidParams('unsupported firmware file type');
    }
    return ext;
}

export async function processFirmwareUpload(
    input: FirmwareUploadInput
): Promise<Record<string, unknown>> {
    const ext = firmwareExtension(input.originalName);
    const safeBase = path
        .basename(input.originalName, ext)
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .slice(0, 80);
    const retention =
        input.options?.retention === 'library' ? 'library' : 'temporary';
    const artifactId = crypto.randomUUID();
    const fileName = `${safeBase || 'firmware'}-${artifactId}${ext}`;
    const destPath = path.join(
        retention === 'library'
            ? firmwareLibraryPath
            : temporaryFirmwareUploadsPath,
        fileName
    );
    await moveUploadedFirmwareFile(input.tempPath, destPath);
    try {
        if (retention === 'temporary') {
            if (input.owner && input.sha256) {
                const registered = await registerTemporaryFirmwareArtifact({
                    artifactId,
                    filePath: destPath,
                    storageFileName: fileName,
                    fileName: input.originalName,
                    contentType:
                        input.contentType || 'application/octet-stream',
                    sizeBytes: input.sizeBytes,
                    sha256: input.sha256,
                    owner: input.owner
                });
                return {
                    artifactId: registered.artifactId,
                    expiresAt: new Date(registered.expiresAt).toISOString(),
                    fileName,
                    retention,
                    url: `/media/firmware-file/${registered.token}`
                };
            }
            const token = registerTemporaryFirmwareFile(
                destPath,
                input.originalName,
                {deleteOnExpire: true}
            );
            return {
                fileName,
                retention,
                url: `/media/firmware-file/${token}`
            };
        }

        const id = crypto.randomUUID();
        const checksum = await computeSha256(destPath);
        const item: FirmwareLibraryItem = {
            id,
            name:
                sanitizeOptionalText(input.options?.name) ||
                path.basename(input.originalName, ext),
            originalFileName: input.originalName,
            storedFileName: fileName,
            uploadedAt: Date.now(),
            uploadedBy: input.uploadedBy,
            fileSize: input.sizeBytes,
            checksum,
            app: sanitizeOptionalText(input.options?.app),
            model: sanitizeOptionalText(input.options?.model),
            ver: sanitizeOptionalText(input.options?.ver),
            fwId: sanitizeOptionalText(input.options?.fwId),
            channel: input.options?.channel,
            tags: parseTags(input.options?.tags)
        };
        await Registry.addToRegistry(FIRMWARE_LIBRARY_REGISTRY, id, item);
        invalidateFirmwareLibraryCache();
        return {fileName, retention, item};
    } catch (error) {
        await fs.unlink(destPath).catch(() => undefined);
        throw error;
    }
}

export async function writeMetadataStrippedOriginal(
    tempPath: string,
    destPath: string
): Promise<void> {
    const stripped = await sharp(tempPath, {animated: true}).toBuffer();
    await fs.writeFile(destPath, stripped);
}

export async function processBackgroundUpload(
    input: BackgroundUploadInput
): Promise<Record<string, unknown>> {
    const safeName = safeBackgroundName(input.originalName);
    if (!safeName) invalidParams('unsupported image type');
    const orgSegment = safeOrgSegment(input.organizationId);
    if (!orgSegment) invalidParams('organization id is invalid');
    const orgDir = path.join(backgroundsPath, orgSegment);
    await fs.mkdir(orgDir, {recursive: true});
    const originalPath = path.join(orgDir, safeName);
    const thumbName = backgroundThumbName(safeName);
    const displayName = backgroundDisplayName(safeName);
    const thumbPath = path.join(orgDir, thumbName);
    const displayPath = path.join(orgDir, displayName);
    try {
        await writeMetadataStrippedOriginal(input.tempPath, originalPath);
        await sharp(originalPath)
            .resize({
                width: 1920,
                height: 1080,
                fit: 'inside',
                withoutEnlargement: true
            })
            .png()
            .toFile(displayPath);
        await sharp(originalPath)
            .resize({width: 150, height: 150, fit: 'cover'})
            .png()
            .toFile(thumbPath);
        return {
            artifactId: safeName,
            filename: `${orgSegment}/${safeName}`,
            thumbnail: `${orgSegment}/${thumbName}`,
            display: `${orgSegment}/${displayName}`
        };
    } catch (error) {
        await Promise.all([
            fs.unlink(originalPath).catch(() => undefined),
            fs.unlink(thumbPath).catch(() => undefined),
            fs.unlink(displayPath).catch(() => undefined)
        ]);
        throw error;
    }
}

export async function processProfilePictureUpload(input: {
    tempPath: string;
    username: string;
}): Promise<Record<string, unknown>> {
    if (
        !/^[a-zA-Z0-9@._-]+$/.test(input.username) ||
        input.username.includes('..')
    ) {
        invalidParams('invalid username');
    }
    const fileName = `${path.basename(input.username)}.png`;
    await sharp(input.tempPath)
        .png()
        .toFile(path.join(profilePicturesPath, fileName));
    return {
        artifactId: input.username,
        fileName
    };
}

export async function processReportImageUpload(input: {
    tempPath: string;
    originalName: string;
    reportName: string;
    organizationId: string;
}): Promise<Record<string, unknown>> {
    if (!/^[a-zA-Z0-9_-]+$/.test(input.reportName)) {
        invalidParams('invalid reportName');
    }
    const ext = path.extname(path.basename(input.originalName)).toLowerCase();
    if (!ALLOWED_REPORT_IMAGE_EXT.has(ext)) {
        invalidParams('unsupported image type');
    }
    const orgSegment = safeOrgSegment(input.organizationId);
    if (!orgSegment) invalidParams('organization id is invalid');
    const orgDir = path.join(reportImagesPath, orgSegment);
    await fs.mkdir(orgDir, {recursive: true});
    const wrapped = `report_${input.reportName}_${Date.now()}`;
    const originalName = `${wrapped}${ext}`;
    const thumbnailName = `${wrapped}_thumb${ext}`;
    const originalPath = path.join(orgDir, originalName);
    const thumbnailPath = path.join(orgDir, thumbnailName);
    try {
        await sharp(input.tempPath)
            .resize(150, 150, {fit: 'cover'})
            .toFile(thumbnailPath);
        await writeMetadataStrippedOriginal(input.tempPath, originalPath);
        return {
            artifactId: originalName,
            original: originalName,
            thumbnail: thumbnailName
        };
    } catch (error) {
        await Promise.all([
            fs.unlink(originalPath).catch(() => undefined),
            fs.unlink(thumbnailPath).catch(() => undefined)
        ]);
        throw error;
    }
}

export function sanitizeAssetBytes(contentType: string, bytes: Buffer): Buffer {
    return contentType === 'image/svg+xml' ? sanitizeSvg(bytes) : bytes;
}

export async function processEmailAssetUpload(input: {
    tempPath: string;
    organizationId: string;
    originalName: string;
    contentType: string;
}): Promise<Record<string, unknown>> {
    if (!isAllowedContentType(input.contentType)) {
        invalidParams(`content type "${input.contentType}" is not allowed`);
    }
    const raw = await fs.readFile(input.tempPath);
    const bytes = sanitizeAssetBytes(input.contentType, raw);
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const inserted = await insertAsset({
        organizationId: input.organizationId,
        filename: input.originalName.slice(0, 255),
        contentType: input.contentType,
        sizeBytes: bytes.byteLength,
        sha256,
        bytes
    });
    return inserted as unknown as Record<string, unknown>;
}

export async function processFloorPlanUpload(input: {
    filePath: string;
    locationId: number;
    contentType: string;
}): Promise<{
    url: string;
    widthPx: number;
    heightPx: number;
    sha256: string;
    sizeBytes: number;
    contentType: string;
    artifactId: string;
}> {
    const {locationId} = input;
    if (!Number.isInteger(locationId) || Number(locationId) < 1) {
        invalidParams('floor_plan requires a valid target.locationId');
    }
    const contentType = input.contentType.toLowerCase();
    if (!FLOOR_PLAN_MIME.has(contentType)) {
        invalidParams(`unsupported floor plan content type "${contentType}"`);
    }
    const bytes = await fs.readFile(input.filePath);
    const saved = await saveFloorPlan({
        locationId: Number(locationId),
        contentType,
        bytes
    });
    return {
        ...saved,
        artifactId: `${locationId}:${path.basename(saved.url)}`
    };
}

async function processVisualAssetUpload(
    session: UploadSession,
    sender: CommandSender
): Promise<Record<string, unknown>> {
    const organizationId = sender.getOrganizationId();
    if (!organizationId) invalidParams('organization context required');
    const bytes = await fs.readFile(uploadTempPath(session.id));
    return (await uploadAsset({
        organizationId,
        uploadedBy:
            sender.getUser()?.username ?? sender.getUserId() ?? 'unknown',
        contentType: session.contentType ?? '',
        bytes,
        label: session.options?.label as string | null | undefined,
        context: session.options?.context as string | undefined
    })) as unknown as Record<string, unknown>;
}

async function processCompletedUpload(
    session: UploadSession,
    sender: CommandSender
): Promise<Record<string, unknown>> {
    const target = session.target ?? {};
    const options = session.options as FileTransferOptions | undefined;
    switch (session.kind) {
        case 'backup_import':
            return processBackupImportUpload({
                filePath: uploadTempPath(session.id),
                organizationId: sender.getOrganizationId() ?? null,
                requestedName: session.options?.requestedName as
                    | string
                    | undefined,
                originalFileName: session.fileName
            });
        case 'firmware':
            return processFirmwareUpload({
                tempPath: uploadTempPath(session.id),
                originalName: session.fileName,
                sizeBytes: session.sizeBytes,
                uploadedBy: sender.getUser()?.username ?? 'unknown',
                options,
                owner: session.owner,
                sha256: session.expectedSha256,
                contentType: session.contentType
            });
        case 'background':
            return processBackgroundUpload({
                tempPath: uploadTempPath(session.id),
                originalName: session.fileName,
                organizationId: sender.getOrganizationId() ?? ''
            });
        case 'profile_picture':
            return processProfilePictureUpload({
                tempPath: uploadTempPath(session.id),
                username: String(target.username ?? '')
            });
        case 'report_image':
            return processReportImageUpload({
                tempPath: uploadTempPath(session.id),
                originalName: session.fileName,
                reportName: String(target.reportName ?? ''),
                organizationId: sender.getOrganizationId() ?? ''
            });
        case 'email_asset':
            return processEmailAssetUpload({
                tempPath: uploadTempPath(session.id),
                organizationId: sender.getOrganizationId() ?? '',
                originalName: session.fileName,
                contentType: session.contentType ?? ''
            });
        case 'floor_plan':
            return processFloorPlanUpload({
                filePath: uploadTempPath(session.id),
                locationId: Number(session.target?.locationId),
                contentType: session.contentType ?? ''
            });
        case 'visual_asset':
            return processVisualAssetUpload(session, sender);
        default:
            return invalidParams('unsupported upload kind');
    }
}

async function verifyCompletedUpload(session: UploadSession): Promise<string> {
    if (session.offsetBytes !== session.sizeBytes) {
        throw RpcError.Domain('ResourceConflict', {
            details: {
                resourceType: 'file_upload_offset',
                expectedOffset: session.sizeBytes,
                actualOffset: session.offsetBytes
            }
        });
    }
    const sha256 = await computeSha256(uploadTempPath(session.id));
    if (sha256.toLowerCase() !== session.expectedSha256?.toLowerCase()) {
        throw RpcError.Domain('ResourceConflict', {
            details: {resourceType: 'file_upload_checksum'}
        });
    }
    return sha256.toLowerCase();
}

async function markOutcomeUnknown(session: UploadSession): Promise<void> {
    await saveUploadSession({
        ...session,
        status: 'outcome_unknown',
        updatedAt: Date.now()
    }).catch(() => undefined);
}

export async function finalizeFileTransfer(
    params: FileTransferUploadParams,
    sender: CommandSender
): Promise<FileTransferFinalizeResult> {
    const owner = uploadOwner(sender);
    return withUploadLock(params.uploadId, async () => {
        let session = requireOwnedUploadSession(
            await loadUploadSession(params.uploadId),
            owner
        );
        if (session.status === 'finalized' && session.result) {
            return {
                uploadId: session.id,
                kind: session.kind as FileUploadKind,
                sizeBytes: session.sizeBytes,
                sha256: session.expectedSha256 ?? '',
                result: session.result
            };
        }
        if (session.status !== 'open') {
            operationUnavailable('fileTransfer.Finalize');
        }
        session = {
            ...session,
            expiresAt: Date.now() + tuning.upload.sessionTtlMs,
            updatedAt: Date.now()
        };
        await saveUploadSession(session);
        const sha256 = await verifyCompletedUpload(session);
        const claim = crypto.randomUUID();
        const ttlSec = Math.max(
            1,
            Math.ceil(tuning.upload.sessionTtlMs / 1000)
        );
        if (
            !(await kv.setIfAbsent(finalizeClaimKey(session.id), claim, ttlSec))
        ) {
            await markOutcomeUnknown(session);
            operationUnavailable('fileTransfer.Finalize');
        }
        session = {
            ...session,
            status: 'finalizing',
            updatedAt: Date.now()
        };
        await saveUploadSession(session);
        try {
            const result = await processCompletedUpload(session, sender);
            const finalized: UploadSession = {
                ...session,
                status: 'finalized',
                result,
                updatedAt: Date.now()
            };
            await saveUploadSession(finalized);
            await removeTempFile(session.id).catch(() => undefined);
            return {
                uploadId: session.id,
                kind: session.kind as FileUploadKind,
                sizeBytes: session.sizeBytes,
                sha256,
                result
            };
        } catch (error) {
            await markOutcomeUnknown(session);
            await removeTempFile(session.id).catch(() => undefined);
            throw error;
        }
    });
}

export async function cancelFileTransfer(
    params: FileTransferUploadParams,
    sender: CommandSender
): Promise<{cancelled: boolean}> {
    const owner = uploadOwner(sender);
    return withUploadLock(params.uploadId, async () => {
        const session = requireOwnedUploadSession(
            await loadUploadSession(params.uploadId),
            owner
        );
        if (session.status === 'cancelled') {
            await removeTempFile(session.id);
            return {cancelled: true};
        }
        if (session.status !== 'open') {
            throw RpcError.Domain('ResourceConflict', {
                details: {
                    resourceType: 'file_upload',
                    identifier: params.uploadId
                }
            });
        }
        if (await kv.get(finalizeClaimKey(session.id))) {
            await markOutcomeUnknown(session);
            operationUnavailable('fileTransfer.Cancel');
        }
        await saveUploadSession({
            ...session,
            status: 'cancelled',
            updatedAt: Date.now()
        });
        await removeTempFile(session.id);
        return {cancelled: true};
    });
}

function contentTypeForFile(fileName: string): string {
    if (fileName.endsWith('.csv') || fileName.endsWith('.csv.gz')) {
        return fileName.endsWith('.gz') ? 'application/gzip' : 'text/csv';
    }
    if (fileName.endsWith('.html')) return 'text/html';
    if (fileName.endsWith('.xlsx')) {
        return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }
    if (fileName.endsWith('.pdf')) return 'application/pdf';
    if (fileName.endsWith('.zip')) return 'application/zip';
    if (fileName.endsWith('.png')) return 'image/png';
    if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) {
        return 'image/jpeg';
    }
    if (fileName.endsWith('.webp')) return 'image/webp';
    if (fileName.endsWith('.svg')) return 'image/svg+xml';
    if (fileName.endsWith('.gif')) return 'image/gif';
    return 'application/octet-stream';
}

async function resolveDiskArtifact(
    params: FileTransferReadChunkParams,
    sender: CommandSender
): Promise<StoredFileResult> {
    switch (params.kind) {
        case 'backup': {
            const component = Commander.getComponent('backup') as
                | BackupComponent
                | undefined;
            if (!component) throw RpcError.Unavailable('backup');
            const resolved = await component.resolveFileForTransfer(
                params.artifactId,
                sender
            );
            return {...resolved, contentType: 'application/zip'};
        }
        case 'firmware_library': {
            const item = await getFirmwareLibraryItem(params.artifactId);
            if (!item)
                throw RpcError.NotFound('firmware_library', params.artifactId);
            return {
                filePath: getFirmwareLibraryFilePath(item),
                fileName: item.originalFileName,
                contentType: 'application/octet-stream',
                sizeBytes: item.fileSize,
                sha256: item.checksum
            };
        }
        case 'firmware_temporary': {
            const artifact = await resolveTemporaryFirmwareArtifact(
                params.artifactId,
                uploadOwner(sender)
            );
            if (!artifact) {
                throw RpcError.NotFound(
                    'firmware_temporary',
                    params.artifactId
                );
            }
            // Redis metadata crosses workers; the firmware temp directory must
            // be mounted at the same path for the bytes to cross workers too.
            const filePath = path.join(
                temporaryFirmwareUploadsPath,
                artifact.storageFileName
            );
            const stat = await fs.stat(filePath).catch(() => null);
            if (!stat?.isFile()) {
                throw RpcError.NotFound(
                    'firmware_temporary',
                    params.artifactId
                );
            }
            return {
                filePath,
                fileName: artifact.fileName,
                contentType: artifact.contentType,
                sizeBytes: artifact.sizeBytes,
                sha256: artifact.sha256
            };
        }
        case 'report_export': {
            if (!REPORT_ARTIFACT_PATTERN.test(params.artifactId)) {
                invalidParams('invalid report artifact id');
            }
            const userId = sender.getUserId();
            if (
                !userId ||
                !(await isExportOwner(
                    params.artifactId,
                    userId,
                    sender.getOrganizationId()
                ))
            ) {
                throw RpcError.NotFound('report_artifact', params.artifactId);
            }
            return resolveKnownFile(emReportsPath, params.artifactId);
        }
        case 'audit_export': {
            if (!AUDIT_ARTIFACT_PATTERN.test(params.artifactId)) {
                invalidParams('invalid audit artifact id');
            }
            if (
                !sender.getUserId() ||
                (await getAuditExportOwner(params.artifactId)) !==
                    sender.getUserId()
            ) {
                throw RpcError.NotFound('audit_artifact', params.artifactId);
            }
            return resolveKnownFile(auditLogsPath, params.artifactId);
        }
        case 'visual_asset': {
            const organizationId = sender.getOrganizationId();
            if (!organizationId) invalidParams('organization context required');
            const asset = await getAssetById(organizationId, params.artifactId);
            if (!asset)
                throw RpcError.NotFound('visual_asset', params.artifactId);
            const filePath = resolveAssetDiskPath(asset.file_path);
            if (!filePath)
                throw RpcError.NotFound('visual_asset', params.artifactId);
            return {
                filePath,
                fileName: path.basename(filePath),
                contentType: asset.content_type,
                sizeBytes: asset.size_bytes,
                sha256: asset.sha256
            };
        }
        case 'background': {
            const organizationId = sender.getOrganizationId();
            const orgSegment = organizationId
                ? safeOrgSegment(organizationId)
                : null;
            const safeName = safeBackgroundName(params.artifactId);
            if (!orgSegment || !safeName || safeName !== params.artifactId) {
                invalidParams('invalid background artifact id');
            }
            return resolveKnownFile(
                path.join(backgroundsPath, orgSegment),
                safeName
            );
        }
        case 'profile_picture': {
            if (
                !/^[a-zA-Z0-9@._-]+$/.test(params.artifactId) ||
                params.artifactId.includes('..')
            ) {
                invalidParams('invalid profile picture artifact id');
            }
            return resolveKnownFile(
                profilePicturesPath,
                `${path.basename(params.artifactId)}.png`
            );
        }
        case 'report_image': {
            const ext = path.extname(params.artifactId).toLowerCase();
            if (
                !/^report_[a-zA-Z0-9_-]+_\d+\.[a-zA-Z0-9]+$/.test(
                    params.artifactId
                ) ||
                !ALLOWED_REPORT_IMAGE_EXT.has(ext)
            ) {
                invalidParams('invalid report image artifact id');
            }
            const orgSegment = safeOrgSegment(sender.getOrganizationId());
            if (!orgSegment) invalidParams('organization id is invalid');
            return resolveKnownFile(
                path.join(reportImagesPath, orgSegment),
                params.artifactId
            );
        }
        case 'floor_plan': {
            const match =
                /^([1-9]\d*):([a-f0-9]{64}\.(?:png|jpg|webp|svg))$/.exec(
                    params.artifactId
                );
            if (!match) invalidParams('invalid floor plan artifact id');
            return resolveKnownFile(
                path.join(floorPlanUploadRoot(), match[1]),
                match[2]
            );
        }
        default:
            return invalidParams('artifact is not disk-backed');
    }
}

async function resolveKnownFile(
    root: string,
    fileName: string
): Promise<StoredFileResult> {
    const safeName = path.basename(fileName);
    const filePath = path.join(root, safeName);
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile()) throw RpcError.NotFound('file_artifact', safeName);
    return {
        filePath,
        fileName: safeName,
        contentType: contentTypeForFile(safeName),
        sizeBytes: stat.size
    };
}

function responseSafeChunkBytes(): number {
    const base64Budget = Math.max(
        4,
        tuning.mcp.readMaxBytes - RESPONSE_METADATA_RESERVE_BYTES
    );
    return Math.max(
        1,
        Math.min(
            FILE_TRANSFER_MAX_CHUNK_BYTES,
            Math.floor(base64Budget / 4) * 3
        )
    );
}

function readRange(params: FileTransferReadChunkParams, sizeBytes: number) {
    const offset = params.offset ?? 0;
    const requested = params.maxBytes ?? DEFAULT_READ_CHUNK_BYTES;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > sizeBytes) {
        invalidParams('offset is outside the artifact');
    }
    if (
        !Number.isSafeInteger(requested) ||
        requested < 1 ||
        requested > FILE_TRANSFER_MAX_CHUNK_BYTES
    ) {
        invalidParams('maxBytes is outside the supported range');
    }
    return {
        offset,
        length: Math.min(
            requested,
            responseSafeChunkBytes(),
            sizeBytes - offset
        )
    };
}

async function readDiskChunk(
    artifact: StoredFileResult,
    params: FileTransferReadChunkParams
): Promise<FileTransferReadResult> {
    const file = await fs.open(artifact.filePath, 'r');
    try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size !== artifact.sizeBytes) {
            throw RpcError.Domain('ResourceConflict', {
                details: {resourceType: 'file_artifact'}
            });
        }
        const range = readRange(params, stat.size);
        const bytes = Buffer.alloc(range.length);
        const {bytesRead} = await file.read(
            bytes,
            0,
            range.length,
            range.offset
        );
        const chunk = bytes.subarray(0, bytesRead);
        const nextOffset = range.offset + bytesRead;
        return {
            fileName: artifact.fileName,
            contentType: artifact.contentType,
            sizeBytes: stat.size,
            sha256: artifact.sha256 ?? (await computeSha256(artifact.filePath)),
            offset: range.offset,
            nextOffset,
            eof: nextOffset >= stat.size,
            dataBase64: chunk.toString('base64')
        };
    } finally {
        await file.close();
    }
}

async function readEmailAssetChunk(
    params: FileTransferReadChunkParams,
    sender: CommandSender
): Promise<FileTransferReadResult> {
    const organizationId = sender.getOrganizationId();
    const id = Number.parseInt(params.artifactId, 10);
    if (!organizationId || !Number.isSafeInteger(id) || id < 1) {
        invalidParams('invalid email asset id');
    }
    const asset = await getAssetBytes(organizationId, id);
    if (!asset) throw RpcError.NotFound('email_asset', id);
    const range = readRange(params, asset.bytes.byteLength);
    const bytes = asset.bytes.subarray(
        range.offset,
        range.offset + range.length
    );
    const nextOffset = range.offset + bytes.byteLength;
    return {
        fileName: asset.filename,
        contentType: asset.contentType,
        sizeBytes: asset.bytes.byteLength,
        sha256: crypto.createHash('sha256').update(asset.bytes).digest('hex'),
        offset: range.offset,
        nextOffset,
        eof: nextOffset >= asset.bytes.byteLength,
        dataBase64: bytes.toString('base64')
    };
}

export async function readFileTransferChunk(
    params: FileTransferReadChunkParams,
    sender: CommandSender
): Promise<FileTransferReadResult> {
    if (params.kind === 'email_asset') {
        return readEmailAssetChunk(params, sender);
    }
    return readDiskChunk(await resolveDiskArtifact(params, sender), params);
}
