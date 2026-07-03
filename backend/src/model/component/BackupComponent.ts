import {createHash, randomBytes} from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import {finished} from 'node:stream/promises';
import * as log4js from 'log4js';
import {tuning} from '../../config/tuning';
import * as AlertEngine from '../../modules/AlertEngine';
import {
    canCrossOrganizationBoundary,
    canPerformComponentOperation,
    canPerformComponentOperationAsync,
    isComponentPermissionAllowed
} from '../../modules/authz/evaluator';
import {
    type BackupUnitResult,
    registerBackupUnitProcessor
} from '../../modules/backup/jobWorker';
import * as DeviceCollector from '../../modules/DeviceCollector';
import * as EventDistributor from '../../modules/EventDistributor';
import {
    type BackupQueuedUnit,
    backupCaptureOrgs,
    createBackupJob,
    enqueueBackupTargets
} from '../../modules/jobs/repository';
import * as Registry from '../../modules/Registry';
import type {DescribeOutput} from '../../rpc/describe';
import {buildListResponse} from '../../rpc/listResponse';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import type {json_rpc_event, ShellyEvent} from '../../types';
import {
    BACKUP_DELETE_PARAMS,
    BACKUP_DESCRIBE,
    BACKUP_DOWNLOAD_PARAMS,
    BACKUP_GET_PARAMS,
    BACKUP_GETFILE_PARAMS,
    BACKUP_LIST_PARAMS,
    BACKUP_RENAME_PARAMS,
    BACKUP_RESTORE_PARAMS,
    BACKUP_START_DOWNLOAD_JOB_PARAMS,
    BACKUP_START_RESTORE_JOB_PARAMS,
    type BackupStartDownloadJobParams,
    type BackupStartJobResponse,
    type BackupStartRestoreJobParams
} from '../../types/api/backup';
import CommandSender from '../CommandSender';
import Component from './Component';

const logger = log4js.getLogger('BackupComponent');

const BACKUPS_DIR = path.join(__dirname, '../../../data/backups');
const REGISTRY_NAME = 'backups';

// Default chunk size for download/upload (bytes)
const DEFAULT_CHUNK_SIZE = 8192;

// Bound page size so a huge org can't materialize everything at once.
const LIST_MAX_RESULTS = 500;

// Cap download size: GetFile base64-buffers the whole file (~2.3x RAM).
const GET_FILE_MAX_BYTES = 50 * 1024 * 1024;

// Reject a download whose file exceeds the buffer cap (OOM guard).
export function assertBackupDownloadWithinCap(sizeBytes: number): void {
    if (sizeBytes > GET_FILE_MAX_BYTES) {
        throw RpcError.Domain('ValidationFailed', {
            message: `Backup file too large for download (${Math.round(sizeBytes / 1024 / 1024)}MB, max ${Math.round(GET_FILE_MAX_BYTES / 1024 / 1024)}MB)`,
            field: 'size',
            details: {sizeBytes, maxBytes: GET_FILE_MAX_BYTES}
        });
    }
}

// Max time to wait for device to come back online after reboot (ms)
const REBOOT_TIMEOUT = 120_000;

export interface BackupComponentConfig {
    enable: boolean;
    chunkSize: number;
}

export interface BackupMetadata {
    id: string;
    // The org that captured the backup — its owner. Stamped at creation and
    // never reassigned (a device transfer must not hand over the backup), so a
    // read scoped to this field can't leak across tenants. Null only for
    // legacy records captured before stamping, backfilled on first access.
    organizationId: string | null;
    name: string;
    shellyID: string;
    deviceName: string;
    model: string;
    app: string;
    fwVersion: string;
    createdAt: number;
    createdDateKey: string;
    fileSize: number;
    contents: Record<string, boolean>;
    contentsSummary: string;
    groupIds: number[];
    groupNames: string[];
    metadata: Record<string, any>;
}

type BackupMutationResult = BackupMetadata & {
    replacedBackupId?: string;
};

type StoredBackupRecord = {
    raw: any;
    normalized: BackupMetadata;
};

type StagedBackupDeletion = {
    id: string;
    rollback(): Promise<void>;
    commit(): Promise<void>;
};

interface DownloadFromDeviceParams {
    shellyID: string;
    name?: string;
    contents?: Record<string, boolean>;
}

interface RestoreToDeviceParams {
    id: string;
    shellyID: string;
    restore?: Record<string, boolean>;
}

interface RestoreAuthorization {
    sender?: CommandSender;
    // Org that owns the restore job. On the async job path there is no
    // CommandSender, so the source device's org must match this tenant.
    expectedSourceOrg?: string;
}

// Base64-aligned (342×3) to fit the device's limited incoming WS buffer.
const RESTORE_BINARY_CHUNK_SIZE = 1026;

type RestoreReconnectWatcher = ReturnType<
    BackupComponent['createRestoreReconnectWatcher']
>;

type RestoreReconnectWatcherHolder = {
    current: RestoreReconnectWatcher | null;
    // Set when the final chunk's RPC was swallowed as an expected reboot
    // error. Forces a post-reboot apply confirmation before success.
    finalChunkUnconfirmed: boolean;
};

interface RestoreStreamArgs {
    id: string;
    shellyID: string;
    restore?: Record<string, boolean>;
    fileSize: number;
    totalChunks: number;
    filePath: string;
    watcherHolder: RestoreReconnectWatcherHolder;
}

