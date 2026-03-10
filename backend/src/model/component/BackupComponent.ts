import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import * as log4js from 'log4js';
import * as DeviceCollector from '../../modules/DeviceCollector';
import * as Registry from '../../modules/Registry';
import type CommandSender from '../CommandSender';
import Component from './Component';

const logger = log4js.getLogger('BackupComponent');

const BACKUPS_DIR = path.join(__dirname, '../../../data/backups');
const REGISTRY_NAME = 'backups';

// Default chunk size for download/upload (bytes)
const DEFAULT_CHUNK_SIZE = 8192;

// Max time to wait for device to come back online after reboot (ms)
const REBOOT_TIMEOUT = 120_000;
// Polling interval while waiting for device reboot (ms)
const REBOOT_POLL_INTERVAL = 3_000;

export interface BackupComponentConfig {
    enable: boolean;
    chunkSize: number;
}

export interface BackupMetadata {
    id: string;
    name: string;
    shellyID: string;
    model: string;
    app: string;
    fwVersion: string;
    createdAt: number;
    fileSize: number;
    contents: Record<string, boolean>;
    metadata: Record<string, any>;
}

interface DownloadFromDeviceParams {
    shellyID: string;
    name?: string;
}

interface RestoreToDeviceParams {
    id: string;
    shellyID: string;
    restore?: Record<string, boolean>;
}

interface RenameParams {
    id: string;
    name: string;
}

interface DeleteParams {
    id: string;
}

interface GetParams {
    id: string;
}

interface GetFileParams {
    id: string;
}

