import fs from 'node:fs/promises';
import {envInt} from '../../config/envReader.js';
import {tuning} from '../../config/tuning.js';
import RpcError from '../../rpc/RpcError.js';
import type {VisualAssetDto} from '../../types/api/asset.js';
import {getAssetById, type VisualAssetRow} from './assetRepository.js';
import {resolveAssetDiskPath} from './assetStorage.js';
import {uploadAsset} from './assetUpload.js';

export const ASSET_TRANSFER_DEFAULT_CHUNK_BYTES = 64 * 1024;
export const ASSET_TRANSFER_MAX_CHUNK_BYTES = 128 * 1024;
export const ASSET_TRANSFER_MAX_UPLOAD_BYTES = 1024 * 1024;

const RESPONSE_METADATA_RESERVE_BYTES = 4096;
const MIN_UPLOAD_BYTES = 1;
const BASE64_PATTERN =
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export interface UploadAssetBase64Input {
    organizationId: string;
    uploadedBy: string;
    contentType: string;
    data: string;
    label?: string | null;
    context?: string;
}

export interface ReadAssetChunkInput {
    organizationId: string;
    assetId: string;
    offset?: number;
    maxBytes?: number;
}

export interface AssetChunkResult {
    id: string;
    contentType: string;
    sha256: string;
    totalSizeBytes: number;
    offset: number;
    nextOffset: number;
    eof: boolean;
    data: string;
}

interface DiskChunk {
    bytes: Buffer;
    sizeBytes: number;
}

export interface AssetTransferDeps {
    upload(
        input: UploadAssetBase64Input & {bytes: Buffer}
    ): Promise<VisualAssetDto>;
    getAsset(
        organizationId: string,
        assetId: string
    ): Promise<VisualAssetRow | null>;
    resolveDiskPath(filePath: string): string | null;
    readDiskChunk(
        filePath: string,
        offset: number,
        maxBytes: number
    ): Promise<DiskChunk>;
    maxUploadBytes(): number;
    maxResponseBytes(): number;
}

function invalidParams(message: string): never {
    throw RpcError.InvalidParams(message);
}

function assertIntegerInRange(
    value: number,
    name: string,
    minimum: number,
    maximum: number
): void {
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
        invalidParams(
            `${name} must be an integer from ${minimum} to ${maximum}`
        );
    }
}

export function decodeCanonicalAssetBase64(
    data: string,
    maxBytes: number
): Buffer {
    const maxEncodedLength = 4 * Math.ceil(maxBytes / 3);
    if (
        data.length === 0 ||
        data.length > maxEncodedLength ||
        data.length % 4 !== 0 ||
        !BASE64_PATTERN.test(data)
    ) {
        return invalidParams('data must be canonical padded base64');
    }
    const bytes = Buffer.from(data, 'base64');
    if (bytes.toString('base64') !== data) {
        return invalidParams('data must be canonical padded base64');
    }
    if (bytes.byteLength < MIN_UPLOAD_BYTES || bytes.byteLength > maxBytes) {
        return invalidParams(
            `decoded asset must be from ${MIN_UPLOAD_BYTES} to ${maxBytes} bytes`
        );
    }
    return bytes;
}

async function readFileChunk(
    filePath: string,
    offset: number,
    maxBytes: number
): Promise<DiskChunk> {
    const file = await fs.open(filePath, 'r');
    try {
        const stat = await file.stat();
        if (!stat.isFile()) throw new Error('asset path is not a file');
        if (offset > stat.size) {
            invalidParams(`offset exceeds asset size ${stat.size}`);
        }
        const length = Math.min(maxBytes, stat.size - offset);
        if (length === 0) return {bytes: Buffer.alloc(0), sizeBytes: stat.size};
        const buffer = Buffer.allocUnsafe(length);
        const {bytesRead} = await file.read(buffer, 0, length, offset);
        return {bytes: buffer.subarray(0, bytesRead), sizeBytes: stat.size};
    } finally {
        await file.close();
    }
}

function responseSafeChunkBytes(maxResponseBytes: number): number {
    const base64Budget = Math.max(
        4,
        maxResponseBytes - RESPONSE_METADATA_RESERVE_BYTES
    );
    return Math.max(
        1,
        Math.min(
            ASSET_TRANSFER_MAX_CHUNK_BYTES,
            Math.floor(base64Budget / 4) * 3
        )
    );
}

function assetUnavailable(): never {
    throw RpcError.Domain('OperationFailed', {
        message: 'asset file is unavailable',
        operation: 'asset.ReadChunk'
    });
}

export function createAssetTransfer(deps: AssetTransferDeps) {
    async function uploadBase64(
        input: UploadAssetBase64Input
    ): Promise<VisualAssetDto> {
        const bytes = decodeCanonicalAssetBase64(
            input.data,
            deps.maxUploadBytes()
        );
        return deps.upload({...input, bytes});
    }

    async function readChunk(
        input: ReadAssetChunkInput
    ): Promise<AssetChunkResult> {
        const offset = input.offset ?? 0;
        const requestedBytes =
            input.maxBytes ?? ASSET_TRANSFER_DEFAULT_CHUNK_BYTES;
        assertIntegerInRange(offset, 'offset', 0, Number.MAX_SAFE_INTEGER);
        assertIntegerInRange(
            requestedBytes,
            'maxBytes',
            1,
            ASSET_TRANSFER_MAX_CHUNK_BYTES
        );
        const asset = await deps.getAsset(input.organizationId, input.assetId);
        if (!asset) throw RpcError.NotFound('visual_asset', input.assetId);
        const diskPath = deps.resolveDiskPath(asset.file_path);
        if (!diskPath) return assetUnavailable();

        const maxBytes = Math.min(
            requestedBytes,
            responseSafeChunkBytes(deps.maxResponseBytes())
        );
        let chunk: DiskChunk;
        try {
            chunk = await deps.readDiskChunk(diskPath, offset, maxBytes);
        } catch (error) {
            if (error instanceof RpcError) throw error;
            return assetUnavailable();
        }
        if (chunk.sizeBytes !== asset.size_bytes) return assetUnavailable();
        const nextOffset = offset + chunk.bytes.byteLength;
        return {
            id: asset.id,
            contentType: asset.content_type,
            sha256: asset.sha256,
            totalSizeBytes: asset.size_bytes,
            offset,
            nextOffset,
            eof: nextOffset >= asset.size_bytes,
            data: chunk.bytes.toString('base64')
        };
    }

    return {uploadBase64, readChunk};
}

const assetTransfer = createAssetTransfer({
    upload: ({data: _data, ...input}) => uploadAsset(input),
    getAsset: getAssetById,
    resolveDiskPath: resolveAssetDiskPath,
    readDiskChunk: readFileChunk,
    maxUploadBytes: () =>
        Math.min(
            ASSET_TRANSFER_MAX_UPLOAD_BYTES,
            envInt(
                'FM_VIRTUAL_IMAGE_MAX_BYTES',
                ASSET_TRANSFER_MAX_UPLOAD_BYTES,
                MIN_UPLOAD_BYTES
            )
        ),
    maxResponseBytes: () => tuning.mcp.readMaxBytes
});

export const uploadAssetBase64 = assetTransfer.uploadBase64;
export const readAssetChunk = assetTransfer.readChunk;