interface RestoreChunkArgs {
    shellyID: string;
    offset: number;
    rpcParams: Record<string, any>;
    isLast: boolean;
    restartCount: number;
    watcherHolder: RestoreReconnectWatcherHolder;
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

const BACKUP_CONTENT_KEYS = [
    'ble_bondings',
    'dynamic_components',
    'persistent_counters',
    'schedules',
    'scripts',
    'webhooks',
    'matter_storage'
] as const;

function generateId(): string {
    return `${Date.now()}-${randomBytes(6).toString('hex')}`;
}

function normalizeBackupContents(
    contents?: Record<string, boolean>
): Record<string, boolean> {
    return Object.fromEntries(
        BACKUP_CONTENT_KEYS.map((key) => [key, Boolean(contents?.[key])])
    );
}

function summarizeBackupContents(contents: Record<string, boolean>): string {
    const enabled = BACKUP_CONTENT_KEYS.filter((key) => contents[key]);
    return enabled.length > 0 ? enabled.join(', ') : 'base config only';
}

function filterEnabledBackupContents(
    contents?: Record<string, boolean>
): Record<string, boolean> | undefined {
    if (!contents) return undefined;

    const enabledEntries = BACKUP_CONTENT_KEYS.filter(
        (key) => contents[key]
    ).map((key) => [key, true] as const);
    if (enabledEntries.length === 0) {
        return undefined;
    }

    return Object.fromEntries(enabledEntries);
}

function uniqueShellyIds(shellyIDs: readonly string[]): string[] {
    return [...new Set(shellyIDs.map((id) => id.trim()).filter(Boolean))];
}

function hashBackupJobRequest(
    mode: 'create' | 'restore',
    target: Record<string, unknown>
): string {
    return createHash('sha256')
        .update(JSON.stringify({mode, target}))
        .digest('hex');
}

function canReadDeviceBackups(sender: CommandSender): boolean {
    return isComponentPermissionAllowed(
        canPerformComponentOperation(sender, 'devices', 'read')
    );
}

function canUpdateDeviceBackups(sender: CommandSender): boolean {
    return isComponentPermissionAllowed(
        canPerformComponentOperation(sender, 'devices', 'update')
    );
}

function canDeleteDeviceBackups(sender: CommandSender): boolean {
    return isComponentPermissionAllowed(
        canPerformComponentOperation(sender, 'devices', 'delete')
    );
}

async function canUpdateBackupTargets(
    sender: CommandSender,
    rawParams: unknown
): Promise<boolean> {
    const params = validateOrThrow<BackupStartDownloadJobParams>(
        rawParams,
        BACKUP_START_DOWNLOAD_JOB_PARAMS
    );
    const shellyIDs = uniqueShellyIds(params.shellyIDs);
    if (shellyIDs.length === 0) return false;
    const decisions = await Promise.all(
        shellyIDs.map((shellyID) =>
            canPerformComponentOperationAsync(
                sender,
                'devices',
                'update',
                shellyID
            )
        )
    );
    return decisions.every(isComponentPermissionAllowed);
}

async function canUpdateBackupRestoreTarget(
    sender: CommandSender,
    rawParams: unknown
): Promise<boolean> {
    const params = validateOrThrow<BackupStartRestoreJobParams>(
        rawParams,
        BACKUP_START_RESTORE_JOB_PARAMS
    );
    const decision = await canPerformComponentOperationAsync(
        sender,
        'devices',
        'update',
        params.shellyID
    );
    return isComponentPermissionAllowed(decision);
}

// The single ownership rule, shared by the read gate and the list filter. A
// backup is the capturing org's; another org is blocked even if it can now
// reach the device. Cross-org support bypasses; a null owner is an untracked
// legacy record (device-access governs until it is backfilled).
export function backupOwnerBlocks(
    organizationId: string | null,
    sender: CommandSender
): boolean {
    return (
        organizationId !== null &&
        !canCrossOrganizationBoundary(sender) &&
        organizationId !== sender.getOrganizationId()
    );
}

function readBackupRestoreJobTarget(
    unit: BackupQueuedUnit
): RestoreToDeviceParams {
    const target = unit.target_summary;
    const backupId = target.backupId;
    if (typeof backupId !== 'string' && typeof backupId !== 'number') {
        throw new Error('Backup restore job is missing target backupId');
    }
    const restore =
        target.restore &&
        typeof target.restore === 'object' &&
        !Array.isArray(target.restore)
            ? (target.restore as Record<string, boolean>)
            : undefined;
    return {
        id: String(backupId),
        shellyID: unit.device_id,
        restore
    };
}

function getCreatedDateKey(timestamp: number): string {
    return new Date(timestamp).toISOString().slice(0, 10);
}

export function buildBackupName(
    baseName: string,
    suffixNumber?: number
): string {
    const suffix = suffixNumber && suffixNumber > 1 ? ` (${suffixNumber})` : '';
    const trimmedBase = baseName
        .trim()
        .slice(0, Math.max(1, tuning.backup.nameMaxLength - suffix.length));
    return `${trimmedBase}${suffix}`;
}

function findBackupContentMismatches(
    requested: Record<string, boolean>,
    actual: Record<string, boolean>
): string[] {
    return BACKUP_CONTENT_KEYS.filter(
        (key) => Boolean(requested[key]) !== Boolean(actual[key])
    );
}

function isExpectedRebootRpcError(error: any): boolean {
    const code = RpcError.codeOf(error);
    const message = (RpcError.messageOf(error) ?? String(error)).toLowerCase();

    return (
        code === -109 ||
        code === -32900 ||
        message.includes('shutting down') ||
        message.includes('device not found') ||
        message.includes('timeout') ||
        message.includes('closed')
    );
}

function isExpectedFinalRestoreRpcError(error: any): boolean {
    const message = (RpcError.messageOf(error) ?? String(error)).toLowerCase();
    return (
        isExpectedRebootRpcError(error) ||
        message.includes('chunk send timeout')
    );
}

function extractBackupStatus(payload: any): Record<string, any> | undefined {
    return payload?.sys?.backup ?? payload?.backup;
}

function getBackupCreated(payload: any): number | undefined {
    const created = extractBackupStatus(payload)?.created;
    return typeof created === 'number' ? created : undefined;
}

const SAFE_ID_PATTERN = /^[\w.-]+$/;

export function normalizeBackupName(name: string): string {
    const normalized = name.trim();
    if (!normalized) {
        throw RpcError.InvalidParams('Backup name cannot be empty');
    }
    if (normalized.length > tuning.backup.nameMaxLength) {
        throw RpcError.InvalidParams(
            `Backup name too long (max ${tuning.backup.nameMaxLength} characters)`
        );
    }
    return normalized;
}

function validateBackupId(id: string) {
    if (!id || !SAFE_ID_PATTERN.test(id)) {
        throw RpcError.InvalidParams(`Invalid backup ID: ${id}`);
    }
}

/** Fire a backup_operation_failed alert event — best-effort, swallows errors. */
function reportBackupFailure(shellyID: string, err: unknown): void {
    const organizationId = EventDistributor.getDeviceOrg(shellyID);
    if (!organizationId) return;
    const errorMessage =
        err instanceof Error ? err.message : String(err ?? 'unknown error');
    void AlertEngine.ingestEvent({
        kind: 'backup_operation_failed',
        organizationId,
        shellyID,
        errorMessage
    });
}

export default class BackupComponent extends Component<BackupComponentConfig> {
    private activeDeviceOperations = new Map<string, 'backup' | 'restore'>();
    private activeRestoreBackupSources = new Map<string, number>();
    private stagedBackupDeletionPaths = new Map<string, Set<string>>();
    private backupMutationQueue: Promise<void> | null = null;

    constructor() {
        super('backup', {set_config_methods: false});
        registerBackupUnitProcessor((unit) => this.processBackupUnit(unit));
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

    private acquireDeviceOperation(
        shellyID: string,
        operation: 'backup' | 'restore'
    ) {
        const activeOperation = this.activeDeviceOperations.get(shellyID);
        if (activeOperation) {
            throw RpcError.Domain('ResourceConflict', {
                message: `Cannot start ${operation} for device ${shellyID}: ${activeOperation} already in progress`,
                details: {
                    resourceType: 'device_backup_operation',
                    shellyID,
                    activeOperation
                }
            });
        }
        this.activeDeviceOperations.set(shellyID, operation);
    }

    private releaseDeviceOperation(
        shellyID: string,
        operation: 'backup' | 'restore'
    ) {
        if (this.activeDeviceOperations.get(shellyID) === operation) {
            this.activeDeviceOperations.delete(shellyID);
        }
    }

    private acquireRestoreBackupSource(id: string) {
        this.activeRestoreBackupSources.set(
            id,
            (this.activeRestoreBackupSources.get(id) ?? 0) + 1
        );
    }

    private releaseRestoreBackupSource(id: string) {
        const nextCount = (this.activeRestoreBackupSources.get(id) ?? 0) - 1;
        if (nextCount > 0) {
            this.activeRestoreBackupSources.set(id, nextCount);
        } else {
            this.activeRestoreBackupSources.delete(id);
        }
    }

    private trackStagedBackupDeletion(id: string, stagedPath: string) {
        const paths =
            this.stagedBackupDeletionPaths.get(id) ?? new Set<string>();
        paths.add(stagedPath);
        this.stagedBackupDeletionPaths.set(id, paths);
    }

    private untrackStagedBackupDeletion(id: string, stagedPath: string) {
        const paths = this.stagedBackupDeletionPaths.get(id);
        if (!paths) return;
        paths.delete(stagedPath);
        if (paths.size === 0) {
            this.stagedBackupDeletionPaths.delete(id);
        }
    }

    private isBackupDeletionStaged(id: string): boolean {
        return (this.stagedBackupDeletionPaths.get(id)?.size ?? 0) > 0;
    }

    private assertBackupsNotInUse(ids: string[], action: string) {
        const busy = Array.from(new Set(ids.filter(Boolean))).filter(
            (id) => (this.activeRestoreBackupSources.get(id) ?? 0) > 0
        );
        if (busy.length === 0) {
            return;
        }

        throw RpcError.Domain('ResourceConflict', {
            message: `Cannot ${action} backup${busy.length !== 1 ? 's' : ''} ${busy.join(', ')} while restore is in progress`,
            details: {resourceType: 'backup', action, busyIds: busy}
        });
    }

    private async withBackupMutationLock<T>(
        task: () => Promise<T>
    ): Promise<T> {
        const previous = this.backupMutationQueue ?? Promise.resolve();
        let releaseCurrent!: () => void;
        const current = new Promise<void>((resolve) => {
            releaseCurrent = resolve;
        });
        const tail = previous.then(
            () => current,
            () => current
        );
        this.backupMutationQueue = tail;

        await this.waitForPreviousBackupMutation(previous);

        try {
            return await task();
        } finally {
            releaseCurrent();
            if (this.backupMutationQueue === tail) {
                this.backupMutationQueue = null;
            }
        }
    }

    private async waitForPreviousBackupMutation(
        previous: Promise<void>
    ): Promise<void> {
        try {
            await previous;
        } catch (error) {
            this.logger.debug(
                'Previous backup mutation finished with error before queue continued: %s',
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    // ========================================================================
    // Exposed Methods
    // ========================================================================

    // Gate by devices:<op> on the backup's source shellyID. Throws
    // NotFound (not Unauthorized) so foreign and missing ids return
    // identical responses — no ID-existence oracle.
    #assertBackupDeviceAccessible(
        sender: CommandSender,
        backup: BackupMetadata | undefined | null,
        operation: 'read' | 'update' | 'delete',
        idForOracle: string
    ): void {
        if (!backup) return;
        const decision = canPerformComponentOperation(
            sender,
            'devices',
            operation,
            backup.shellyID
        );
        if (!isComponentPermissionAllowed(decision)) {
            throw RpcError.NotFound('backup', idForOracle);
        }
        // Ownership gate: the backup belongs to the org that captured it
        // (stamped on the record), not whoever can reach the device now. A
        // device transferred A→B must not expose A's backup secrets to B.
        if (backupOwnerBlocks(backup.organizationId, sender)) {
            throw RpcError.NotFound('backup', idForOracle);
        }
    }

    // Async job path has no CommandSender: re-verify the backup's source device
    // still belongs to the queuing tenant. No-op when no expected org is given.
    #assertBackupSourceOrg(
        backup: BackupMetadata,
        expectedSourceOrg: string | undefined,
        idForOracle: string
    ): void {
        if (!expectedSourceOrg) return;
        const sourceOrg = EventDistributor.getDeviceOrg(backup.shellyID);
        if (sourceOrg !== expectedSourceOrg) {
            throw RpcError.NotFound('backup', idForOracle);
        }
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return BACKUP_DESCRIBE;
    }

    /**
     * List all stored backups.
     */
    @Component.Expose('List')
    @Component.CheckPermissions(canReadDeviceBackups)
    async list(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<{
            shellyID?: string;
            limit?: number;
            offset?: number;
        }>(params ?? {}, BACKUP_LIST_PARAMS);
        const visibleRaw = await this.#listVisibleRawBackups(
            sender,
            p.shellyID
        );
        const offset = typeof p.offset === 'number' ? p.offset : 0;
        const limit = this.#resolveListLimit(p.limit);
        const total = visibleRaw.length;
        const pageRaw = visibleRaw.slice(offset, offset + limit);
        // Normalize (per-record file probe) only the visible page, never the
        // whole multi-tenant registry.
        const items = (
            await Promise.all(
                pageRaw.map((backup) =>
                    this.normalizeAndPruneStoredBackupRecord(backup)
                )
            )
        ).filter((backup): backup is BackupMetadata => Boolean(backup));
        return buildListResponse(items, total, limit, offset);
    }

    // Org boundary first: keep only backups whose source device the caller can
    // read, using the cheap raw shellyID before any filesystem work.
    async #listVisibleRawBackups(
        sender: CommandSender,
        shellyIDFilter: string | undefined
    ): Promise<any[]> {
        const all = await Registry.getAll(REGISTRY_NAME);
        const raws = Object.values(all).filter((raw) => {
            if (!shellyIDFilter) return true;
            return String(raw?.shellyID ?? '') === shellyIDFilter;
        });
        if (canCrossOrganizationBoundary(sender)) return raws;
        const accessible = await sender.filterAccessibleDevices(
            raws.map((raw) => String(raw?.shellyID ?? ''))
        );
        const deviceVisible = raws.filter((raw) =>
            accessible.has(String(raw?.shellyID ?? ''))
        );
        return this.#filterByCaptureOrg(deviceVisible, sender);
    }