function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default class BackupComponent extends Component<BackupComponentConfig> {
    constructor() {
        super('backup', {set_config_methods: false});
        // Ensure the backups directory exists
        if (!fs.existsSync(BACKUPS_DIR)) {
            fs.mkdirSync(BACKUPS_DIR, {recursive: true});
            logger.info('Created backups directory: %s', BACKUPS_DIR);
        }
    }

    protected override checkConfigKey(key: string, value: any): boolean {
        switch (key) {
            case 'enable':
                return typeof value === 'boolean';
            case 'chunkSize':
                return typeof value === 'number' && value > 0;
            default:
                return super.checkConfigKey(key, value);
        }
    }

    protected override getDefaultConfig(): BackupComponentConfig {
        return {
            enable: true,
            chunkSize: DEFAULT_CHUNK_SIZE
        };
    }

    // ========================================================================
    // Exposed Methods
    // ========================================================================

    /**
     * List all stored backups.
     */
    @Component.Expose('List')
    @Component.ReadOnly
    async list(): Promise<BackupMetadata[]> {
        const all = await Registry.getAll(REGISTRY_NAME);
        return Object.values(all);
    }

    /**
     * Get a single backup by ID.
     */
    @Component.Expose('Get')
    @Component.ReadOnly
    async get(params: GetParams): Promise<BackupMetadata | null> {
        if (!params?.id) return null;
        return (
            (await Registry.getFromRegistry(REGISTRY_NAME, params.id)) ?? null
        );
    }

    /**
     * Download backup from a device.
     *
     * This assumes the device already has a backup created (via Sys.CreateBackup
     * which is triggered from the frontend). The frontend handles:
     *   1. Calling Sys.CreateBackup on the device (triggers reboot)
     *   2. Waiting for the device to come back online
     *   3. Calling this method to download and store the backup
     *
     * Alternatively, if no backup exists yet, this method will create one
     * and wait for the device to reboot.
     */
    @Component.Expose('DownloadFromDevice')
    @Component.CrudPermission(
        'devices',
        'execute',
        (params) => params?.shellyID
    )
    async downloadFromDevice(
        params: DownloadFromDeviceParams
    ): Promise<BackupMetadata> {
        const {shellyID, name: customName} = params;

        if (!shellyID) {
            throw new Error('shellyID is required');
        }

        const device = DeviceCollector.getDevice(shellyID);
        if (!device) {
            throw new Error(`Device ${shellyID} not found or offline`);
        }

        const info = device.info;
        const chunkSize = this.config.chunkSize || DEFAULT_CHUNK_SIZE;

        // Check if backup exists on device via status
        const status = device.status;
        let backupStatus = status?.sys?.backup;

        if (!backupStatus?.created) {
            // No backup exists — create one (triggers device reboot)
            logger.info(
                'No backup found on device %s, creating one...',
                shellyID
            );
            await device.sendRPC('Sys.CreateBackup', {});

            // Wait for device to reboot and come back with backup ready
            backupStatus = await this.waitForBackupReady(shellyID);
        }

        // Download backup in chunks
        logger.info(
            'Downloading backup from device %s (chunk size: %d)',
            shellyID,
            chunkSize
        );

        const chunks: Buffer[] = [];
        let offset = 0;
        let left = 1; // Will be set by first response

        while (left > 0) {
            const response = await device.sendRPC('Sys.DownloadBackup', {
                offset,
                len: chunkSize
            });

            if (!response?.data) {
                throw new Error(
                    `Invalid response from Sys.DownloadBackup at offset ${offset}`
                );
            }

            const chunkBuffer = Buffer.from(response.data, 'base64');
            chunks.push(chunkBuffer);
            offset += chunkBuffer.length;
            left = response.left ?? 0;

            logger.debug(
                'Downloaded chunk: offset=%d, size=%d, left=%d',
                offset - chunkBuffer.length,
                chunkBuffer.length,
                left
            );
        }

        const fileData = Buffer.concat(chunks);
        const backupId = generateId();
        const filePath = path.join(BACKUPS_DIR, `${backupId}.zip`);

        // Write backup file
        await fsPromises.writeFile(filePath, fileData);

        // Build default name: {deviceName or shellyID}-{YYYY-MM-DD}
        const deviceName = device.config?.sys?.device?.name || shellyID;
        const dateStr = new Date().toISOString().slice(0, 10);
        const defaultName = `${deviceName}-${dateStr}`;

        const metadata: BackupMetadata = {
            id: backupId,
            name: customName || defaultName,
            shellyID,
            model: info.model,
            app: info.app,
            fwVersion: info.ver,
            createdAt: Date.now(),
            fileSize: fileData.length,
            contents: backupStatus?.contents || {},
            metadata: {}
        };

        // Check for existing backup with the same name — overwrite if found
        if (customName) {
            const existing = await this.findBackupByName(customName);
            if (existing) {
                // Delete old file and registry entry
                await this.deleteBackupFiles(existing.id);
                await Registry.removeFromRegistry(REGISTRY_NAME, existing.id, {
                    id: existing.id
                });
                logger.info(
                    'Overwriting existing backup "%s" (id: %s)',
                    customName,
                    existing.id
                );
            }
        }

        // Store metadata in registry
        await Registry.addToRegistry(REGISTRY_NAME, backupId, metadata);

        logger.info(
            'Backup stored: id=%s, name=%s, size=%d bytes',
            backupId,
            metadata.name,
            fileData.length
        );

        return metadata;
    }

    /**
     * Rename a backup.
     */
    @Component.Expose('Rename')
    @Component.WriteOperation
    async rename(params: RenameParams): Promise<BackupMetadata | null> {
        const {id, name} = params;

        if (!id || !name) {
            throw new Error('id and name are required');
        }

        const backup = await Registry.getFromRegistry(REGISTRY_NAME, id);
        if (!backup) {
            throw new Error(`Backup ${id} not found`);
        }

        // Check if another backup already has this name — overwrite it
        const existing = await this.findBackupByName(name);
        if (existing && existing.id !== id) {
            await this.deleteBackupFiles(existing.id);
            await Registry.removeFromRegistry(REGISTRY_NAME, existing.id, {
                id: existing.id
            });
            logger.info(
                'Overwriting existing backup "%s" (id: %s) during rename',
                name,
                existing.id
            );
        }

        backup.name = name;
        await Registry.addToRegistry(REGISTRY_NAME, id, backup);

        logger.info('Backup renamed: id=%s, new name=%s', id, name);
        return backup;
    }

    /**
     * Delete a backup (file + metadata).
     */
    @Component.Expose('Delete')
    @Component.WriteOperation
    async delete(params: DeleteParams): Promise<{success: boolean}> {
        const {id} = params;

        if (!id) {
            throw new Error('id is required');
        }

        const backup = await Registry.getFromRegistry(REGISTRY_NAME, id);
        if (!backup) {
            throw new Error(`Backup ${id} not found`);
        }

        await this.deleteBackupFiles(id);
        await Registry.removeFromRegistry(REGISTRY_NAME, id, {id});

        logger.info('Backup deleted: id=%s, name=%s', id, backup.name);
        return {success: true};
    }

    /**
     * Restore a stored backup to a target device.
     * The target device must be the same model as the backup source.
     *
     * Uses fresh device references for each chunk to handle reconnections,
     * retries on transient failures, and a per-chunk timeout to avoid
     * hanging on orphaned transport connections.
     */
    @Component.Expose('RestoreToDevice')
    @Component.CrudPermission(
        'devices',
        'execute',
        (params) => params?.shellyID
    )
    async restoreToDevice(
        params: RestoreToDeviceParams
    ): Promise<{success: boolean}> {
        const {id, shellyID, restore} = params;

        if (!id || !shellyID) {
            throw new Error('id and shellyID are required');
        }

        const backup = await Registry.getFromRegistry(REGISTRY_NAME, id);
        if (!backup) {
            throw new Error(`Backup ${id} not found`);
        }

        // Verify device is online and model-compatible
        const initialDevice = DeviceCollector.getDevice(shellyID);
        if (!initialDevice) {
            throw new Error(`Device ${shellyID} not found or offline`);
        }

        const deviceInfo = initialDevice.info;
        if (deviceInfo.model !== backup.model) {
            throw new Error(
                `Model mismatch: backup is for ${backup.model}, target device is ${deviceInfo.model}`
            );
        }

        // Read backup file
        const filePath = path.join(BACKUPS_DIR, `${id}.zip`);
        if (!fs.existsSync(filePath)) {
            throw new Error(`Backup file not found for id ${id}`);
        }

        const fileData = await fsPromises.readFile(filePath);
        const base64Data = fileData.toString('base64');
        // Use a smaller chunk size for restore uploads — Shelly devices have
        // limited incoming websocket message buffers. Normal RPCs from FM→device
        // are tiny, but Sys.RestoreBackup sends data TO the device.
        // Base64 chunk size MUST be a multiple of 4 (each 4 base64 chars = 3 bytes).
        // 1368 base64 chars = 342 groups × 3 bytes = 1026 bytes per chunk.
        const base64ChunkSize = 1368;

        logger.info(
            'Restoring backup %s to device %s (total size: %d bytes, ~%d chunks)',
            id,
            shellyID,
            fileData.length,
            Math.ceil(base64Data.length / base64ChunkSize)
        );

        const totalChunks = Math.ceil(base64Data.length / base64ChunkSize);
        let currentChunk = 0;
        const MAX_RETRIES = 3;
        const CHUNK_TIMEOUT_MS = 30_000; // 30s per chunk
        let offset = 0;
        let base64Offset = 0;

        while (base64Offset < base64Data.length) {
            const chunk = base64Data.slice(
                base64Offset,
                base64Offset + base64ChunkSize
            );
            const isLast = base64Offset + chunk.length >= base64Data.length;

            const rpcParams: Record<string, any> = {
                offset,
                data: chunk
            };

            if (isLast) {
                rpcParams.final = true;
                if (restore) {
                    rpcParams.restore = restore;
                }
            }

            let sent = false;
            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                // Re-fetch device each attempt to get a fresh transport
                const device = DeviceCollector.getDevice(shellyID);
                if (!device) {
                    if (attempt < MAX_RETRIES) {
                        logger.warn(
                            'Device %s offline during restore (attempt %d/%d), waiting...',
                            shellyID,
                            attempt,
                            MAX_RETRIES
                        );
                        await this.sleep(5_000);
                        continue;
                    }
                    throw new Error(
                        `Device ${shellyID} went offline during restore`
                    );
                }

                try {
                    // Race sendRPC against a timeout to avoid hanging on orphaned transports
                    const timeoutPromise = new Promise<never>((_, reject) =>
                        setTimeout(
                            () => reject(new Error('Chunk send timeout')),
                            CHUNK_TIMEOUT_MS
                        )
                    );

                    if (isLast) {
                        // Final chunk: device will reboot, so it may not respond.
                        // Race against timeout and treat timeout as success.
                        try {
                            await Promise.race([
                                device.sendRPC('Sys.RestoreBackup', rpcParams),
                                timeoutPromise
                            ]);
                        } catch (e: any) {
                            // Timeout or disconnect on final chunk is expected
                            // (device reboots immediately after applying)
                            logger.info(
                                'Final chunk sent to %s — device likely rebooting (%s)',
                                shellyID,
                                e.message || e
                            );
                        }
                    } else {
                        await Promise.race([
                            device.sendRPC('Sys.RestoreBackup', rpcParams),
                            timeoutPromise
                        ]);
                    }

                    sent = true;
                    break;
                } catch (e: any) {
                    logger.warn(
                        'Restore chunk failed for %s at offset %d (attempt %d/%d): %s',
                        shellyID,
                        offset,
                        attempt,
                        MAX_RETRIES,
                        e.message || e
                    );

                    if (attempt < MAX_RETRIES) {
                        // Device may have reconnected — restart upload from offset 0
                        // because the device loses accumulated chunks on disconnect
                        logger.info(
                            'Restarting restore upload from offset 0 for %s',
                            shellyID
                        );
                        offset = 0;
                        base64Offset = 0;
                        await this.sleep(5_000);
                        break; // Break retry loop, will re-enter while loop from offset 0
                    }
                }
            }

            if (!sent && offset === 0 && base64Offset === 0) {
                // We restarted from 0 — continue the outer while loop
                continue;
            }

            if (!sent) {
                throw new Error(
                    `Failed to send restore chunk to ${shellyID} after ${MAX_RETRIES} attempts`
                );
            }

            // Advance offsets — since base64ChunkSize is a multiple of 4,
            // each slice aligns to complete base64 groups. Buffer.from
            // correctly handles padding in the last chunk.
            const chunkBytes = Buffer.from(chunk, 'base64').length;
            offset += chunkBytes;
            base64Offset += chunk.length;
            currentChunk++;

            // Emit progress to frontend via websocket
            this.emitStatus({
                restoreProgress: {
                    shellyID,
                    backupId: id,
                    chunk: currentChunk,
                    totalChunks,
                    percent: Math.round((currentChunk / totalChunks) * 100)
                }
            });

            logger.debug(
                'Uploaded chunk %d/%d: offset=%d, decodedBytes=%d, final=%s',
                currentChunk,
                totalChunks,
                offset - chunkBytes,
                chunkBytes,
                isLast
            );
        }

        logger.info(
            'Backup %s restore sent to device %s. Device will reboot.',
            id,
            shellyID
        );

        return {success: true};
    }

    /**
     * Get the base64-encoded backup file for client download.
     */
    @Component.Expose('GetFile')
    @Component.ReadOnly
    async getFile(
        params: GetFileParams
    ): Promise<{data: string; name: string; size: number}> {
        const {id} = params;

        if (!id) {
            throw new Error('id is required');
        }

        const backup = await Registry.getFromRegistry(REGISTRY_NAME, id);
        if (!backup) {
            throw new Error(`Backup ${id} not found`);
        }

        const filePath = path.join(BACKUPS_DIR, `${id}.zip`);
        if (!fs.existsSync(filePath)) {
            throw new Error(`Backup file not found for id ${id}`);
        }

        const fileData = await fsPromises.readFile(filePath);

        return {
            data: fileData.toString('base64'),
            name: `${backup.name}.zip`,
            size: fileData.length
        };
    }

    // ========================================================================
    // Helpers
    // ========================================================================

    /**
     * Wait for a device to come back online after reboot and have
     * a backup ready in its status.
     */
    private async waitForBackupReady(
        shellyID: string
    ): Promise<Record<string, any>> {
        const startTime = Date.now();

        while (Date.now() - startTime < REBOOT_TIMEOUT) {
            await this.sleep(REBOOT_POLL_INTERVAL);

            const device = DeviceCollector.getDevice(shellyID);
            if (!device) continue;

            try {
                const statusResponse = await device.sendRPC(
                    'Sys.GetStatus',
                    {}
                );
                const backupStatus = statusResponse?.backup;

                if (backupStatus?.error) {
                    throw new Error(
                        `Backup creation failed on device: ${backupStatus.error}`
                    );
                }

                if (backupStatus?.created) {
                    logger.info(
                        'Backup ready on device %s (created: %d)',
                        shellyID,
                        backupStatus.created
                    );
                    return backupStatus;
                }
            } catch (e: any) {
                // Device might still be rebooting, ignore transient errors
                logger.debug(
                    'Waiting for device %s backup: %s',
                    shellyID,
                    e.message
                );
            }
        }

        throw new Error(
            `Timeout waiting for backup to be ready on device ${shellyID}`
        );
    }

    private async findBackupByName(
        name: string
    ): Promise<BackupMetadata | null> {
        const all = await Registry.getAll(REGISTRY_NAME);
        for (const backup of Object.values(all)) {
            if ((backup as BackupMetadata).name === name) {
                return backup as BackupMetadata;
            }
        }
        return null;
    }

    private async deleteBackupFiles(id: string): Promise<void> {
        const filePath = path.join(BACKUPS_DIR, `${id}.zip`);
        try {
            if (fs.existsSync(filePath)) {
                await fsPromises.unlink(filePath);
            }
        } catch (e: any) {
            logger.warn(
                'Failed to delete backup file %s: %s',
                filePath,
                e.message
            );
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