    // Keep only backups this org owns. Owner lives on the record; legacy records
    // missing it are backfilled once from their create unit, then scoped the
    // same way. A transferred device never drags its old org's backups along.
    async #filterByCaptureOrg(
        raws: any[],
        sender: CommandSender
    ): Promise<any[]> {
        const legacyIds = raws
            .filter((raw) => !raw?.organizationId)
            .map((raw) => String(raw?.id ?? ''));
        const seeded =
            legacyIds.length > 0
                ? await this.#backfillBackupOrgs(legacyIds)
                : new Map<string, string>();
        return raws.filter((raw) => {
            const org =
                raw?.organizationId ??
                seeded.get(String(raw?.id ?? '')) ??
                null;
            return !backupOwnerBlocks(org, sender);
        });
    }

    #resolveListLimit(requested: unknown): number {
        const cap = LIST_MAX_RESULTS;
        if (typeof requested === 'number' && requested > 0) {
            return Math.min(requested, cap);
        }
        return cap;
    }

    /**
     * Get a single backup by ID.
     */
    @Component.Expose('Get')
    @Component.CheckPermissions(canReadDeviceBackups)
    async get(
        params: unknown,
        sender: CommandSender
    ): Promise<BackupMetadata | null> {
        const v = validateOrThrow<GetParams>(params, BACKUP_GET_PARAMS);
        validateBackupId(v.id);
        const backup = await this.getStoredBackupRecord(v.id);
        this.#assertBackupDeviceAccessible(
            sender,
            backup?.normalized,
            'read',
            v.id
        );
        return backup?.normalized ?? null;
    }

    /**
     * Create a fresh backup on the device, wait for reboot/readiness,
     * then download and store it locally.
     */
    @Component.Expose('DownloadFromDevice')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async downloadFromDevice(
        rawParams: unknown
    ): Promise<BackupMutationResult> {
        const params = validateOrThrow<DownloadFromDeviceParams>(
            rawParams,
            BACKUP_DOWNLOAD_PARAMS
        );
        const {shellyID, contents} = params;
        const customName =
            typeof params.name === 'string'
                ? normalizeBackupName(params.name)
                : undefined;

        this.acquireDeviceOperation(shellyID, 'backup');
        try {
            return await this.doDownloadFromDevice(
                shellyID,
                customName,
                contents
            );
        } catch (err) {
            reportBackupFailure(shellyID, err);
            if (err instanceof RpcError) throw err;
            if (err instanceof Error) throw err;
            // Pass cause as-is so device's {code, message} survives
            throw RpcError.DeviceFailed('Backup download', err, shellyID);
        } finally {
            this.releaseDeviceOperation(shellyID, 'backup');
        }
    }

    @Component.Expose('StartDownloadJob')
    @Component.CheckPermissions(
        async (sender, params) => await canUpdateBackupTargets(sender, params)
    )
    async startDownloadJob(
        rawParams: unknown,
        sender: CommandSender
    ): Promise<BackupStartJobResponse> {
        const params = validateOrThrow<BackupStartDownloadJobParams>(
            rawParams,
            BACKUP_START_DOWNLOAD_JOB_PARAMS
        );
        const shellyIDs = uniqueShellyIds(params.shellyIDs);
        const tenantId = requireOrganizationId(sender);
        const createdBy = sender.getUser()?.username ?? 'admin';
        const target = {
            deviceIds: shellyIDs,
            ...(params.name ? {name: normalizeBackupName(params.name)} : {}),
            ...(params.contents
                ? {contents: normalizeBackupContents(params.contents)}
                : {})
        };
        const job = await createBackupJob({
            tenantId,
            target,
            mode: 'create',
            createdBy,
            idempotencyKey: params.idempotencyKey,
            requestHash: hashBackupJobRequest('create', target)
        });
        if (job.created) {
            await enqueueBackupTargets({
                tenantId,
                jobId: job.jobId,
                deviceIds: shellyIDs
            });
        }
        return {jobId: job.jobId};
    }

    @Component.Expose('StartRestoreJob')
    @Component.CheckPermissions(
        async (sender, params) =>
            await canUpdateBackupRestoreTarget(sender, params)
    )
    async startRestoreJob(
        rawParams: unknown,
        sender: CommandSender
    ): Promise<BackupStartJobResponse> {
        const params = validateOrThrow<BackupStartRestoreJobParams>(
            rawParams,
            BACKUP_START_RESTORE_JOB_PARAMS
        );
        const backupId = String(params.id);
        validateBackupId(backupId);
        const storedBackup = await this.getStoredBackupRecord(backupId);
        this.#assertBackupDeviceAccessible(
            sender,
            storedBackup?.normalized,
            'read',
            backupId
        );
        if (!storedBackup) {
            throw RpcError.NotFound('backup', backupId);
        }

        const tenantId = requireOrganizationId(sender);
        const createdBy = sender.getUser()?.username ?? 'admin';
        const restoreSelection = filterEnabledBackupContents(params.restore);
        const target = {
            backupId,
            deviceIds: [params.shellyID],
            ...(restoreSelection ? {restore: restoreSelection} : {})
        };
        const job = await createBackupJob({
            tenantId,
            target,
            mode: 'restore',
            createdBy,
            idempotencyKey: params.idempotencyKey,
            requestHash: hashBackupJobRequest('restore', target)
        });
        if (job.created) {
            await enqueueBackupTargets({
                tenantId,
                jobId: job.jobId,
                deviceIds: [params.shellyID]
            });
        }
        return {jobId: job.jobId};
    }

    private async processBackupUnit(
        unit: BackupQueuedUnit
    ): Promise<BackupUnitResult> {
        if (unit.mode === 'restore') {
            return await this.processBackupRestoreUnit(unit);
        }
        if (unit.mode !== 'create') {
            throw new Error(`Unsupported backup job mode: ${unit.mode}`);
        }
        return await this.processBackupCreateUnit(unit);
    }

    private async processBackupCreateUnit(
        unit: BackupQueuedUnit
    ): Promise<BackupUnitResult> {
        const target = unit.target_summary;
        const name = typeof target.name === 'string' ? target.name : undefined;
        const contents =
            target.contents &&
            typeof target.contents === 'object' &&
            !Array.isArray(target.contents)
                ? (target.contents as Record<string, boolean>)
                : undefined;

        this.acquireDeviceOperation(unit.device_id, 'backup');
        try {
            const result = await this.doDownloadFromDevice(
                unit.device_id,
                name,
                contents
            );
            return {backupId: result.id, result};
        } catch (err) {
            reportBackupFailure(unit.device_id, err);
            throw err;
        } finally {
            this.releaseDeviceOperation(unit.device_id, 'backup');
        }
    }

    private async processBackupRestoreUnit(
        unit: BackupQueuedUnit
    ): Promise<BackupUnitResult> {
        const params = readBackupRestoreJobTarget(unit);
        // The job table is the trust boundary: tenant_id is the org that was
        // authorized at enqueue. Re-bind it so execution can't cross tenants.
        const result = await this.restoreBackupToDevice(params, {
            expectedSourceOrg: unit.tenant_id
        });
        return {
            result: {
                ...result,
                backupId: params.id,
                shellyID: params.shellyID
            }
        };
    }

    private async doDownloadFromDevice(
        shellyID: string,
        customName: string | undefined,
        contents: Record<string, boolean> | undefined
    ): Promise<BackupMutationResult> {
        // Clean Code Ch.3 — one level of abstraction per function. The four
        // phases below are sequential: preflight → create-on-device → download
        // chunks → persist record. Each phase owns its own retry / cleanup.
        const preflight = await this.#preflightCreateBackup(shellyID, contents);
        const created = await this.#triggerDeviceBackup(
            preflight.initialDevice,
            shellyID,
            preflight.requestedContents,
            preflight.previousBackupCreated
        );
        const downloaded = await this.#downloadBackupChunks(
            shellyID,
            preflight.chunkSize
        );
        try {
            return await this.#persistDownloadedBackup({
                shellyID,
                customName,
                initialDevice: preflight.initialDevice,
                info: preflight.initialDevice.info,
                requestedContents: preflight.requestedContents,
                actualContents: created.actualContents,
                mismatchedContents: created.mismatchedContents,
                groupSnapshot: preflight.groupSnapshot,
                backupId: downloaded.backupId,
                filePath: downloaded.filePath,
                fileSize: downloaded.fileSize
            });
        } catch (error) {
            await this.deleteFileIfExists(downloaded.filePath);
            throw error;
        }
    }

    async #preflightCreateBackup(
        shellyID: string,
        contents: Record<string, boolean> | undefined
    ) {
        const initialDevice = DeviceCollector.getDevice(shellyID);
        if (!initialDevice) {
            throw RpcError.Domain('DeviceOffline', {
                message: `Device ${shellyID} not found or offline`,
                shellyID
            });
        }
        const chunkSize = this.config.chunkSize || DEFAULT_CHUNK_SIZE;
        const requestedContents = normalizeBackupContents(contents);
        const groupSnapshot = await this.getGroupSnapshot(shellyID);
        let previousBackupCreated = getBackupCreated(initialDevice.status);
        // Best-effort status refresh — device may have a newer backup than our
        // cached status; waitForBackupReady uses the timestamp as a high-water
        // mark, so a failed read just falls back to the cached value.
        try {
            const currentStatus = await initialDevice.sendRPC(
                'Sys.GetStatus',
                {}
            );
            previousBackupCreated =
                getBackupCreated(currentStatus) ?? previousBackupCreated;
        } catch (error: any) {
            logger.debug(
                'Failed to read existing backup status for %s before create: %s',
                shellyID,
                RpcError.messageOf(error) ?? String(error)
            );
        }
        return {
            initialDevice,
            chunkSize,
            requestedContents,
            previousBackupCreated,
            groupSnapshot
        };
    }

    async #triggerDeviceBackup(
        device: any,
        shellyID: string,
        requestedContents: Record<string, boolean>,
        previousBackupCreated: number | undefined
    ) {
        // Sys.CreateBackup reboots the device. The reboot can drop the RPC
        // transport before the call resolves — that's expected; the readiness
        // check after is the real source of truth.
        logger.info(
            'Creating backup on device %s (contents: %s)',
            shellyID,
            summarizeBackupContents(requestedContents)
        );
        this.emitStatus({backupProgress: {shellyID, phase: 'creating'}});
        try {
            await device.sendRPC('Sys.CreateBackup', requestedContents);
        } catch (error: any) {
            if (!isExpectedRebootRpcError(error)) throw error;
            logger.info(
                'CreateBackup RPC for %s ended during reboot: %s',
                shellyID,
                RpcError.messageOf(error) ?? String(error)
            );
        }
        this.emitStatus({backupProgress: {shellyID, phase: 'rebooting'}});
        const backupStatus = await this.waitForBackupReady(
            shellyID,
            previousBackupCreated
        );
        const actualContents = normalizeBackupContents(backupStatus?.contents);
        const mismatchedContents = findBackupContentMismatches(
            requestedContents,
            actualContents
        );
        return {backupStatus, actualContents, mismatchedContents};
    }

    async #downloadBackupChunks(shellyID: string, chunkSize: number) {
        this.emitStatus({backupProgress: {shellyID, phase: 'downloading'}});
        logger.info(
            'Downloading backup from device %s (chunk size: %d)',
            shellyID,
            chunkSize
        );
        const backupId = generateId();
        const filePath = path.join(BACKUPS_DIR, `${backupId}.zip`);
        const writeStream = fs.createWriteStream(filePath);
        let fileSize = 0;
        let offset = 0;
        let left = 1;
        try {
            while (left > 0) {
                const device = DeviceCollector.getDevice(shellyID);
                if (!device) {
                    throw RpcError.Domain('DeviceOffline', {
                        message: `Device ${shellyID} went offline during backup download`,
                        operation: 'backup_download',
                        shellyID
                    });
                }
                const response = await device.sendRPC('Sys.DownloadBackup', {
                    offset,
                    len: chunkSize
                });
                if (!response?.data) {
                    throw RpcError.DeviceFailed(
                        'Sys.DownloadBackup',
                        `Invalid response at offset ${offset}`,
                        shellyID
                    );
                }
                const chunkBuffer = Buffer.from(response.data, 'base64');
                fileSize += chunkBuffer.length;
                await this.writeBackupChunk(writeStream, chunkBuffer);
                offset += chunkBuffer.length;
                left = response.left ?? 0;
                logger.debug(
                    'Downloaded chunk: offset=%d, size=%d, left=%d',
                    offset - chunkBuffer.length,
                    chunkBuffer.length,
                    left
                );
            }
            writeStream.end();
            await finished(writeStream);
        } catch (error) {
            writeStream.destroy();
            await this.deleteFileIfExists(filePath);
            throw error;
        }
        return {backupId, filePath, fileSize};
    }

    async #persistDownloadedBackup(p: {
        shellyID: string;
        customName: string | undefined;
        initialDevice: any;
        info: any;
        requestedContents: Record<string, boolean>;
        actualContents: Record<string, boolean>;
        mismatchedContents: string[];
        groupSnapshot: {groupIds: number[]; groupNames: string[]};
        backupId: string;
        filePath: string;
        fileSize: number;
    }): Promise<BackupMutationResult> {
        const {
            shellyID,
            customName,
            initialDevice,
            info,
            requestedContents,
            actualContents,
            mismatchedContents,
            groupSnapshot,
            backupId,
            fileSize
        } = p;
        const latestDevice = DeviceCollector.getDevice(shellyID);
        const deviceName =
            latestDevice?.config?.sys?.device?.name ||
            initialDevice.config?.sys?.device?.name ||
            shellyID;
        const createdAt = Date.now();
        const dateStr = getCreatedDateKey(createdAt);
        const contentsSummary = summarizeBackupContents(actualContents);
        const defaultNameBase =
            deviceName === shellyID
                ? `${shellyID}-${dateStr}`
                : `${deviceName}-${shellyID}-${dateStr}`;
        return await this.withBackupMutationLock(async () => {
            const finalName = normalizeBackupName(
                customName
                    ? customName
                    : await this.getUniqueGeneratedBackupName(defaultNameBase)
            );
            const metadata: BackupMetadata = {
                id: backupId,
                // Owner = the device's org at capture time (you can only back up
                // your own device). Stamped once; survives later transfers.
                organizationId: EventDistributor.getDeviceOrg(shellyID) ?? null,
                name: finalName,
                shellyID,
                deviceName,
                model: info.model,
                app: info.app,
                fwVersion: info.ver,
                createdAt,
                createdDateKey: dateStr,
                fileSize,
                contents: actualContents,
                contentsSummary,
                groupIds: groupSnapshot.groupIds,
                groupNames: groupSnapshot.groupNames,
                metadata: {
                    device_name: deviceName,
                    group_ids: groupSnapshot.groupIds,
                    group_names: groupSnapshot.groupNames,
                    requested_contents:
                        summarizeBackupContents(requestedContents),
                    actual_contents: contentsSummary,
                    content_selection_honored:
                        mismatchedContents.length === 0 ? 'yes' : 'no',
                    ...(mismatchedContents.length > 0
                        ? {
                              selection_warning:
                                  'Device returned different backup contents than requested',
                              mismatched_keys: mismatchedContents.join(', ')
                          }
                        : {})
                }
            };
            const replacements = customName
                ? await this.findStoredBackupsByName(customName)
                : [];
            this.assertBackupsNotInUse(
                replacements.map((replacement) => replacement.normalized.id),
                'replace'
            );
            const stagedReplacements = await this.stageBackupFileDeletions(
                replacements.map((replacement) => replacement.normalized.id)
            );

            try {
                await Registry.mutateRegistry(REGISTRY_NAME, (draft) => {
                    draft[backupId] = metadata;
                    for (const replacement of replacements) {
                        delete draft[replacement.normalized.id];
                    }
                });
            } catch (error) {
                await this.rollbackStagedBackupDeletions(stagedReplacements);
                throw error;
            }

            await this.commitStagedBackupDeletions(
                stagedReplacements,
                'replace existing backup files during create'
            );

            logger.info(
                'Backup stored: id=%s, name=%s, size=%d bytes',
                backupId,
                metadata.name,
                fileSize
            );

            return {
                ...this.normalizeStoredBackup(metadata),
                ...(replacements[0]
                    ? {replacedBackupId: replacements[0].normalized.id}
                    : {})
            };
        });
    }

    /**
     * Rename a backup.
     */
    @Component.Expose('Rename')
    @Component.CheckPermissions(canUpdateDeviceBackups)
    async rename(
        rawParams: unknown,
        sender: CommandSender
    ): Promise<BackupMutationResult | null> {
        const params = validateOrThrow<RenameParams>(
            rawParams,
            BACKUP_RENAME_PARAMS
        );
        const {id} = params;
        validateBackupId(id);
        const name = normalizeBackupName(params.name);

        return await this.withBackupMutationLock(async () => {
            const storedBackup = await this.getStoredBackupRecord(id);
            const backup = storedBackup?.raw;
            if (!backup) {
                throw RpcError.NotFound('backup', id);
            }
            this.#assertBackupDeviceAccessible(
                sender,
                storedBackup?.normalized,
                'update',
                id
            );

            // Check if another backup already has this name — overwrite it
            const replacements = (
                await this.findStoredBackupsByName(name)
            ).filter((entry) => entry.normalized.id !== id);
            this.assertBackupsNotInUse(
                [
                    id,
                    ...replacements.map(
                        (replacement) => replacement.normalized.id
                    )
                ],
                'rename'
            );
            const stagedReplacements = await this.stageBackupFileDeletions(
                replacements.map((replacement) => replacement.normalized.id)
            );

            const updated = {...backup, name};
            try {
                await Registry.mutateRegistry(REGISTRY_NAME, (draft) => {
                    draft[id] = updated;
                    for (const replacement of replacements) {
                        delete draft[replacement.normalized.id];
                    }
                });
            } catch (error) {
                await this.rollbackStagedBackupDeletions(stagedReplacements);
                throw error;
            }
            await this.commitStagedBackupDeletions(
                stagedReplacements,
                'replace existing backup files during rename'
            );

            logger.info('Backup renamed: id=%s, new name=%s', id, name);
            return {
                ...this.normalizeStoredBackup(updated),
                ...(replacements[0]
                    ? {replacedBackupId: replacements[0].normalized.id}
                    : {})
            };
        });
    }

    /**
     * Delete a backup (file + metadata).
     */
    @Component.Expose('Delete')
    @Component.CheckPermissions(canDeleteDeviceBackups)
    async delete(
        rawParams: unknown,
        sender: CommandSender
    ): Promise<{success: boolean}> {
        const params = validateOrThrow<DeleteParams>(
            rawParams,
            BACKUP_DELETE_PARAMS
        );
        const {id} = params;
        validateBackupId(id);

        return await this.withBackupMutationLock(async () => {
            const storedBackup = await this.getStoredBackupRecord(id);
            const backup = storedBackup?.raw;
            if (!backup) {
                throw RpcError.NotFound('backup', id);
            }
            this.#assertBackupDeviceAccessible(
                sender,
                storedBackup?.normalized,
                'delete',
                id
            );

            this.assertBackupsNotInUse([id], 'delete');
            const stagedDeletion = await this.stageBackupFileDeletion(id);

            try {
                await Registry.mutateRegistry(REGISTRY_NAME, (draft) => {
                    delete draft[id];
                });
            } catch (error) {
                await stagedDeletion.rollback();
                throw error;
            }

            await this.commitStagedBackupDeletions(
                [stagedDeletion],
                'delete backup file'
            );

            logger.info('Backup deleted: id=%s, name=%s', id, backup.name);
            return {success: true};
        });
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
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async restoreToDevice(
        rawParams: unknown,
        sender: CommandSender
    ): Promise<{success: boolean}> {
        const params = validateOrThrow<RestoreToDeviceParams>(
            rawParams,
            BACKUP_RESTORE_PARAMS
        );
        return await this.restoreBackupToDevice(params, {sender});
    }

    private async restoreBackupToDevice(
        params: RestoreToDeviceParams,
        authorization: RestoreAuthorization = {}
    ): Promise<{success: boolean}> {
        const {id, shellyID, restore} = params;
        validateBackupId(id);
        this.acquireDeviceOperation(shellyID, 'restore');
        const watcherHolder: RestoreReconnectWatcherHolder = {
            current: null,
            finalChunkUnconfirmed: false
        };
        let sourceLockHeld = false;
        try {
            await this.#preflightRestore(id, shellyID, authorization);
            sourceLockHeld = true;
            const filePath = this.getBackupFilePath(id);
            const fileStat = await fsPromises.stat(filePath);
            const totalChunks = Math.ceil(
                fileStat.size / RESTORE_BINARY_CHUNK_SIZE
            );

            logger.info(
                'Restoring backup %s to device %s (total size: %d bytes, ~%d chunks)',
                id,
                shellyID,
                fileStat.size,
                totalChunks
            );

            await this.#streamRestoreChunksToDevice({
                id,
                shellyID,
                restore,
                fileSize: fileStat.size,
                totalChunks,
                filePath,
                watcherHolder
            });

            const watcher = watcherHolder.current;
            if (watcher) {
                await watcher.waitForReconnect();
                watcher.cleanup();
                watcherHolder.current = null;
            }

            if (watcherHolder.finalChunkUnconfirmed) {
                await this.#confirmRestoreApplied(shellyID, id);
            }

            logger.info(
                'Backup %s restore completed on device %s after reconnect confirmation.',
                id,
                shellyID
            );

            return {success: true};
        } catch (err) {
            reportBackupFailure(shellyID, err);
            throw err;
        } finally {
            watcherHolder.current?.cleanup();
            if (sourceLockHeld) this.releaseRestoreBackupSource(id);
            this.releaseDeviceOperation(shellyID, 'restore');
        }
    }

    // The final apply RPC was never acked, and reconnect only proves the device
    // booted, not that it accepted the config — probe it so a failed restore is
    // surfaced rather than reported as success.
    async #confirmRestoreApplied(shellyID: string, id: string): Promise<void> {
        const device = DeviceCollector.getDevice(shellyID);
        if (!device) {
            throw RpcError.Domain('DeviceOffline', {
                message: `Device ${shellyID} did not return after restoring backup ${id}`,
                operation: 'backup_restore',
                shellyID
            });
        }
        try {
            await device.sendRPC('Shelly.GetDeviceInfo', {});
        } catch (error) {
            throw RpcError.DeviceFailed(
                `Confirm restore of backup ${id}`,
                error,
                shellyID
            );
        }
    }

    // Restart from 0 on chunk failure: device drops chunks on disconnect.
    async #streamRestoreChunksToDevice(args: RestoreStreamArgs): Promise<void> {
        const {id, shellyID, restore, fileSize, totalChunks, filePath} = args;
        const fileHandle = await fsPromises.open(filePath, 'r');
        let offset = 0;
        let currentChunk = 0;
        let restartCount = 0;
        try {
            while (offset < fileSize) {
                const bytesToRead = Math.min(
                    RESTORE_BINARY_CHUNK_SIZE,
                    fileSize - offset
                );
                const chunkBuffer = Buffer.allocUnsafe(bytesToRead);
                const {bytesRead} = await fileHandle.read(
                    chunkBuffer,
                    0,
                    bytesToRead,
                    offset
                );
                if (bytesRead <= 0) {
                    throw RpcError.OperationFailed(
                        `read restore chunk from backup ${id} at offset ${offset}`
                    );
                }
                const isLast = offset + bytesRead >= fileSize;
                const rpcParams: Record<string, any> = {
                    offset,
                    data: chunkBuffer.subarray(0, bytesRead).toString('base64')
                };
                if (isLast) {
                    rpcParams.final = true;
                    const restoreSelection =
                        filterEnabledBackupContents(restore);
                    if (restoreSelection) rpcParams.restore = restoreSelection;
                }

                const {sent, restarted} = await this.#sendRestoreChunkWithRetry(
                    {
                        shellyID,
                        offset,
                        rpcParams,
                        isLast,
                        restartCount,
                        watcherHolder: args.watcherHolder
                    }
                );

                if (restarted) {
                    restartCount++;
                    offset = 0;
                    currentChunk = 0;
                    continue;
                }
                if (!sent) {
                    throw RpcError.DeviceFailed(
                        'Sys.UploadBackup',
                        `Failed after ${tuning.backup.restoreChunkMaxRetries} attempts`,
                        shellyID
                    );
                }

                offset += bytesRead;
                currentChunk++;
                this.#emitRestoreProgress(
                    shellyID,
                    id,
                    currentChunk,
                    totalChunks
                );
                logger.debug(
                    'Uploaded chunk %d/%d: offset=%d, decodedBytes=%d, final=%s',
                    currentChunk,
                    totalChunks,
                    offset - bytesRead,
                    bytesRead,
                    isLast
                );
            }
        } finally {
            await fileHandle.close();
        }
    }

    // Returns {sent, restarted}: at most one is true.
    async #sendRestoreChunkWithRetry(
        args: RestoreChunkArgs
    ): Promise<{sent: boolean; restarted: boolean}> {
        const {shellyID, offset, rpcParams, isLast, restartCount} = args;
        const maxRetries = tuning.backup.restoreChunkMaxRetries;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const device = DeviceCollector.getDevice(shellyID);
            if (!device) {
                if (attempt < maxRetries) {
                    logger.warn(
                        'Device %s offline during restore (attempt %d/%d), waiting...',
                        shellyID,
                        attempt,
                        maxRetries
                    );
                    await this.sleep(tuning.backup.restoreRetryDelayMs);
                    continue;
                }
                throw RpcError.Domain('DeviceOffline', {
                    message: `Device ${shellyID} went offline during restore`,
                    operation: 'backup_restore',
                    shellyID
                });
            }

            try {
                await this.#raceRestoreChunkSend(
                    device,
                    rpcParams,
                    isLast,
                    args
                );
                return {sent: true, restarted: false};
            } catch (e: any) {
                logger.warn(
                    'Restore chunk failed for %s at offset %d (attempt %d/%d): %s',
                    shellyID,
                    offset,
                    attempt,
                    maxRetries,
                    e.message || e
                );
                if (restartCount < tuning.backup.restoreMaxRestarts) {
                    logger.info(
                        'Restarting restore upload from offset 0 for %s (restart %d/%d)',
                        shellyID,
                        restartCount + 1,
                        tuning.backup.restoreMaxRestarts
                    );
                    await this.sleep(tuning.backup.restoreRetryDelayMs);
                    return {sent: false, restarted: true};
                }
            }
        }
        return {sent: false, restarted: false};
    }

    // Final chunk: reconnect confirms, not the send result.
    async #raceRestoreChunkSend(
        device: NonNullable<ReturnType<typeof DeviceCollector.getDevice>>,
        rpcParams: Record<string, any>,
        isLast: boolean,
        args: RestoreChunkArgs
    ): Promise<void> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
            timer = setTimeout(
                () => reject(new Error('Chunk send timeout')),
                tuning.backup.restoreChunkTimeoutMs
            );
        });
        const send = () =>
            Promise.race([
                device.sendRPC('Sys.RestoreBackup', rpcParams),
                timeoutPromise
            ]);

        if (!isLast) {
            try {
                await send();
            } finally {
                clearTimeout(timer);
            }
            return;
        }

        const holder = args.watcherHolder;
        if (!holder.current) {
            holder.current = this.createRestoreReconnectWatcher(args.shellyID);
        }
        // Device reboots and may not respond; confirm reconnect instead.
        try {
            await send();
        } catch (e: any) {
            if (!isExpectedFinalRestoreRpcError(e)) {
                holder.current.cleanup();
                holder.current = null;
                throw e;
            }
            // The apply was never acked — reconnect alone does not prove it
            // landed. Demand a post-reboot probe before declaring success.
            holder.finalChunkUnconfirmed = true;
            logger.info(
                'Final restore chunk for %s ended during reboot/apply: %s',
                args.shellyID,
                RpcError.messageOf(e) ?? String(e)
            );
        } finally {
            clearTimeout(timer);
        }
    }

    #emitRestoreProgress(
        shellyID: string,
        backupId: string,
        chunk: number,
        totalChunks: number
    ): void {
        this.emitStatus({
            restoreProgress: {
                shellyID,
                backupId,
                chunk,
                totalChunks,
                percent: Math.round((chunk / totalChunks) * 100)
            }
        });
    }

    // Holds the source lock only when all restore preflight checks pass.
    async #preflightRestore(
        id: string,
        shellyID: string,
        authorization: RestoreAuthorization
    ): Promise<void> {
        let sourceLockHeld = false;
        try {
            const storedBackup = await this.withBackupMutationLock(async () => {
                this.acquireRestoreBackupSource(id);
                sourceLockHeld = true;
                const current = await this.getStoredBackupRecord(id);
                if (!current) throw RpcError.NotFound('backup', id);
                return current;
            });
            if (!storedBackup) {
                throw RpcError.NotFound('backup', id);
            }
            // Source read access — target device and backup source may differ.
            if (authorization.sender) {
                this.#assertBackupDeviceAccessible(
                    authorization.sender,
                    storedBackup.normalized,
                    'read',
                    id
                );
            }
            this.#assertBackupSourceOrg(
                storedBackup.normalized,
                authorization.expectedSourceOrg,
                id
            );
            const backup = storedBackup.raw;
            const initialDevice = DeviceCollector.getDevice(shellyID);
            if (!initialDevice) {
                throw RpcError.Domain('DeviceOffline', {
                    message: `Device ${shellyID} not found or offline`,
                    shellyID
                });
            }
            const deviceInfo = initialDevice.info;
            if (deviceInfo.model !== backup.model) {
                throw RpcError.Domain('ResourceConflict', {
                    message: `Model mismatch: backup is for ${backup.model}, target device is ${deviceInfo.model}`,
                    details: {
                        resourceType: 'backup_restore',
                        reason: 'model_mismatch',
                        backupModel: backup.model,
                        deviceModel: deviceInfo.model
                    }
                });
            }
            if (backup.app && deviceInfo.app && deviceInfo.app !== backup.app) {
                throw RpcError.Domain('ResourceConflict', {
                    message: `App mismatch: backup is for ${backup.app}, target device is ${deviceInfo.app}`,
                    details: {
                        resourceType: 'backup_restore',
                        reason: 'app_mismatch',
                        backupApp: backup.app,
                        deviceApp: deviceInfo.app
                    }
                });
            }
        } catch (err) {
            if (sourceLockHeld) this.releaseRestoreBackupSource(id);
            throw err;
        }
    }

    /**
     * Get the base64-encoded backup file for client download.
     */
    @Component.Expose('GetFile')
    @Component.CheckPermissions(canReadDeviceBackups)
    async getFile(
        rawParams: unknown,
        sender: CommandSender
    ): Promise<{data: string; name: string; size: number}> {
        const params = validateOrThrow<GetFileParams>(
            rawParams,
            BACKUP_GETFILE_PARAMS
        );
        const {id} = params;
        validateBackupId(id);

        const storedBackup = await this.getStoredBackupRecord(id);
        const backup = storedBackup?.raw;
        if (!backup) {
            throw RpcError.NotFound('backup', id);
        }
        this.#assertBackupDeviceAccessible(
            sender,
            storedBackup?.normalized,
            'read',
            id
        );

        const filePath = this.getBackupFilePath(id);
        // GetFile buffers the whole file + base64 (~2.33x peak RAM). The cap
        // bounds that blast radius; full streaming needs a route change.
        const stat = await fsPromises.stat(filePath);
        assertBackupDownloadWithinCap(stat.size);

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
        shellyID: string,
        previousCreated?: number
    ): Promise<Record<string, any>> {
        return await new Promise<Record<string, any>>((resolve, reject) => {
            let settled = false;
            let statusListenerId: number | null = null;
            let connectListenerId: number | null = null;

            const cleanup = () => {
                settled = true;
                clearTimeout(timeoutId);
                if (statusListenerId !== null) {
                    EventDistributor.removeEventListener(
                        statusListenerId,
                        'Shelly.Status'
                    );
                }
                if (connectListenerId !== null) {
                    EventDistributor.removeEventListener(
                        connectListenerId,
                        'Shelly.Connect'
                    );
                }
            };

            const resolveIfReady = (payload: any, source: string): boolean => {
                if (settled) return true;

                const backupStatus = extractBackupStatus(payload);
                if (!backupStatus) return false;

                if (backupStatus.error) {
                    cleanup();
                    reject(
                        new Error(
                            `Backup creation failed on device: ${backupStatus.error}`
                        )
                    );
                    return true;
                }

                const created =
                    typeof backupStatus.created === 'number'
                        ? backupStatus.created
                        : undefined;
                if (!created) {
                    return false;
                }

                if (
                    typeof previousCreated === 'number' &&
                    created <= previousCreated
                ) {
                    logger.debug(
                        'Ignoring stale backup on %s from %s (created=%d, previous=%d)',
                        shellyID,
                        source,
                        created,
                        previousCreated
                    );
                    return false;
                }

                logger.info(
                    'Backup ready on device %s via %s (created: %d)',
                    shellyID,
                    source,
                    created
                );
                cleanup();
                resolve(backupStatus);
                return true;
            };

            const checkCurrentDeviceStatus = async (source: string) => {
                if (settled) return;

                const device = DeviceCollector.getDevice(shellyID);
                if (!device) return;

                if (resolveIfReady(device.status, `${source}:cached`)) {
                    return;
                }

                try {
                    const statusResponse = await device.sendRPC(
                        'Sys.GetStatus',
                        {}
                    );
                    resolveIfReady(statusResponse, `${source}:rpc`);
                } catch (error: any) {
                    logger.debug(
                        'Waiting for device %s backup via %s: %s',
                        shellyID,
                        source,
                        RpcError.messageOf(error) ?? String(error)
                    );
                }
            };

            const timeoutId = setTimeout(() => {
                void (async () => {
                    if (settled) return;

                    await checkCurrentDeviceStatus('timeout fallback');
                    if (settled) return;

                    cleanup();
                    reject(
                        new Error(
                            `Timeout waiting for backup to be ready on device ${shellyID}`
                        )
                    );
                })();
            }, REBOOT_TIMEOUT);

            statusListenerId = EventDistributor.addEventListener(
                CommandSender.INTERNAL,
                'Shelly.Status',
                {shellyIDs: [shellyID]},
                (event: json_rpc_event) => {
                    void resolveIfReady(
                        (event as ShellyEvent.Status).params?.status,
                        'status event'
                    );
                }
            );

            connectListenerId = EventDistributor.addEventListener(
                CommandSender.INTERNAL,
                'Shelly.Connect',
                {shellyIDs: [shellyID]},
                (event: json_rpc_event) => {
                    if (
                        resolveIfReady(
                            (event as ShellyEvent.Connect).params?.device
                                ?.status,
                            'connect event'
                        )
                    ) {
                        return;
                    }
                    void checkCurrentDeviceStatus('connect event');
                }
            );

            void checkCurrentDeviceStatus('initial check');
        });
    }

    private createRestoreReconnectWatcher(shellyID: string) {
        const initialDevice = DeviceCollector.getDevice(shellyID);
        let disconnectListenerId: number | null = null;
        let connectListenerId: number | null = null;
        let cleanedUp = false;
        let sawDisconnect = false;
        let sawConnect = false;
        let resolveConnect: (() => void) | null = null;

        const connectPromise = new Promise<void>((resolve) => {
            resolveConnect = resolve;
        });

        const cleanup = () => {
            if (cleanedUp) return;
            cleanedUp = true;
            if (disconnectListenerId !== null) {
                EventDistributor.removeEventListener(
                    disconnectListenerId,
                    'Shelly.Disconnect'
                );
            }
            if (connectListenerId !== null) {
                EventDistributor.removeEventListener(
                    connectListenerId,
                    'Shelly.Connect'
                );
            }
        };

        disconnectListenerId = EventDistributor.addEventListener(
            CommandSender.INTERNAL,
            'Shelly.Disconnect',
            {shellyIDs: [shellyID]},
            () => {
                sawDisconnect = true;
                logger.info(
                    'Observed device %s disconnect during restore apply',
                    shellyID
                );
            }
        );

        connectListenerId = EventDistributor.addEventListener(
            CommandSender.INTERNAL,
            'Shelly.Connect',
            {shellyIDs: [shellyID]},
            () => {
                sawConnect = true;
                logger.info(
                    'Observed device %s reconnect after restore apply',
                    shellyID
                );
                resolveConnect?.();
                resolveConnect = null;
            }
        );

        return {
            cleanup,
            async waitForReconnect() {
                if (sawConnect) return;

                let timeoutId: ReturnType<typeof setTimeout> | undefined;
                try {
                    await Promise.race([
                        connectPromise,
                        new Promise<void>((resolve, reject) => {
                            timeoutId = setTimeout(async () => {
                                const device =
                                    DeviceCollector.getDevice(shellyID);
                                const deviceWasReplaced =
                                    Boolean(device) && device !== initialDevice;
                                if (device && deviceWasReplaced) {
                                    try {
                                        await device.sendRPC(
                                            'Shelly.GetDeviceInfo',
                                            {}
                                        );
                                        logger.info(
                                            sawDisconnect
                                                ? 'Restore reconnect for %s confirmed via post-reboot RPC after disconnect'
                                                : 'Restore reconnect for %s confirmed via replacement device object + post-reboot RPC without observed disconnect/connect events',
                                            shellyID
                                        );
                                        resolve();
                                        return;
                                    } catch (error: any) {
                                        logger.debug(
                                            'Restore reconnect RPC fallback for %s failed: %s',
                                            shellyID,
                                            RpcError.messageOf(error) ??
                                                String(error)
                                        );
                                    }
                                }

                                reject(
                                    new Error(
                                        `Timeout waiting for device ${shellyID} to reconnect after restore`
                                    )
                                );
                            }, REBOOT_TIMEOUT);
                        })
                    ]);
                } finally {
                    if (timeoutId) {
                        clearTimeout(timeoutId);
                    }
                }
            }
        };
    }

    private async findStoredBackupsByName(
        name: string
    ): Promise<StoredBackupRecord[]> {
        const all = await Registry.getAll(REGISTRY_NAME);
        const matchingEntries = Object.values(all).filter(
            (raw) => storedBackupName(raw) === name
        );

        if (matchingEntries.length === 0) {
            return [];
        }

        const normalizedEntries = await Promise.all(
            matchingEntries.map(async (raw) => {
                const normalized =
                    await this.normalizeAndPruneStoredBackupRecord(raw);
                return normalized
                    ? ({raw, normalized} as StoredBackupRecord)
                    : null;
            })
        );

        return normalizedEntries.filter((entry): entry is StoredBackupRecord =>
            Boolean(entry)
        );
    }

    private async getUniqueGeneratedBackupName(
        baseName: string
    ): Promise<string> {
        const all = await Registry.getAll(REGISTRY_NAME);
        const existingNames = new Set(
            Object.values(all)
                .map((raw) =>
                    typeof raw?.name === 'string' ? raw.name.trim() : ''
                )
                .filter(Boolean)
        );

        let attempt = 1;
        while (true) {
            const candidate = buildBackupName(baseName, attempt);
            if (!existingNames.has(candidate)) {
                return candidate;
            }
            attempt++;
        }
    }

    private getBackupFilePath(id: string): string {
        return path.join(BACKUPS_DIR, `${id}.zip`);
    }

    private async normalizeAndPruneStoredBackupRecord(
        raw: any
    ): Promise<BackupMetadata | null> {
        const normalized = this.normalizeStoredBackup(raw);
        if (!normalized.id) {
            return null;
        }

        const filePath = this.getBackupFilePath(normalized.id);
        if (await this.backupFileExists(filePath)) {
            return normalized;
        }

        if (this.isBackupDeletionStaged(normalized.id)) {
            logger.debug(
                'Skipping prune for backup %s because file deletion is currently staged',
                normalized.id
            );
            return normalized;
        }

        logger.warn(
            'Pruning backup registry entry %s (%s) because the file is missing: %s',
            normalized.id,
            normalized.name,
            filePath
        );
        await Registry.removeFromRegistry(REGISTRY_NAME, normalized.id, {
            id: normalized.id
        });
        return null;
    }

    private async getStoredBackupRecord(id: string): Promise<{
        raw: any;
        normalized: BackupMetadata;
    } | null> {
        const raw = await Registry.getFromRegistry(REGISTRY_NAME, id);
        if (!raw) {
            return null;
        }

        const normalized = await this.normalizeAndPruneStoredBackupRecord(raw);
        if (!normalized) {
            return null;
        }
        if (normalized.organizationId === null) {
            normalized.organizationId = await this.#backfillBackupOrg(
                normalized.id
            );
        }

        return {raw, normalized};
    }

    // Legacy records predate owner stamping. Seed the owner once from the
    // create-mode unit (the authoritative capture org) and persist it, so every
    // later read scopes on the record itself — no cross-table lookup.
    async #backfillBackupOrg(id: string): Promise<string | null> {
        return (await this.#backfillBackupOrgs([id])).get(id) ?? null;
    }

    async #backfillBackupOrgs(ids: string[]): Promise<Map<string, string>> {
        const orgs = await backupCaptureOrgs(ids);
        if (orgs.size > 0) {
            await Registry.mutateRegistry(REGISTRY_NAME, (draft) => {
                for (const [id, org] of orgs) {
                    if (draft[id]) draft[id].organizationId = org;
                }
            });
        }
        return orgs;
    }

    private normalizeStoredBackup(raw: any): BackupMetadata {
        const createdAt =
            typeof raw?.createdAt === 'number' ? raw.createdAt : Date.now();
        const contents = normalizeBackupContents(raw?.contents);
        const metadata =
            raw?.metadata && typeof raw.metadata === 'object'
                ? raw.metadata
                : {};

        const groupIds = Array.isArray(raw?.groupIds)
            ? raw.groupIds
                  .map((value: any) => Number(value))
                  .filter((value: number) => Number.isFinite(value))
            : Array.isArray(metadata.group_ids)
              ? metadata.group_ids
                    .map((value: any) => Number(value))
                    .filter((value: number) => Number.isFinite(value))
              : [];

        const groupNames = Array.isArray(raw?.groupNames)
            ? raw.groupNames.map((value: any) => String(value)).filter(Boolean)
            : Array.isArray(metadata.group_names)
              ? metadata.group_names
                    .map((value: any) => String(value))
                    .filter(Boolean)
              : [];

        return {
            id: String(raw?.id ?? ''),
            organizationId:
                typeof raw?.organizationId === 'string' && raw.organizationId
                    ? raw.organizationId
                    : null,
            name: String(raw?.name ?? ''),
            shellyID: String(raw?.shellyID ?? ''),
            deviceName:
                typeof raw?.deviceName === 'string' && raw.deviceName
                    ? raw.deviceName
                    : typeof metadata.device_name === 'string' &&
                        metadata.device_name
                      ? metadata.device_name
                      : String(raw?.shellyID ?? ''),
            model: String(raw?.model ?? ''),
            app: String(raw?.app ?? ''),
            fwVersion: String(raw?.fwVersion ?? ''),
            createdAt,
            createdDateKey:
                typeof raw?.createdDateKey === 'string' && raw.createdDateKey
                    ? raw.createdDateKey
                    : getCreatedDateKey(createdAt),
            fileSize:
                typeof raw?.fileSize === 'number'
                    ? raw.fileSize
                    : Number(raw?.fileSize ?? 0),
            contents,
            contentsSummary:
                typeof raw?.contentsSummary === 'string' && raw.contentsSummary
                    ? raw.contentsSummary
                    : typeof metadata.actual_contents === 'string' &&
                        metadata.actual_contents
                      ? metadata.actual_contents
                      : summarizeBackupContents(contents),
            groupIds,
            groupNames,
            metadata
        };
    }

    // Group snapshot is parked for phase 1 — pending an org-scoped backup API.
    // Shape stays in the metadata envelope so future snapshots populate it.
    private async getGroupSnapshot(_shellyID: string): Promise<{
        groupIds: number[];
        groupNames: string[];
    }> {
        return {groupIds: [], groupNames: []};
    }

    private async stageBackupFileDeletions(
        ids: string[]
    ): Promise<StagedBackupDeletion[]> {
        const staged: StagedBackupDeletion[] = [];

        try {
            for (const id of ids) {
                staged.push(await this.stageBackupFileDeletion(id));
            }
            return staged;
        } catch (error) {
            await this.rollbackStagedBackupDeletions(staged);
            throw error;
        }
    }

    private async stageBackupFileDeletion(
        id: string
    ): Promise<StagedBackupDeletion> {
        const filePath = this.getBackupFilePath(id);
        const stagedPath = `${filePath}.deleting-${Date.now()}-${randomBytes(6).toString('hex')}`;

        try {
            await fsPromises.rename(filePath, stagedPath);
            this.trackStagedBackupDeletion(id, stagedPath);
        } catch (error: any) {
            if (error?.code === 'ENOENT') {
                return {
                    id,
                    commit: async () => {},
                    rollback: async () => {}
                };
            }
            throw RpcError.OperationFailed(
                `stage backup file ${filePath} for deletion`,
                error
            );
        }

        return {
            id,
            commit: async () => {
                try {
                    await fsPromises.unlink(stagedPath);
                    this.untrackStagedBackupDeletion(id, stagedPath);
                } catch (error: any) {
                    if (error?.code !== 'ENOENT') {
                        throw RpcError.OperationFailed(
                            `remove staged backup file ${stagedPath}`,
                            error
                        );
                    }
                    this.untrackStagedBackupDeletion(id, stagedPath);
                }
            },
            rollback: async () => {
                try {
                    await fsPromises.rename(stagedPath, filePath);
                    this.untrackStagedBackupDeletion(id, stagedPath);
                } catch (error: any) {
                    if (error?.code !== 'ENOENT') {
                        throw RpcError.OperationFailed(
                            `restore staged backup file ${filePath}`,
                            error
                        );
                    }
                    this.untrackStagedBackupDeletion(id, stagedPath);
                }
            }
        };
    }

    private async rollbackStagedBackupDeletions(
        stagedDeletions: StagedBackupDeletion[]
    ): Promise<void> {
        for (const stagedDeletion of [...stagedDeletions].reverse()) {
            await stagedDeletion.rollback().catch((error: any) => {
                logger.error(
                    'Failed to roll back staged backup deletion for %s: %s',
                    stagedDeletion.id,
                    RpcError.messageOf(error) ?? String(error)
                );
            });
        }
    }

    private async commitStagedBackupDeletions(
        stagedDeletions: StagedBackupDeletion[],
        action: string
    ): Promise<void> {
        for (const stagedDeletion of stagedDeletions) {
            try {
                await stagedDeletion.commit();
            } catch (error: any) {
                logger.warn(
                    'Deferred cleanup after %s for backup %s: %s',
                    action,
                    stagedDeletion.id,
                    RpcError.messageOf(error) ?? String(error)
                );
            }
        }
    }

    private async writeBackupChunk(
        stream: fs.WriteStream,
        chunk: Buffer
    ): Promise<void> {
        if (stream.write(chunk)) return;

        await new Promise<void>((resolve, reject) => {
            const onDrain = () => {
                stream.off('error', onError);
                resolve();
            };
            const onError = (error: Error) => {
                stream.off('drain', onDrain);
                reject(error);
            };
            stream.once('drain', onDrain);
            stream.once('error', onError);
        });
    }

    private async deleteFileIfExists(filePath: string): Promise<void> {
        try {
            await fsPromises.unlink(filePath);
        } catch (error: any) {
            if (error?.code !== 'ENOENT') {
                logger.warn(
                    'Failed to delete file %s during cleanup: %s',
                    filePath,
                    RpcError.messageOf(error) ?? String(error)
                );
            }
        }
    }

    // Only a real ENOENT means "gone". EACCES/EIO/EMFILE are operational
    // faults — surface them so a present backup is never mistaken for missing.
    private async backupFileExists(filePath: string): Promise<boolean> {
        try {
            await fsPromises.access(filePath);
            return true;
        } catch (error: any) {
            if (error?.code === 'ENOENT') return false;
            throw RpcError.OperationFailed(
                `check backup file ${filePath}`,
                error
            );
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

function storedBackupName(value: unknown): string | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const name = (value as {name?: unknown}).name;
    return typeof name === 'string' ? name : undefined;
}
